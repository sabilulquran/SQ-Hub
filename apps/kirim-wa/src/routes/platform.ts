import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { WaConfig } from "../config.js";
import { bufferToStream, type EngineStores, type WaEngine, type WaLog } from "../engine.js";
import { IdempotencyStore, sendFingerprint } from "../store/idempotency.js";
import { MediaTooLargeError, MediaTypeError } from "../store/media.js";
import { DeviceNotFoundError, TenantDeviceNotFoundError } from "../store/device-registry.js";
import { DeviceCapacityError, DeviceParkedError } from "../wa/device-manager.js";
import { isOutboundMediaType, type MediaType } from "../wa/media-types.js";
import { SendSafetyError } from "../wa/send-safety.js";
import {
  InvalidWhatsAppGroupJidError,
  InvalidWhatsAppIndividualJidError,
  PROFILE_PICTURE_MAX_BYTES,
  WhatsAppCatalogMissingError,
  WhatsAppCoverPhotoUnknownError,
  WhatsAppGroupNotFoundError,
  WhatsAppLabelsUnreadError,
  WhatsAppNotConnectedError,
  WhatsAppOutcomeUnknownError,
  WhatsAppPairingUnavailableError,
  WhatsAppSessionResetRequiredError,
  type BusinessHours,
  type MessageAction,
  type SendOptions,
  type WhatsAppGroupMetadata,
  type WhatsAppGroupSetting,
} from "../wa/service.js";

/**
 * KIRIM-IMPL-005 §5. The platform contract Kirim SQ already speaks.
 *
 * Every status code and body here is the one `apps/api/src/modules/kirim/providers/jalurpesan.ts`
 * reads, deliberately: the Hub-side provider for this engine is that class with another base URL,
 * so a number can move between the two engines without a line of Kirim SQ changing. Where a
 * status looks arbitrary, it is JalurPesan's, and the comment says what Kirim SQ makes of it.
 */

const PHONE_PATTERN = /^\d{8,15}$/;
const MAX_EVENT_LIMIT = 250;
const DEFAULT_EVENT_LIMIT = 100;

export interface PlatformRouteDeps {
  config: WaConfig;
  engine: WaEngine;
  stores: EngineStores;
  idempotency: IdempotencyStore;
  log: WaLog;
}

