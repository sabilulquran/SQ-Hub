import { createHash } from "node:crypto";

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
import { deleteSchema, editSchema, forwardSchema, reactionSchema, type KirimMessageActions } from "./actions.js";
import { webhookRegistrationSchema, type KirimModuleCards } from "./cards.js";
import { gatewayWebhookSchema, type GatewayConsumer, type KirimGateway } from "./gateway.js";
import {
  adminSchema,
  createGroupSchema,
  inviteRevokeSchema,
  joinAnswerSchema,
  participantsSchema,
  pictureSchema,
  settingsSchema,
  updateGroupSchema,
  type KirimGroupAdmin,
} from "./groups-admin.js";
import {
  businessHoursSchema,
  businessProfileSchema,
  catalogQuerySchema,
  coverPhotoRemoveSchema,
  coverPhotoSchema,
  productPatchSchema,
  productSchema,
  profilePictureSchema,
  chatLabelSchema,
  quickReplyRemoveSchema,
  quickReplySchema,
  type KirimBusiness,
} from "./business.js";
import { PHOTO_CACHE_SECONDS, type KirimProfilePhotos } from "./photos.js";
import { verifyJalurPesanSignature } from "./crypto.js";
import type { KirimIngest } from "./ingest.js";
import { KirimApiError, MEDIA_MAX_BYTES, optoutSchema, sendMessageSchema, type KirimService } from "./service.js";
import type { ConsumerRow } from "./repository.js";

/** KIRIM-IMPL-001 §6.1 and §6.3, KIRIM-IMPL-002 §6 and §8. Loopback only; the edge answers 404 for `/internal/*` (§10). */
export const KIRIM_INTERNAL_PREFIX = "/internal/kirim";
/**
 * KIRIM-IMPL-003 §17.4: the public API for applications outside the server, reached as
 * `https://kirim.sabilulquran.or.id/api/v1/*` (the edge strips `/api`). API keys (`krm_…`) only; the
 * module API with Keycloak tokens stays on loopback.
 */
export const KIRIM_PUBLIC_PREFIX = "/v1";
const OPTOUT_KEY_REFUSAL = "Kunci API hanya boleh memakai nomornya sendiri; di nomor milik aplikasi lain pakai cakupan consumer.";

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
  if (error instanceof KirimApiError) {
    if (!error.details) return sendKirimError(reply, error.statusCode, error.code, error.message);
    const retryAfter = error.details.retry_after_detik;
    if (typeof retryAfter === "number") reply.header("Retry-After", String(Math.max(1, Math.ceil(retryAfter))));
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, ...error.details } });
  }
  if (error instanceof z.ZodError) {
    return sendKirimError(reply, 400, "invalid_request", "Permintaan tidak sah.", invalidRequestFields(error));
  }
  throw error;
}

