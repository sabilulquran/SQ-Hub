import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { invalidRequestFields, invalidRequestIssues } from "../../invalid-request.js";
import { MachineAuthError, readBearerToken, type VerifyMachineToken } from "../application-access/machine-auth.js";
import {
  atasNamaFromHeaders,
  conversationListQuerySchema,
  groupListQuerySchema,
  messageListQuerySchema,
  openConversationSchema,
  readSchema,
  replySchema,
  type KirimConversations,
} from "./conversations.js";
import { verifyJalurPesanSignature } from "./crypto.js";
import type { KirimIngest } from "./ingest.js";
import { KirimApiError, MEDIA_MAX_BYTES, optoutSchema, sendMessageSchema, type KirimService } from "./service.js";
import type { ConsumerRow } from "./repository.js";

/** KIRIM-IMPL-001 §6.1 and §6.3, KIRIM-IMPL-002 §6 and §8. Loopback only; the edge answers 404 for `/internal/*` (§10). */
export const KIRIM_INTERNAL_PREFIX = "/internal/kirim";

export function sendKirimError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  fields?: string[],
) {
  return reply.status(status).send({ error: { code, message, ...(fields ? { fields } : {}) } });
}

/**
 * 400 for a body the schema rejected: the field paths, never the submitted values, which
 * for Kirim include phone numbers and message text.
 */
function sendInvalidBody(request: FastifyRequest, reply: FastifyReply, error: z.ZodError) {
  request.log.warn(
    { category: "internal_invalid_request", issues: invalidRequestIssues(error) },
    "kirim request body rejected",
  );
  return sendKirimError(reply, 400, "invalid_request", "Permintaan tidak sah.", invalidRequestFields(error));
}

export function handleKirimError(reply: FastifyReply, error: unknown) {
  if (error instanceof KirimApiError) return sendKirimError(reply, error.statusCode, error.code, error.message);
  if (error instanceof z.ZodError) {
    return sendKirimError(reply, 400, "invalid_request", "Permintaan tidak sah.", invalidRequestFields(error));
  }
  throw error;
}