export async function registerPlatformRoutes(app: FastifyInstance, deps: PlatformRouteDeps): Promise<void> {
  const { config, engine, stores, idempotency } = deps;

  app.get("/health", async () => ({ status: "ok", devices: engine.devices.listDevices().length }));

  const scope = "/api/v1/platform/tenants/:tenant";

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/v1/platform/")) return;
    const header = request.headers.authorization ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    // Digests, not the keys themselves: `timingSafeEqual` throws on buffers of different byte
    // length, and a presented key with a multibyte character can match in string length while
    // differing in bytes. That would answer a bad credential with a 500 instead of a 401.
    const ok = timingSafeEqual(sha256(presented), sha256(config.platformKey));
    if (!ok) return reply.code(401).send({ success: false, error: "Unauthorized" });
  });

  /** The number this request is about; `null` means the tenant is not provisioned here. */
  const deviceId = (request: FastifyRequest): string | null => {
    const tenant = (request.params as { tenant?: string }).tenant?.trim();
    if (!tenant) return null;
    try {
      return engine.devices.getTenantDevice(config.platformId, tenant).device.id;
    } catch (error) {
      if (error instanceof TenantDeviceNotFoundError || error instanceof DeviceNotFoundError) return null;
      throw error;
    }
  };

  /** Shared 404: Kirim SQ reads it as "this number does not exist on this engine". */
  const noTenant = (reply: FastifyReply) => reply.code(404).send({ success: false, error: "Tenant device not found" });

  // ------------------------------------------------------------------------------- the number

  app.put(`${scope}/device`, async (request, reply) => {
    const tenant = (request.params as { tenant: string }).tenant.trim();
    const body = (request.body ?? {}) as { name?: unknown };
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : tenant;
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(tenant)) {
      return reply.code(400).send({ success: false, error: "Invalid tenant id" });
    }
    const result = engine.devices.provisionTenantDevice(config.platformId, tenant, name);
    return reply.code(result.created ? 201 : 200).send({ success: true, device: deviceBody(result.device, result.liveState) });
  });

  app.get(`${scope}/device`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const managed = engine.devices.getDevice(id);
    return reply.send({ success: true, device: deviceBody(managed.device, managed.liveState), liveState: managed.liveState });
  });

  app.post(`${scope}/device/connect`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const state = await engine.devices.connectDevice(id);
      return reply.send({ success: true, liveState: state });
    } catch (error) {
      return lifecycleError(reply, error, deps);
    }
  });

  app.post(`${scope}/device/pairing-code`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const phone = String((request.body as { phone?: unknown })?.phone ?? "").replace(/\D/g, "");
    if (!PHONE_PATTERN.test(phone)) return reply.code(400).send({ success: false, error: "Invalid phone" });
    try {
      // The code itself is returned to the caller and never logged (§12).
      const pairingCode = await engine.devices.requestPairingCode(id, phone);
      return reply.send({ success: true, pairingCode });
    } catch (error) {
      return lifecycleError(reply, error, deps);
    }
  });

  app.post(`${scope}/device/logout`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const managed = await engine.devices.logoutDevice(id);
      await forgetNumber(stores, id);
      return reply.send({ success: true, device: deviceBody(managed.device, managed.liveState) });
    } catch (error) {
      return lifecycleError(reply, error, deps);
    }
  });

  app.post(`${scope}/device/reset`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const managed = await engine.devices.resetDevice(id);
      await forgetNumber(stores, id);
      return reply.send({ success: true, device: deviceBody(managed.device, managed.liveState) });
    } catch (error) {
      return lifecycleError(reply, error, deps);
    }
  });

  /**
   * KIRIM-IMPL-005 §9. Not part of the JalurPesan contract: it is how a cutover is undone. Parking
   * stops the socket without logging out, so the other engine can hold the same session; nothing
   * about the number is forgotten, and unparking lets it connect here again.
   */
  app.post(`${scope}/device/park`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    await engine.devices.parkDevice(id);
    return reply.send({ success: true, parked: true });
  });

  app.post(`${scope}/device/unpark`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    engine.devices.unparkDevice(id);
    return reply.send({ success: true, parked: false });
  });

  // ------------------------------------------------------------------------------------ media

  app.post(`${scope}/media`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const type = String((request.query as { type?: unknown })?.type ?? "document");
    if (!isOutboundMediaType(type)) return reply.code(400).send({ success: false, error: "Invalid media type" });
    const file = await request.file();
    if (!file) return reply.code(400).send({ success: false, error: "file is required" });
    try {
      const stored = await stores.media.store({
        kode: id,
        source: "upload",
        mediaType: type,
        mimeType: file.mimetype,
        originalFilename: file.filename,
        data: await file.toBuffer(),
      });
      return reply.code(201).send({ success: true, mediaId: stored.id });
    } catch (error) {
      if (error instanceof MediaTypeError) return reply.code(400).send({ success: false, error: "Unsupported media type" });
      if (error instanceof MediaTooLargeError) return reply.code(413).send({ success: false, error: "Media too large" });
      throw error;
    }
  });

  app.get(`${scope}/media/:mediaId`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const { mediaId } = request.params as { mediaId: string };
    const record = await stores.media.find(id, mediaId);
    if (!record) return reply.code(404).send({ success: false, error: "Media not found" });
    const data = await stores.media.read(record);
    return reply.header("content-type", record.mimeType).header("content-length", String(data.length)).send(data);
  });

  // ------------------------------------------------------------------------------------ sends

  app.post(`${scope}/messages`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const key = headerValue(request.headers["idempotency-key"]);
    if (!key || key.length > 200) return reply.code(400).send({ success: false, error: "Idempotency-Key is required" });

    const target = readTarget(body);
    if (!target) return reply.code(400).send({ success: false, error: "Invalid recipient" });
    const options = readSendOptions(body);
    const mediaId = typeof body.mediaId === "string" ? body.mediaId : null;
    const text = typeof body.message === "string" ? body.message : null;
    const caption = typeof body.caption === "string" ? body.caption : null;
    if (!mediaId && !text) return reply.code(400).send({ success: false, error: "message or mediaId is required" });

    return send(reply, {
      deps,
      deviceId: id,
      key,
      fingerprint: sendFingerprint({ target, mediaId, text, caption, options }),
      safetyTarget: targetLabel(target),
      safetyContent: `${mediaId ?? ""}${text ?? caption ?? ""}`,
      run: async () => {
        if (mediaId) return sendMedia(deps, id, target, mediaId, caption, options);
        return sendText(deps, id, target, text!, options);
      },
    });
  });

  app.post(`${scope}/groups/:groupJid/messages`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const groupJid = decodeURIComponent((request.params as { groupJid: string }).groupJid);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const key = headerValue(request.headers["idempotency-key"]);
    if (!key || key.length > 200) return reply.code(400).send({ success: false, error: "Idempotency-Key is required" });
    const options = readSendOptions(body);
    const mediaId = typeof body.mediaId === "string" ? body.mediaId : null;
    const text = typeof body.message === "string" ? body.message : null;
    const caption = typeof body.caption === "string" ? body.caption : null;
    if (!mediaId && !text) return reply.code(400).send({ success: false, error: "message or mediaId is required" });

    return send(reply, {
      deps,
      deviceId: id,
      key,
      fingerprint: sendFingerprint({ groupJid, mediaId, text, caption, options }),
      safetyTarget: groupJid,
      safetyContent: `${mediaId ?? ""}${text ?? caption ?? ""}`,
      run: async () => {
        if (!mediaId) return engine.devices.sendGroupTextWithDevice(id, groupJid, text!, options);
        // The caption is the message: Kirim SQ sends a group announcement as a file plus its text.
        const media = await requireMedia(deps, id, mediaId, caption);
        return engine.devices.sendGroupMediaWithDevice(id, groupJid, media, options);
      },
    });
  });

  // ------------------------------------------------------- actions on a message that exists

  app.post(`${scope}/messages/:waId/:action`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const { waId, action } = request.params as { waId: string; action: string };
    if (action !== "reaction" && action !== "edit" && action !== "delete") {
      return reply.code(404).send({ success: false, error: "Unknown action" });
    }
    const key = headerValue(request.headers["idempotency-key"]);
    if (!key || key.length > 200) return reply.code(400).send({ success: false, error: "Idempotency-Key is required" });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const chatJid = readActionChat(body);
    if (!chatJid) return reply.code(400).send({ success: false, error: "Invalid recipient" });
    const messageId = decodeURIComponent(waId);

    let messageAction: MessageAction;
    if (action === "reaction") {
      const emoji = typeof body.emoji === "string" ? body.emoji : null;
      if (emoji === null || [...emoji].length > 16) return reply.code(400).send({ success: false, error: "Invalid emoji" });
      messageAction = {
        kind: "reaction",
        chatJid,
        target: { id: messageId, fromMe: body.fromMe === true, participant: typeof body.participant === "string" ? body.participant : null },
        emoji,
      };
    } else if (action === "edit") {
      const text = typeof body.message === "string" ? body.message : "";
      if (!text) return reply.code(400).send({ success: false, error: "message is required" });
      messageAction = { kind: "edit", chatJid, target: { id: messageId }, text };
    } else {
      messageAction = { kind: "delete", chatJid, target: { id: messageId } };
    }

    const claim = await idempotency.claim(id, key, sendFingerprint({ action, messageId, chatJid, body }));
    if (claim.kind === "conflict") return reply.code(409).send({ success: false, code: "idempotency_key_conflict", error: "Idempotency-Key reused with a different request" });
    if (claim.kind === "in_progress") return reply.code(409).send({ success: false, code: "idempotency_request_in_progress", error: "An identical request is in progress" });
    if (claim.kind === "replay") return reply.send({ success: true, messageId: claim.result.whatsappMessageId });
    try {
      const result = await engine.devices.sendMessageActionWithDevice(id, messageAction);
      await idempotency.succeed(id, key, { whatsappMessageId: result.messageId ?? messageId, sentAt: new Date().toISOString() });
      return reply.send({ success: true, messageId: result.messageId ?? messageId });
    } catch (error) {
      await idempotency.fail(id, key);
      return sendError(reply, error, deps);
    }
  });

  // --------------------------------------------------------------------------- read receipts

  app.post(`${scope}/messages/read`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const messages = (request.body as { messages?: unknown })?.messages;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
      return reply.code(400).send({ success: false, error: "messages must hold 1 to 100 keys" });
    }
    const keys = messages.flatMap((item) => {
      const value = item as { remoteJid?: unknown; whatsappMessageId?: unknown };
      return typeof value?.remoteJid === "string" && typeof value?.whatsappMessageId === "string"
        ? [{ remoteJid: value.remoteJid, whatsappMessageId: value.whatsappMessageId }]
        : [];
    });
    if (keys.length === 0) return reply.code(400).send({ success: false, error: "no usable message keys" });
    try {
      await engine.devices.markMessagesReadWithDevice(id, keys);
      return reply.send({ success: true, marked: keys.length });
    } catch (error) {
      return sendError(reply, error, deps);
    }
  });

  // ---------------------------------------------------------------------------------- events

  app.get(`${scope}/events`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const query = request.query as { after?: unknown; limit?: unknown };
    const after = cursorOf(query.after, 0);
    const limit = cursorOf(query.limit, DEFAULT_EVENT_LIMIT);
    if (after === null || limit === null || limit < 1 || limit > MAX_EVENT_LIMIT) {
      return reply.code(400).send({ success: false, error: "Invalid event recovery cursor or limit" });
    }
    const page = await stores.events.list(id, after, limit);
    return reply.send(page);
  });

  // -------------------------------------------------------------------------------- contacts

  app.get(`${scope}/contacts`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const query = request.query as { page?: unknown; pageSize?: unknown };
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize ?? 200) || 200));
    const result = await stores.contacts.list(id, page, pageSize);
    return reply.send({ success: true, contacts: result.contacts, pagination: { page, pageSize, totalPages: result.totalPages } });
  });

  app.get(`${scope}/profile-picture`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const jid = String((request.query as { jid?: unknown })?.jid ?? "").trim();
    if (!jid) return reply.code(400).send({ success: false, error: "jid is required" });
    try {
      const photo = await engine.devices.getProfilePictureWithDevice(id, jid);
      if (!photo) return reply.code(404).send({ success: false, code: "profile_picture_unavailable", error: "No profile picture" });
      if (photo.length > PROFILE_PICTURE_MAX_BYTES) {
        return reply.code(502).send({ success: false, error: "Profile picture larger than expected" });
      }
      return reply.header("content-type", "image/jpeg").send(photo);
    } catch (error) {
      return sendError(reply, error, deps);
    }
  });

  await registerGroupRoutes(app, scope, deps, deviceId, noTenant);
  await registerHistoryRoutes(app, scope, deps, deviceId, noTenant);
  await registerBusinessRoutes(app, scope, deps, deviceId, noTenant);
}