export function registerKirimInternalRoutes(
  app: FastifyInstance,
  input: {
    service: KirimService;
    cards?: KirimModuleCards;
    /** ADR-0011 amendment 2026-11-17: API keys (`krm_…`) for applications outside SQ Suite. */
    gateway?: KirimGateway;
    conversations?: KirimConversations;
    /** KIRIM-IMPL-004: message actions, profile photos, R3 groups and grup bersama. */
    actions?: KirimMessageActions;
    photos?: KirimProfilePhotos;
    groupAdmin?: KirimGroupAdmin;
    business?: KirimBusiness;
    verifyMachineToken: VerifyMachineToken;
    ingest?: KirimIngest;
    jalurpesanWebhookSecret?: string | null;
    log?: (entry: Record<string, unknown>, message: string) => void;
  },
) {
  /**
   * Steps 1–2 of §5.1: a valid `sq-hub-kirim` token from a registered, active consumer, or an API key
   * (`krm_…`) of the gateway card, which acts as the gateway consumer on the key's number.
   */
  async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<ConsumerRow | null> {
    reply.header("Cache-Control", "no-store");
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      sendKirimError(reply, 401, "unauthenticated", "Token tidak ada.");
      return null;
    }
    if (input.gateway && token.startsWith("krm_")) {
      try {
        return await input.gateway.authenticate(token);
      } catch (error) {
        handleKirimError(reply, error);
        return null;
      }
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

  /** The conversation, group and business API stays with SQ Suite applications: an API key gets a clear refusal. */
  async function authenticateModule(request: FastifyRequest, reply: FastifyReply): Promise<ConsumerRow | null> {
    const consumer = await authenticate(request, reply);
    if (consumer && apiKeyOf(consumer)) {
      sendKirimError(reply, 403, "api_key_not_allowed", "Kunci API hanya untuk kirim pesan, status, jangan hubungi, dan webhook.");
      return null;
    }
    return consumer;
  }

  /** §17.4: the public path takes an API key only. Anything else, a missing header included, is 401. */
  async function authenticateApiKey(request: FastifyRequest, reply: FastifyReply): Promise<ConsumerRow | null> {
    reply.header("Cache-Control", "no-store");
    const token = readBearerToken(request.headers.authorization);
    if (!token || !token.startsWith("krm_") || !input.gateway) {
      sendKirimError(reply, 401, "unauthenticated", "Kunci API wajib: header Authorization: Bearer krm_….");
      return null;
    }
    try {
      return await input.gateway.authenticate(token);
    } catch (error) {
      handleKirimError(reply, error);
      return null;
    }
  }

  async function prepareScope(scope: FastifyInstance) {
    // §17.3–§17.4: a body over a route's limit is answered in Kirim's error shape; on an image route it is an image
    // too large, like one the decoder refuses (422 gambar_invalid).
    scope.setErrorHandler((error, request, reply) => {
      if ((error as { statusCode?: unknown }).statusCode === 413) {
        if (IMAGE_WRITE_PATH.test(request.url)) {
          return sendKirimError(reply, 422, "gambar_invalid", "Gambar terlalu besar.");
        }
        return sendKirimError(reply, 413, "body_too_large", "Permintaan terlalu besar.");
      }
      throw error;
    });
    await scope.register(multipart, {
      limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 2, fieldSize: 100, parts: 3, headerPairs: 50 },
    });
  }

  void app.register(async (scope) => {
    await prepareScope(scope);
    registerSendRoutes(scope, authenticate);
    const conversations = input.conversations;
    if (conversations) {
      registerConversationRoutes(scope, conversations, authenticateModule, {
        ...(input.actions ? { actions: input.actions } : {}),
        ...(input.photos ? { photos: input.photos } : {}),
        ...(input.groupAdmin ? { groupAdmin: input.groupAdmin } : {}),
        ...(input.business ? { business: input.business } : {}),
      });
    }
  }, { prefix: KIRIM_INTERNAL_PREFIX });

  // §17.4: the same handlers, service and queue as the loopback path (Idempotency-Key, payload checks,
  // routes, opt-outs, daily quota, audit), reachable from outside the server with an API key.
  if (input.gateway) {
    void app.register(async (scope) => {
      await prepareScope(scope);
      registerSendRoutes(scope, authenticateApiKey);
    }, { prefix: KIRIM_PUBLIC_PREFIX });
  }

  /** What both a module token and an API key may do: send, read status, opt-outs, the connection, media. */
  function registerSendRoutes(scope: FastifyInstance, authenticate: Authenticate) {
    scope.post("/messages", async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || key.length < 1 || key.length > 200) {
        return sendKirimError(reply, 400, "idempotency_key_required", "Idempotency-Key wajib, 1–200 karakter.");
      }
      const parsed = sendMessageSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalidBody(request, reply, parsed.error);
      const apiKey = apiKeyOf(consumer);
      if (apiKey && parsed.data.device !== undefined) {
        return sendKirimError(reply, 400, "invalid_request", "Kunci API selalu memakai nomornya sendiri; jangan kirim field device.", ["device"]);
      }
      try {
        // Idempotency keys are per number: two numbers may reuse the same value without clashing, and a
        // rotated key keeps its replays. The client's value is hashed so the stored key stays within 200 characters.
        const scopedKey = apiKey ? `krm:${apiKey.device.id}:${createHash("sha256").update(key, "utf8").digest("hex")}` : key;
        return reply.status(202).send(await input.service.acceptMessage(consumer, scopedKey, parsed.data));
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });

    scope.get<{ Params: { id: string } }>("/messages/:id", async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      try {
        return reply.send(await input.service.getMessage(consumer, request.params.id, apiKeyOf(consumer)?.device.id));
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });

    scope.post("/optouts", async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      const parsed = optoutSchema.safeParse(request.body);
      if (!parsed.success) return sendInvalidBody(request, reply, parsed.error);
      if (!apiKeyMayUseDevice(consumer, parsed.data)) return sendKirimError(reply, 403, "not_owner", OPTOUT_KEY_REFUSAL);
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
      if (!apiKeyMayUseDevice(consumer, parsed.data)) return sendKirimError(reply, 403, "not_owner", OPTOUT_KEY_REFUSAL);
      try {
        return reply.send(await input.service.removeConsumerOptout(consumer, parsed.data));
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });

    // KIRIM-IMPL-003 §5: the module reads its number and webhook secret with its own token.
    const cards = input.cards;
    const gateway = input.gateway;
    if (cards) {
      scope.get("/sambungan", async (request, reply) => {
        const consumer = await authenticate(request, reply);
        if (!consumer) return reply;
        const apiKey = apiKeyOf(consumer);
        if (apiKey && gateway) return reply.send(await gateway.connection(consumer as GatewayConsumer));
        return reply.send(await cards.connection(consumer));
      });
      scope.put("/sambungan/webhook", async (request, reply) => {
        const consumer = await authenticate(request, reply);
        if (!consumer) return reply;
        const apiKey = apiKeyOf(consumer);
        const parsed = (apiKey ? gatewayWebhookSchema : webhookRegistrationSchema).safeParse(request.body);
        if (!parsed.success) return sendInvalidBody(request, reply, parsed.error);
        try {
          if (apiKey && gateway) return reply.send(await gateway.registerWebhook(consumer as GatewayConsumer, parsed.data.url));
          return reply.send(await cards.registerWebhook(consumer, parsed.data.url));
        } catch (error) {
          return handleKirimError(reply, error);
        }
      });
    }

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
      if (!file) return sendKirimError(reply, 400, "invalid_request", "Satu berkas wajib.");
      if (device !== undefined && !/^[a-z][a-z0-9-]{1,30}$/.test(device)) return sendKirimError(reply, 400, "invalid_request", "Field device tidak sah.");
      if (device !== undefined && apiKeyOf(consumer)) return sendKirimError(reply, 400, "invalid_request", "Kunci API selalu memakai nomornya sendiri; jangan kirim field device.", ["device"]);
      try {
        return reply.status(201).send(await input.service.storeOutboundMedia(consumer, { deviceKode: device, ...file }));
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });
  }

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