export function registerKirimInternalRoutes(
  app: FastifyInstance,
  input: {
    service: KirimService;
    conversations?: KirimConversations;
    verifyMachineToken: VerifyMachineToken;
    ingest?: KirimIngest;
    jalurpesanWebhookSecret?: string | null;
    log?: (entry: Record<string, unknown>, message: string) => void;
  },
) {
  /** Steps 1–2 of §5.1: a valid `sq-hub-kirim` token from a registered, active consumer. */
  async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<ConsumerRow | null> {
    reply.header("Cache-Control", "no-store");
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      sendKirimError(reply, 401, "unauthenticated", "Token tidak ada.");
      return null;
    }
    let clientId: string;
    try {
      clientId = (await input.verifyMachineToken(token)).clientId;
    } catch (error) {
      if (error instanceof MachineAuthError) {
        if (error.code === "FORBIDDEN_CLIENT") sendKirimError(reply, 403, "consumer_unknown", "Pemakai tidak terdaftar.");
        else sendKirimError(reply, 401, "unauthenticated", "Token tidak sah.");
        return null;
      }
      throw error;
    }
    try {
      return await input.service.requireConsumer(clientId);
    } catch (error) {
      handleKirimError(reply, error);
      return null;
    }
  }

  void app.register(async (scope) => {
    await scope.register(multipart, {
      limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 2, fieldSize: 100, parts: 3, headerPairs: 50 },
    });

    scope.post("/messages", async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || key.length < 1 || key.length > 200) {
        return sendKirimError(reply, 400, "idempotency_key_required", "Idempotency-Key wajib, 1–200 karakter.");
      }
      const parsed = sendMessageSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalidBody(request, reply, parsed.error);
      try {
        return reply.status(202).send(await input.service.acceptMessage(consumer, key, parsed.data));
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });

    scope.get<{ Params: { id: string } }>("/messages/:id", async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      try {
        return reply.send(await input.service.getMessage(consumer, request.params.id));
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });

    scope.post("/optouts", async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      const parsed = optoutSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalidBody(request, reply, parsed.error);
      try {
        return reply.send(await input.service.addConsumerOptout(consumer, parsed.data));
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });

    scope.delete("/optouts", async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      const parsed = optoutSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalidBody(request, reply, parsed.error);
      try {
        return reply.send(await input.service.removeConsumerOptout(consumer, parsed.data));
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });

    const conversations = input.conversations;
    if (conversations) registerConversationRoutes(scope, conversations, authenticate);

    scope.post("/media", async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      if (!request.isMultipart()) return sendKirimError(reply, 400, "invalid_request", "Gunakan multipart/form-data.");
      let device: string | undefined;
      let file: { mime: string; data: Buffer; truncated: boolean } | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === "field") {
            if (part.fieldname === "device" && typeof part.value === "string") device = part.value;
            continue;
          }
          if (file) return sendKirimError(reply, 422, "media_invalid", "Hanya satu berkas.");
          const data = await part.toBuffer();
          file = { mime: part.mimetype, data, truncated: part.file.truncated };
        }
      } catch {
        return sendKirimError(reply, 422, "media_invalid", "Hanya PDF, JPEG, atau PNG sampai 5 MiB yang diterima.");
      }
      if (!device || !file) return sendKirimError(reply, 400, "invalid_request", "Field device dan satu berkas wajib.");
      try {
        return reply.status(201).send(await input.service.storeOutboundMedia(consumer, { deviceKode: device, ...file }));
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });
  }, { prefix: KIRIM_INTERNAL_PREFIX });

  const ingest = input.ingest;
  const secret = input.jalurpesanWebhookSecret;
  if (ingest && secret) {
    void app.register(async (scope) => {
      // The signature covers the exact raw body, so this route keeps it as a string.
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser("*", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_request, body, done) => done(null, body));

      scope.post("/engine/jalurpesan/webhook", { logLevel: "warn" }, async (request, reply) => {
        const raw = typeof request.body === "string" ? request.body : "";
        const valid = verifyJalurPesanSignature({
          secret,
          signature: headerValue(request.headers["x-jalurpesan-signature"]),
          timestamp: headerValue(request.headers["x-jalurpesan-timestamp"]),
          rawBody: raw,
          nowSeconds: Math.floor(Date.now() / 1000),
        });
        if (!valid) {
          input.log?.({ event: "kirim.engine_webhook.rejected" }, "engine webhook signature invalid");
          return sendKirimError(reply, 401, "invalid_signature", "Tanda tangan tidak sah.");
        }
        let envelope: { eventId?: unknown; deviceId?: unknown };
        try {
          envelope = JSON.parse(raw) as typeof envelope;
        } catch {
          return sendKirimError(reply, 400, "invalid_request", "Body bukan JSON.");
        }
        if (typeof envelope.eventId !== "string" || typeof envelope.deviceId !== "string") {
          return sendKirimError(reply, 400, "invalid_request", "Event tidak lengkap.");
        }
        const outcome = await ingest.handleEngineWebhook({ eventId: envelope.eventId, engineDeviceId: envelope.deviceId });
        return reply.send({ received: true, outcome });
      });
    }, { prefix: KIRIM_INTERNAL_PREFIX });
  }
}

type Authenticate = (request: FastifyRequest, reply: FastifyReply) => Promise<ConsumerRow | null>;