// ================================================================================ sends

interface SendPlan {
  deps: PlatformRouteDeps;
  deviceId: string;
  key: string;
  fingerprint: string;
  safetyTarget: string;
  safetyContent: string;
  run: () => Promise<{ messageId: string | null }>;
}

/**
 * The shape of every send: claim the idempotency key, pass the engine's own safety gate, send,
 * and store the WhatsApp message id so a retry with the same key never sends twice.
 */
async function send(reply: FastifyReply, plan: SendPlan): Promise<FastifyReply> {
  const { deps, deviceId, key } = plan;
  const claim = await deps.idempotency.claim(deviceId, key, plan.fingerprint);
  if (claim.kind === "conflict") {
    return reply.code(409).send({ success: false, code: "idempotency_key_conflict", error: "Idempotency-Key reused with a different request" });
  }
  if (claim.kind === "in_progress") {
    return reply.code(409).send({ success: false, code: "idempotency_request_in_progress", error: "An identical request is in progress" });
  }
  if (claim.kind === "replay") {
    return reply.send({ success: true, messageId: claim.result.whatsappMessageId, sentAt: claim.result.sentAt });
  }
  let release: (() => void) | null = null;
  try {
    release = deps.engine.sendSafety.acquire(deviceId, plan.safetyTarget, plan.safetyContent);
    const result = await plan.run();
    const sentAt = new Date().toISOString();
    if (!result.messageId) {
      // WhatsApp accepted nothing we can name. Treat it as not done so the caller may retry.
      await deps.idempotency.fail(deviceId, key);
      return reply.code(502).send({ success: false, error: "WhatsApp did not return a message id" });
    }
    await deps.idempotency.succeed(deviceId, key, { whatsappMessageId: result.messageId, sentAt });
    return reply.send({ success: true, messageId: result.messageId, sentAt });
  } catch (error) {
    await deps.idempotency.fail(deviceId, key);
    return sendError(reply, error, deps);
  } finally {
    release?.();
  }
}