/** The API key behind an authenticated request, when it was not a module token. */
function apiKeyOf(consumer: ConsumerRow): GatewayConsumer["apiKey"] | null {
  return (consumer as Partial<GatewayConsumer>).apiKey ?? null;
}

/**
 * An API key's `cakupan: device` opt-out may only name the key's own number, and only one the
 * "Aplikasi luar" card owns (D-5): on another application's number it uses (§17) such an opt-out would
 * stop that application's own messages too.
 */
function apiKeyMayUseDevice(consumer: ConsumerRow, input: { cakupan: "consumer" } | { cakupan: "device"; device: string }): boolean {
  const apiKey = apiKeyOf(consumer);
  return !apiKey || input.cakupan !== "device" || (input.device === apiKey.device.kode && apiKey.device.pemilikConsumerId === consumer.id);
}

/** KIRIM-IMPL-002 §6 and KIRIM-IMPL-004: the number owner's conversation API. Every handler checks ownership itself. */
function registerConversationRoutes(
  scope: FastifyInstance,
  conversations: KirimConversations,
  authenticate: Authenticate,
  extra: { actions?: KirimMessageActions; photos?: KirimProfilePhotos; groupAdmin?: KirimGroupAdmin; business?: KirimBusiness },
) {
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
    method: "POST" | "PATCH" | "PUT" = "POST",
    options: { bodyLimit?: number } = {},
  ) {
    scope.route<Params>({ method, url: path, ...options, handler: async (request, reply) => {
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
    } });
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

  // KIRIM-IMPL-004 §5: forward, edit, delete for everyone, reaction, and earlier bodies.
  const { actions, photos, groupAdmin, business } = extra;
  // §11: WhatsApp Business of the module's own number: quick replies both ways, the catalog to read.
  if (business) {
    read("/devices/:kode/balasan-cepat", null, async (consumer, params, _query, request) => {
      atasNamaFromHeaders(request.headers);
      return business.quickReplies(consumer, params.kode!);
    });
    write("/devices/:kode/balasan-cepat/baca-ulang", quickReplyRemoveSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.resyncQuickReplies(consumer, params.kode!, body.atas_nama)),
    );
    write("/devices/:kode/balasan-cepat/:waId", quickReplySchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.saveQuickReply(consumer, params.kode!, params.waId!, body)),
    "PATCH");
    write("/devices/:kode/balasan-cepat/:waId/hapus", quickReplyRemoveSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.removeQuickReply(consumer, params.kode!, params.waId!, body.atas_nama)),
    );
    // KIRIM-IMPL-004 §17.1–§17.2: service hours on the WhatsApp Business profile, and the module's labels on one chat.
    write("/devices/:kode/jam-kerja", businessHoursSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.setBusinessHours(consumer, params.kode!, body)),
    "PUT");
    write("/conversations/:id/label", chatLabelSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.setConversationLabels(consumer, params.id!, body)),
    "PUT");
    read("/devices/:kode/katalog", catalogQuerySchema, async (consumer, params, query, request) => {
      atasNamaFromHeaders(request.headers);
      return business.catalog(consumer, params.kode!, query.setelah ?? null, query.semua === "1");
    });
    // KIRIM-IMPL-004 §17.4: catalog products written by the module. Five 2 MB images are about 13.4 MB as base64, but
    // together they may be 6 MB (about 8 MB as base64).
    write("/devices/:kode/katalog", productSchema, async (consumer, params, body, request, reply) => {
      const result = await business.createProduct(consumer, params.kode!, idempotencyKey(request), body);
      return reply.status(result.status).send(result.body);
    }, "POST", { bodyLimit: 9 * 1024 * 1024 });
    write("/devices/:kode/katalog/:id", productPatchSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.updateProduct(consumer, params.kode!, params.id!, body)),
    "PATCH", { bodyLimit: 9 * 1024 * 1024 });
    write("/devices/:kode/katalog/:id/hapus", quickReplyRemoveSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.removeProduct(consumer, params.kode!, params.id!, body.atas_nama)),
    );
    // §17.3: the WhatsApp Business profile: read whole; texts, profile photo and cover photo written. Never the name.
    read("/devices/:kode/profil-bisnis", null, async (consumer, params, _query, request) => {
      atasNamaFromHeaders(request.headers);
      return business.businessProfile(consumer, params.kode!);
    });
    write("/devices/:kode/profil-bisnis", businessProfileSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.updateBusinessProfile(consumer, params.kode!, body)),
    "PATCH");
    scope.get<Params>("/devices/:kode/profil-bisnis/foto", async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      try {
        const photo = await business.profilePicture(consumer, request.params.kode!);
        return reply.header("content-type", "image/jpeg").header("x-content-type-options", "nosniff")
          .header("cache-control", "private, max-age=300").send(photo);
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });
    // A 2 MB JPEG is about 2.7 MB as base64; a 4 MB cover photo about 5.4 MB.
    write("/devices/:kode/profil-bisnis/foto", profilePictureSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.setProfilePicture(consumer, params.kode!, body)),
    "POST", { bodyLimit: 3 * 1024 * 1024 });
    write("/devices/:kode/profil-bisnis/foto/hapus", quickReplyRemoveSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.setProfilePicture(consumer, params.kode!, { gambar: null, atas_nama: body.atas_nama })),
    );
    write("/devices/:kode/profil-bisnis/sampul", coverPhotoSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.setCoverPhoto(consumer, params.kode!, body)),
    "POST", { bodyLimit: 6 * 1024 * 1024 });
    write("/devices/:kode/profil-bisnis/sampul/hapus", coverPhotoRemoveSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await business.removeCoverPhoto(consumer, params.kode!, body)),
    );
    scope.get<Params>("/devices/:kode/katalog/:id/gambar", async (request, reply) => {
      const consumer = await authenticate(request, reply);
      if (!consumer) return reply;
      try {
        const image = await business.catalogImage(consumer, request.params.kode!, request.params.id!);
        return reply.header("content-type", image.mime).header("x-content-type-options", "nosniff")
          .header("cache-control", "private, max-age=3600").send(image.data);
      } catch (error) {
        return handleKirimError(reply, error);
      }
    });
  }
  if (actions) {
    write("/messages/:id/teruskan", forwardSchema, async (consumer, params, body, request, reply) =>
      reply.status(202).send(await actions.forward(consumer, params.id!, idempotencyKey(request), body)),
    );
    write("/messages/:id/edit", editSchema, async (consumer, params, body, request, reply) =>
      reply.send(await actions.edit(consumer, params.id!, idempotencyKey(request), body)),
    );
    write("/messages/:id/hapus", deleteSchema, async (consumer, params, body, request, reply) =>
      reply.send(await actions.remove(consumer, params.id!, idempotencyKey(request), body)),
    );
    write("/messages/:id/reaksi", reactionSchema, async (consumer, params, body, request, reply) =>
      reply.send(await actions.react(consumer, params.id!, idempotencyKey(request), body)),
    );
    read("/messages/:id/riwayat-edit", null, (consumer, params, _query, request) =>
      actions.editHistory(consumer, params.id!, atasNamaFromHeaders(request.headers)),
    );
  }

  // KIRIM-IMPL-004 §8: small profile photos, cacheable by the module for a day.
  if (photos) {
    for (const kind of ["conversation", "group"] as const) {
      scope.get<Params>(kind === "conversation" ? "/conversations/:id/foto" : "/groups/:id/foto", async (request, reply) => {
        const consumer = await authenticate(request, reply);
        if (!consumer) return reply;
        try {
          atasNamaFromHeaders(request.headers);
          const photo = await photos.read(consumer, kind, request.params.id!);
          reply
            .header("Cache-Control", `private, max-age=${PHOTO_CACHE_SECONDS}`)
            .header("ETag", photo.etag)
            .header("X-Content-Type-Options", "nosniff");
          if (headerValue(request.headers["if-none-match"]) === photo.etag) return reply.status(304).send();
          return reply.header("Content-Type", "image/jpeg").send(photo.data);
        } catch (error) {
          return handleKirimError(reply, error);
        }
      });
    }
  }

  // KIRIM-IMPL-004 §9–§10: managing the number's groups (R3), members, and grup bersama.
  if (groupAdmin) {
    read("/conversations/:id/grup-bersama", null, async (consumer, params, _query, request) => {
      atasNamaFromHeaders(request.headers);
      return groupAdmin.sharedGroups(consumer, params.id!);
    });
    read("/groups/:id/anggota", null, async (consumer, params, _query, request) => {
      atasNamaFromHeaders(request.headers);
      return groupAdmin.members(consumer, params.id!);
    });
    write("/devices/:kode/groups", createGroupSchema, async (consumer, params, body, request, reply) => {
      const key = request.headers["idempotency-key"];
      if (key !== undefined && (typeof key !== "string" || key.length < 1 || key.length > 200)) {
        throw new KirimApiError(400, "idempotency_key_required", "Idempotency-Key 1–200 karakter.");
      }
      const result = await groupAdmin.create(consumer, params.kode!, typeof key === "string" ? key : null, body);
      return reply.status(result.status).send(result.body);
    });
    write("/groups/:id/participants", participantsSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await groupAdmin.addMembers(consumer, params.id!, body)),
    );
    write("/groups/:id/participants/keluarkan", participantsSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await groupAdmin.removeMembers(consumer, params.id!, body)),
    );
    read("/groups/:id/invite-link", null, (consumer, params, _query, request) =>
      groupAdmin.inviteLink(consumer, params.id!, atasNamaFromHeaders(request.headers), false),
    );
    write("/groups/:id/invite-link/tarik", inviteRevokeSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await groupAdmin.inviteLink(consumer, params.id!, body.atas_nama, true)),
    );
    write("/groups/:id", updateGroupSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await groupAdmin.update(consumer, params.id!, body)),
    "PATCH");
    // §9.7: admin parity with WhatsApp.
    write("/groups/:id/admin", adminSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await groupAdmin.setAdmin(consumer, params.id!, body)),
    );
    read("/groups/:id/setelan", null, async (consumer, params, _query, request) => {
      atasNamaFromHeaders(request.headers);
      return groupAdmin.settings(consumer, params.id!);
    });
    write("/groups/:id/setelan", settingsSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await groupAdmin.updateSettings(consumer, params.id!, body)),
    "PATCH");
    read("/groups/:id/permintaan", null, async (consumer, params, _query, request) => {
      atasNamaFromHeaders(request.headers);
      return groupAdmin.joinRequests(consumer, params.id!);
    });
    write("/groups/:id/permintaan", joinAnswerSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await groupAdmin.answerJoinRequests(consumer, params.id!, body)),
    );
    // A 1 MB JPEG is about 1.4 MB as base64.
    write("/groups/:id/foto", pictureSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await groupAdmin.setPicture(consumer, params.id!, body)),
    "POST", { bodyLimit: 2 * 1024 * 1024 });
    write("/groups/:id/foto/hapus", inviteRevokeSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await groupAdmin.setPicture(consumer, params.id!, { gambar: null, atas_nama: body.atas_nama })),
    );
    write("/groups/:id/keluar", inviteRevokeSchema, async (consumer, params, body, _request, reply) =>
      reply.send(await groupAdmin.leave(consumer, params.id!, body.atas_nama)),
    );
  }
}

/** Kirim routes whose body carries images (§17.3–§17.4). */
const IMAGE_WRITE_PATH = /\/devices\/[^/]+\/(katalog(\/[^/?]+)?|profil-bisnis\/(foto|sampul))(\?|$)/;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