/** KIRIM-IMPL-002 §6: the number owner's conversation API. Every handler checks ownership itself. */
function registerConversationRoutes(scope: FastifyInstance, conversations: KirimConversations, authenticate: Authenticate) {
  type Params = { Params: Record<string, string> };

  function read<Q extends z.ZodTypeAny>(
    path: string,
    query: Q | null,
    handler: (consumer: ConsumerRow, params: Record<string, string>, query: z.infer<Q>, request: FastifyRequest) => Promise<unknown>,
  ) {
    scope.get<Params>(path, async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      try {
        const parsed = (query ? query.parse(request.query) : undefined) as z.infer<Q>;
        return reply.send(await handler(consumer, request.params, parsed, request));
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });
  }

  function write<B extends z.ZodTypeAny>(
    path: string,
    body: B,
    handler: (consumer: ConsumerRow, params: Record<string, string>, body: z.infer<B>, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  ) {
    scope.post<Params>(path, async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      const parsed = body.safeParse(request.body);
      if (!parsed.success) {
        const missingOfficer = parsed.error.issues.some((issue) => issue.path[0] === "atas_nama");
        if (missingOfficer) return sendKirimError(reply, 400, "atas_nama_required", "Sebutkan petugas yang sedang bekerja (atas_nama).");
        return sendInvalidBody(request, reply, parsed.error);
      }
      try {
        return await handler(consumer, request.params, parsed.data, request, reply);
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });
  }

  function idempotencyKey(request: FastifyRequest): string {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 1 || key.length > 200) {
      throw new KirimApiError(400, "idempotency_key_required", "Idempotency-Key wajib, 1–200 karakter.");
    }
    return key;
  }

  read("/devices/:kode/conversations", conversationListQuerySchema, async (consumer, params, query, request) => {
    atasNamaFromHeaders(request.headers);
    return conversations.listConversations(consumer, params.kode!, query);
  });
  read("/conversations/:id", null, async (consumer, params, _query, request) => {
    atasNamaFromHeaders(request.headers);
    return conversations.getConversation(consumer, params.id!);
  });
  read("/conversations/:id/messages", messageListQuerySchema, (consumer, params, query, request) =>
    conversations.listMessages(consumer, params.id!, query, atasNamaFromHeaders(request.headers)),
  );
  read("/devices/:kode/groups", groupListQuerySchema, async (consumer, params, query, request) => {
    atasNamaFromHeaders(request.headers);
    return conversations.listGroups(consumer, params.kode!, query);
  });
  read("/groups/:id", null, async (consumer, params, _query, request) => {
    atasNamaFromHeaders(request.headers);
    return conversations.getGroup(consumer, params.id!);
  });
  read("/groups/:id/messages", messageListQuerySchema, (consumer, params, query, request) =>
    conversations.listGroupMessages(consumer, params.id!, query, atasNamaFromHeaders(request.headers)),
  );

  scope.get<Params>("/media/:id", async (request, reply) => {
    const consumer = await authenticate(request, reply);
    if (!consumer) return reply;
    try {
      const media = await conversations.media(consumer, request.params.id!, atasNamaFromHeaders(request.headers));
      return reply
        .header("Content-Type", media.mime)
        .header("Content-Disposition", "attachment")
        .header("X-Content-Type-Options", "nosniff")
        .send(media.data);
    } catch (error) {
      return handleKirimError(reply, error);
    }
  });

  write("/devices/:kode/conversations", openConversationSchema, async (consumer, params, body, _request, reply) => {
    const result = await conversations.openConversation(consumer, params.kode!, body);
    return reply.status(result.created ? 201 : 200).send(result.conversation);
  });
  write("/conversations/:id/messages", replySchema, async (consumer, params, body, request, reply) =>
    reply.status(202).send(await conversations.reply(consumer, params.id!, idempotencyKey(request), body)),
  );
  write("/conversations/:id/read", readSchema, async (consumer, params, body, _request, reply) =>
    reply.send(await conversations.markRead(consumer, params.id!, body)),
  );
  write("/groups/:id/messages", replySchema, async (consumer, params, body, request, reply) =>
    reply.status(202).send(await conversations.replyGroup(consumer, params.id!, idempotencyKey(request), body)),
  );
  write("/groups/:id/read", readSchema, async (consumer, params, body, _request, reply) =>
    reply.send(await conversations.markGroupRead(consumer, params.id!, body)),
  );
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