async function sendText(deps: PlatformRouteDeps, deviceId: string, target: Target, text: string, options: SendOptions) {
  return target.kind === "phone"
    ? deps.engine.devices.sendTextWithDevice(deviceId, target.phone, text, options)
    : deps.engine.devices.sendTextToJidWithDevice(deviceId, target.jid, text, options);
}

async function sendMedia(deps: PlatformRouteDeps, deviceId: string, target: Target, mediaId: string, caption: string | null, options: SendOptions) {
  const media = await requireMedia(deps, deviceId, mediaId, caption);
  return target.kind === "phone"
    ? deps.engine.devices.sendMediaWithDevice(deviceId, target.phone, media, options)
    : deps.engine.devices.sendMediaToIndividualJidWithDevice(deviceId, target.jid, media, options);
}

class MediaMissingError extends Error {
  constructor() {
    super("Media not found");
    this.name = "MediaMissingError";
  }
}

async function requireMedia(deps: PlatformRouteDeps, deviceId: string, mediaId: string, caption: string | null = null) {
  const record = await deps.stores.media.find(deviceId, mediaId);
  if (!record) throw new MediaMissingError();
  return {
    mediaType: record.mediaType,
    mimeType: record.mimeType,
    originalFilename: record.originalFilename,
    caption,
    data: bufferToStream(await deps.stores.media.read(record)),
  };
}

// ================================================================================ groups

type DeviceIdOf = (request: FastifyRequest) => string | null;
type NoTenant = (reply: FastifyReply) => FastifyReply;

async function registerGroupRoutes(app: FastifyInstance, scope: string, deps: PlatformRouteDeps, deviceId: DeviceIdOf, noTenant: NoTenant): Promise<void> {
  const { engine } = deps;
  const jidOf = (request: FastifyRequest) => decodeURIComponent((request.params as { groupJid: string }).groupJid);

  app.get(`${scope}/groups`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const groups = await engine.devices.listJoinedGroups(id);
      return reply.send({ success: true, groups: groups.map(groupBody) });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.post(`${scope}/groups`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const body = (request.body ?? {}) as { subject?: unknown; participants?: unknown };
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const participants = Array.isArray(body.participants) ? body.participants.filter((item): item is string => typeof item === "string") : [];
    if (!subject || participants.length === 0) return reply.code(400).send({ success: false, error: "subject and participants are required" });
    try {
      const group = await engine.devices.createGroup(id, subject, participants);
      return reply.code(201).send({ success: true, group: groupBody(group) });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.get(`${scope}/groups/:groupJid`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const group = await engine.devices.getGroupMetadata(id, jidOf(request));
      return reply.send({ success: true, group: groupBody(group) });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.post(`${scope}/groups/:groupJid/participants`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const body = (request.body ?? {}) as { action?: unknown; participants?: unknown };
    const action = body.action;
    if (action !== "add" && action !== "remove" && action !== "promote" && action !== "demote") {
      return reply.code(400).send({ success: false, error: "Invalid action" });
    }
    const participants = Array.isArray(body.participants) ? body.participants.filter((item): item is string => typeof item === "string") : [];
    if (participants.length === 0) return reply.code(400).send({ success: false, error: "participants are required" });
    try {
      const updates = await engine.devices.updateGroupParticipants(id, jidOf(request), participants, action);
      // The group is read again right after the change, so Kirim SQ can store the membership it produced.
      const group = await engine.devices.getGroupMetadata(id, jidOf(request)).catch(() => null);
      return reply.send({ success: true, updates, group: group ? groupBody(group) : null });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.patch(`${scope}/groups/:groupJid/subject`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const subject = typeof (request.body as { subject?: unknown })?.subject === "string" ? (request.body as { subject: string }).subject.trim() : "";
    if (!subject) return reply.code(400).send({ success: false, error: "subject is required" });
    try {
      const group = await engine.devices.updateGroupSubject(id, jidOf(request), subject);
      return reply.send({ success: true, group: groupBody(group) });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.patch(`${scope}/groups/:groupJid/description`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const raw = (request.body as { description?: unknown })?.description;
    const description = typeof raw === "string" ? raw : undefined;
    try {
      const group = await engine.devices.updateGroupDescription(id, jidOf(request), description);
      return reply.send({ success: true, group: groupBody(group) });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.get(`${scope}/groups/:groupJid/invite`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const code = await engine.devices.getGroupInviteCode(id, jidOf(request));
      if (!code) return reply.code(502).send({ success: false, error: "WhatsApp did not return an invite code" });
      return reply.send({ success: true, code });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.post(`${scope}/groups/:groupJid/invite/revoke`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const code = await engine.devices.revokeGroupInvite(id, jidOf(request));
      if (!code) return reply.code(502).send({ success: false, error: "WhatsApp did not return an invite code" });
      return reply.send({ success: true, code });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.post(`${scope}/groups/:groupJid/settings`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const setting = (request.body as { setting?: unknown })?.setting;
    if (!isGroupSetting(setting)) return reply.code(400).send({ success: false, error: "Invalid setting" });
    try {
      await engine.devices.updateGroupSetting(id, jidOf(request), setting);
      return reply.send({ success: true });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.get(`${scope}/groups/:groupJid/requests`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const requests = await engine.devices.listGroupJoinRequests(id, jidOf(request));
      return reply.send({ success: true, requests });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.post(`${scope}/groups/:groupJid/requests`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const body = (request.body ?? {}) as { participants?: unknown; action?: unknown };
    const participants = Array.isArray(body.participants) ? body.participants.filter((item): item is string => typeof item === "string") : [];
    if (participants.length === 0 || (body.action !== "approve" && body.action !== "reject")) {
      return reply.code(400).send({ success: false, error: "participants and action are required" });
    }
    try {
      const updates = await engine.devices.updateGroupJoinRequests(id, jidOf(request), participants, body.action);
      return reply.send({ success: true, updates });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.put(`${scope}/groups/:groupJid/picture`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const image = decodeImage((request.body as { image?: unknown })?.image);
    if (!image) return reply.code(400).send({ success: false, error: "image is required" });
    try {
      await engine.devices.updateGroupPicture(id, jidOf(request), image);
      return reply.send({ success: true });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.delete(`${scope}/groups/:groupJid/picture`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      await engine.devices.updateGroupPicture(id, jidOf(request), null);
      return reply.send({ success: true });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });

  app.post(`${scope}/groups/:groupJid/leave`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      await engine.devices.leaveGroup(id, jidOf(request));
      return reply.send({ success: true });
    } catch (error) {
      return groupError(reply, error, deps);
    }
  });
}

// ================================================================================ history

async function registerHistoryRoutes(app: FastifyInstance, scope: string, deps: PlatformRouteDeps, deviceId: DeviceIdOf, noTenant: NoTenant): Promise<void> {
  const { engine, stores } = deps;

  app.post(`${scope}/history-imports`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const body = (request.body ?? {}) as { chatJid?: unknown; maxMessages?: unknown; source?: unknown };
    const chatJid = typeof body.chatJid === "string" ? body.chatJid.trim() : "";
    if (!chatJid) return reply.code(400).send({ success: false, error: "chatJid is required" });

    // KIRIM-IMPL-002 §10.3: an import from the copy WhatsApp already pushed. Nothing is asked of
    // WhatsApp, so it is complete the moment it is made.
    if (body.source === "stored") {
      if (!(await stores.messages.hasChat(id, chatJid))) {
        return reply.code(409).send({ success: false, code: "no_anchor", error: "No stored message for this chat" });
      }
      const record = await stores.imports.create({ kode: id, chatJid, source: "stored", state: "completed" });
      return reply.code(201).send({ success: true, historyImport: { id: record.id, status: "completed" } });
    }

    const anchor = await stores.messages.oldestAnchor(id, chatJid);
    if (!anchor) return reply.code(409).send({ success: false, code: "no_anchor", error: "No stored message to ask from" });
    const count = Math.min(500, Math.max(1, Number(body.maxMessages ?? 50) || 50));
    try {
      const providerRequestId = await engine.devices.requestMessageHistory(id, {
        count,
        remoteJid: chatJid,
        whatsappMessageId: anchor.whatsappMessageId,
        fromMe: anchor.fromMe,
        timestampMs: anchor.timestampMs,
      });
      const record = await stores.imports.create({ kode: id, chatJid, source: "whatsapp", state: "awaiting", providerRequestId });
      return reply.code(202).send({ success: true, historyImport: { id: record.id, status: "awaiting" } });
    } catch (error) {
      return sendError(reply, error, deps);
    }
  });

  app.get(`${scope}/history-imports/:importId`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const record = await stores.imports.find(id, (request.params as { importId: string }).importId);
    if (!record) return reply.code(404).send({ success: false, error: "History import not found" });
    return reply.send({ success: true, historyImport: { id: record.id, status: record.state, ...(record.reason ? { error: record.reason } : {}) } });
  });

  app.get(`${scope}/history-imports/:importId/messages`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const record = await stores.imports.find(id, (request.params as { importId: string }).importId);
    if (!record) return reply.code(404).send({ success: false, error: "History import not found" });
    const query = request.query as { page?: unknown; pageSize?: unknown };
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize ?? 100) || 100));
    const result = await stores.messages.messagesForChat(id, record.chatJid, page - 1, pageSize);
    return reply.send({
      success: true,
      messages: result.messages.map((message) => ({
        whatsappMessageId: message.whatsappMessageId,
        direction: message.direction,
        chatJid: message.chatJid,
        senderJid: message.senderJid,
        messageType: message.messageType,
        body: message.body,
        occurredAt: message.occurredAt,
        media: message.media,
      })),
      pagination: { page, pageSize, totalPages: result.hasMore ? page + 1 : page },
    });
  });

  app.get(`${scope}/history-chats`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const query = request.query as { page?: unknown; pageSize?: unknown };
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize ?? 200) || 200));
    const result = await stores.messages.historyChats(id, page - 1, pageSize);
    return reply.send({
      success: true,
      chats: result.chats.map((chat) => ({ chatJid: chat.chatJid, phone: chat.phoneDigits, messageCount: chat.messageCount })),
      pagination: { page, pageSize, totalPages: result.hasMore ? page + 1 : page },
    });
  });
}

// ================================================================= WhatsApp Business

async function registerBusinessRoutes(app: FastifyInstance, scope: string, deps: PlatformRouteDeps, deviceId: DeviceIdOf, noTenant: NoTenant): Promise<void> {
  const { engine, stores } = deps;

  app.get(`${scope}/quick-replies`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    return reply.send({ success: true, quickReplies: stores.phoneState.quickReplies(id) });
  });

  app.put(`${scope}/quick-replies/:waId`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const raw = decodeURIComponent((request.params as { waId: string }).waId);
    const waId = raw === "baru" ? null : raw;
    const body = (request.body ?? {}) as { shortcut?: unknown; message?: unknown };
    const shortcut = typeof body.shortcut === "string" ? body.shortcut.trim() : "";
    const message = typeof body.message === "string" ? body.message : "";
    if (!shortcut || !message) return reply.code(400).send({ success: false, error: "shortcut and message are required" });
    try {
      const resultId = await engine.devices.upsertQuickReply(id, waId, shortcut, message);
      return reply.send({ success: true, waId: resultId });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.delete(`${scope}/quick-replies/:waId`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      await engine.devices.removeQuickReply(id, decodeURIComponent((request.params as { waId: string }).waId));
      return reply.send({ success: true });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.post(`${scope}/quick-replies/resync`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    if (!engine.mayResyncQuickReplies(id)) return reply.send({ success: true, resynced: false });
    try {
      const resynced = await engine.devices.resyncQuickReplies(id);
      return reply.send({ success: true, resynced });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.put(`${scope}/business-hours`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const hours = request.body as BusinessHours;
    if (!hours || typeof hours.timezone !== "string" || !Array.isArray(hours.days)) {
      return reply.code(400).send({ success: false, error: "timezone and days are required" });
    }
    try {
      const result = await engine.devices.updateBusinessHours(id, hours);
      return reply.send({ success: true, applied: true, verified: result.verified });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.put(`${scope}/chat-labels`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const body = (request.body ?? {}) as { chatJid?: unknown; altJid?: unknown; managed?: unknown; labels?: unknown };
    const chatJid = typeof body.chatJid === "string" ? body.chatJid : "";
    if (!chatJid) return reply.code(400).send({ success: false, error: "chatJid is required" });
    const chatJids = [chatJid, typeof body.altJid === "string" && body.altJid ? body.altJid : null].filter((jid): jid is string => Boolean(jid));
    const managed = stringList(body.managed);
    const wanted = stringList(body.labels);
    try {
      const labels = await engine.devices.applyChatLabels(id, { chatJids, managed, wanted }, stores.phoneState.labelStore(id));
      return reply.send({ success: true, labels });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.get(`${scope}/catalog`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const cursor = typeof (request.query as { cursor?: unknown })?.cursor === "string" ? (request.query as { cursor: string }).cursor : null;
    try {
      const page = await engine.devices.listCatalog(id, cursor);
      return reply.send({ success: true, products: page.products, nextCursor: page.nextCursor, catalog: page.catalog });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.get(`${scope}/business-profile`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      return reply.send({ success: true, profile: await engine.devices.getBusinessProfile(id) });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.patch(`${scope}/business-profile`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const result = await engine.devices.updateBusinessProfile(id, (request.body ?? {}) as Record<string, never>);
      return reply.send({ success: true, applied: true, verified: result.verified, profile: result.profile });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.put(`${scope}/business-profile/picture`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const image = decodeImage((request.body as { image?: unknown })?.image);
    if (!image) return reply.code(400).send({ success: false, error: "image is required" });
    try {
      const result = await engine.devices.updateOwnProfilePicture(id, image);
      return reply.send({ success: true, applied: true, verified: result.verified });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.delete(`${scope}/business-profile/picture`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const result = await engine.devices.updateOwnProfilePicture(id, null);
      return reply.send({ success: true, applied: true, verified: result.verified });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.put(`${scope}/business-profile/cover-photo`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const image = decodeImage((request.body as { image?: unknown })?.image);
    if (!image) return reply.code(400).send({ success: false, error: "image is required" });
    try {
      const result = await engine.devices.updateCoverPhoto(id, image);
      return reply.send({ success: true, id: result.id, verified: result.verified });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.delete(`${scope}/business-profile/cover-photo`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    const coverId = typeof (request.query as { id?: unknown })?.id === "string" ? (request.query as { id: string }).id : null;
    try {
      const result = await engine.devices.removeCoverPhoto(id, coverId);
      return reply.send({ success: true, id: result.id });
    } catch (error) {
      if (error instanceof WhatsAppCoverPhotoUnknownError) {
        return reply.code(409).send({ success: false, code: "cover_photo_unknown", error: error.message });
      }
      return businessError(reply, error, deps);
    }
  });

  app.post(`${scope}/catalog/products`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const result = await engine.devices.createCatalogProduct(id, readProductInput(request.body));
      return reply.send({ success: true, product: result.product, verified: result.verified });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.put(`${scope}/catalog/products/:productId`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const result = await engine.devices.updateCatalogProduct(id, (request.params as { productId: string }).productId, readProductInput(request.body));
      return reply.send({ success: true, product: result.product, verified: result.verified });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });

  app.delete(`${scope}/catalog/products/:productId`, async (request, reply) => {
    const id = deviceId(request);
    if (!id) return noTenant(reply);
    try {
      const result = await engine.devices.deleteCatalogProduct(id, (request.params as { productId: string }).productId);
      return reply.send({ success: true, deleted: result.deleted });
    } catch (error) {
      return businessError(reply, error, deps);
    }
  });
}

// ================================================================================ helpers

type Target = { kind: "phone"; phone: string } | { kind: "jid"; jid: string };

function readTarget(body: Record<string, unknown>): Target | null {
  if (typeof body.to === "string") {
    const phone = body.to.replace(/\D/g, "");
    return PHONE_PATTERN.test(phone) ? { kind: "phone", phone } : null;
  }
  if (typeof body.toJid === "string" && body.toJid.trim()) return { kind: "jid", jid: body.toJid.trim() };
  return null;
}

function targetLabel(target: Target): string {
  return target.kind === "phone" ? target.phone : target.jid;
}

function readActionChat(body: Record<string, unknown>): string | null {
  if (typeof body.groupJid === "string" && body.groupJid.trim()) return body.groupJid.trim();
  const target = readTarget(body);
  if (!target) return null;
  return target.kind === "phone" ? `${target.phone}@s.whatsapp.net` : target.jid;
}

function readSendOptions(body: Record<string, unknown>): SendOptions {
  const options: SendOptions = {};
  const quoted = body.quoted as Record<string, unknown> | undefined;
  if (quoted && typeof quoted.id === "string" && quoted.id) {
    options.quoted = {
      id: quoted.id,
      fromMe: quoted.fromMe === true,
      participant: typeof quoted.participant === "string" ? quoted.participant : null,
      text: typeof quoted.text === "string" ? quoted.text : null,
      messageType: isQuotedType(quoted.messageType) ? quoted.messageType : "text",
    };
  }
  if (body.forwarded === true) options.forwarded = true;
  const mentions = stringList(body.mentions);
  if (mentions.length > 0) options.mentions = mentions;
  return options;
}

function isQuotedType(value: unknown): value is "text" | "image" | "video" | "audio" | "document" | "sticker" {
  return value === "text" || value === "image" || value === "video" || value === "audio" || value === "document" || value === "sticker";
}

function isGroupSetting(value: unknown): value is WhatsAppGroupSetting {
  return (
    value === "announcement" || value === "not_announcement" || value === "locked" || value === "unlocked" ||
    value === "member_add_all" || value === "member_add_admin" || value === "approval_on" || value === "approval_off"
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function decodeImage(value: unknown): Buffer | null {
  if (typeof value !== "string" || !value) return null;
  const data = Buffer.from(value, "base64");
  return data.length > 0 ? data : null;
}

function readProductInput(body: unknown): Parameters<WaEngine["devices"]["createCatalogProduct"]>[1] {
  const value = (body ?? {}) as Record<string, unknown>;
  return {
    name: typeof value.name === "string" ? value.name : "",
    description: typeof value.description === "string" ? value.description : null,
    price: typeof value.price === "number" ? value.price : null,
    currency: typeof value.currency === "string" ? value.currency : null,
    url: typeof value.url === "string" ? value.url : null,
    retailerId: typeof value.retailerId === "string" ? value.retailerId : null,
    hidden: value.hidden === true,
    images: Array.isArray(value.images)
      ? value.images.flatMap((image) => {
          const decoded = decodeImage(image);
          return decoded ? [decoded] : [];
        })
      : null,
    originCountryCode: typeof value.originCountryCode === "string" ? value.originCountryCode : null,
  };
}

function deviceBody(device: { id: string; name: string; whatsappPhone: string | null; whatsappJid: string | null; pairedAt: string | null; lastConnectedAt: string | null }, liveState: unknown) {
  return {
    id: device.id,
    name: device.name,
    whatsappPhone: device.whatsappPhone,
    whatsappJid: device.whatsappJid,
    pairedAt: device.pairedAt,
    lastConnectedAt: device.lastConnectedAt,
    liveState,
  };
}

function groupBody(group: WhatsAppGroupMetadata) {
  return {
    id: group.id,
    subject: group.subject,
    owner: group.owner,
    description: group.description,
    size: group.size,
    participants: group.participants,
    ...(group.settings ? { settings: group.settings } : {}),
  };
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function headerValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim() || null;
  return null;
}

function cursorOf(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Everything about one number is dropped when its session ends: the next session may be another phone. */
async function forgetNumber(stores: EngineStores, deviceId: string): Promise<void> {
  stores.phoneState.forget(deviceId);
  await stores.messages.forgetDevice(deviceId);
  await stores.contacts.forgetDevice(deviceId);
}

// --------------------------------------------------------------------------- error mapping

function lifecycleError(reply: FastifyReply, error: unknown, deps: PlatformRouteDeps): FastifyReply {
  if (error instanceof WhatsAppSessionResetRequiredError) {
    // Kirim SQ reads `recoveryAction: "reset"` as "ask the admin to reconnect this number".
    return reply.code(409).send({ success: false, recoveryAction: "reset", error: error.message });
  }
  if (error instanceof DeviceCapacityError) {
    return reply.code(409).send({ success: false, error: "Configured active device safety cap reached" });
  }
  if (error instanceof DeviceParkedError) {
    return reply.code(409).send({ success: false, code: "device_parked", error: "This number is parked on this engine" });
  }
  if (error instanceof WhatsAppPairingUnavailableError) {
    return reply.code(409).send({ success: false, error: error.message });
  }
  if (error instanceof DeviceNotFoundError || error instanceof TenantDeviceNotFoundError) {
    return reply.code(404).send({ success: false, error: "Tenant device not found" });
  }
  deps.log({ event: "kirim_wa.lifecycle.failed", errorType: error instanceof Error ? error.name : "unknown" }, "device lifecycle call failed");
  return reply.code(502).send({ success: false, error: "WhatsApp lifecycle operation failed" });
}

function sendError(reply: FastifyReply, error: unknown, deps: PlatformRouteDeps): FastifyReply {
  if (error instanceof MediaMissingError) return reply.code(404).send({ success: false, error: "Media not found" });
  if (error instanceof SendSafetyError) return reply.code(429).send({ success: false, code: error.code, error: error.message });
  if (error instanceof WhatsAppNotConnectedError) {
    // Kirim SQ reads a 409 on a send as "the number is disconnected" and holds the message.
    return reply.code(409).send({ success: false, error: "WhatsApp is not connected" });
  }
  if (error instanceof InvalidWhatsAppIndividualJidError) return reply.code(400).send({ success: false, error: "Invalid recipient JID" });
  if (error instanceof InvalidWhatsAppGroupJidError) return reply.code(400).send({ success: false, error: "Invalid group JID" });
  if (error instanceof WhatsAppGroupNotFoundError) return reply.code(404).send({ success: false, error: "WhatsApp group not found for this device" });
  if (error instanceof WhatsAppSessionResetRequiredError) {
    return reply.code(409).send({ success: false, recoveryAction: "reset", error: error.message });
  }
  if (error instanceof DeviceNotFoundError || error instanceof TenantDeviceNotFoundError) {
    return reply.code(404).send({ success: false, error: "Tenant device not found" });
  }
  deps.log({ event: "kirim_wa.send.failed", errorType: error instanceof Error ? error.name : "unknown" }, "send failed");
  return reply.code(502).send({ success: false, error: "WhatsApp send failed" });
}

function groupError(reply: FastifyReply, error: unknown, deps: PlatformRouteDeps): FastifyReply {
  if (error instanceof InvalidWhatsAppGroupJidError) return reply.code(400).send({ success: false, error: "Invalid group JID" });
  if (error instanceof WhatsAppGroupNotFoundError) {
    return reply.code(404).send({ success: false, error: "WhatsApp group not found for this device" });
  }
  if (error instanceof WhatsAppNotConnectedError) return reply.code(503).send({ success: false, error: "WhatsApp is not connected" });
  // WhatsApp refuses an admin operation with a 401/403 when this number is not an admin of the
  // group. That is the caller's state, not an engine failure, so it is named rather than a 502.
  if (isWhatsAppForbidden(error)) {
    return reply.code(403).send({ success: false, code: "not_group_admin", error: "WhatsApp refused: this number is not a group admin" });
  }
  return sendError(reply, error, deps);
}

function businessError(reply: FastifyReply, error: unknown, deps: PlatformRouteDeps): FastifyReply {
  if (error instanceof WhatsAppOutcomeUnknownError) {
    // §17.3: the change may have been applied; Kirim SQ must check before trying again.
    return reply.code(502).send({ success: false, code: "whatsapp_outcome_unknown", error: error.message });
  }
  if (error instanceof WhatsAppCatalogMissingError) {
    return reply.code(422).send({ success: false, code: "catalog_missing", error: error.message });
  }
  if (error instanceof WhatsAppLabelsUnreadError) {
    return reply.code(409).send({ success: false, code: "labels_unread", error: error.message });
  }
  return sendError(reply, error, deps);
}

export function isWhatsAppForbidden(error: unknown): boolean {
  const value = error as { output?: { statusCode?: unknown }; data?: { attrs?: { code?: unknown } } } | null;
  const status = value?.output?.statusCode;
  const code = value?.data?.attrs?.code;
  return status === 401 || status === 403 || code === "401" || code === "403";
}

export type { MediaType };
