/**
 * Provider-neutral changes to messages that already exist (edits, revokes, reactions) and
 * call logs, normalized from Baileys rc14 events. Pure functions plus one small in-memory
 * aggregator so the socket wiring stays thin and everything here is unit-testable.
 *
 * JalurPesan never rejects or answers calls: this module only observes them.
 */
import {
  areJidsSameUser,
  isJidGroup,
  normalizeMessageContent,
  proto,
  WAMessageStubType,
  type WACallEvent,
  type WAMessageUpdate,
} from "@whiskeysockets/baileys";

export interface MessageChangeBase {
  /** WhatsApp id of the message that was edited, revoked, or reacted to. */
  whatsappMessageId: string;
  chatJid: string;
  peerJidAlt: string | null;
  /** Who made the change: the editor, the revoker, or the person reacting. */
  senderJid: string | null;
  /** True when the change was made by this WhatsApp account (its phone or any linked device). */
  fromMe: boolean;
  recipientType: "individual" | "group";
}

export type ProviderMessageChange =
  | (MessageChangeBase & { type: "edited"; body: string | null; occurredAt: string })
  | (MessageChangeBase & { type: "deleted"; occurredAt: string })
  | (MessageChangeBase & {
      type: "reaction";
      emoji: string;
      /** Identifies one reaction of one sender, so a re-delivered event is recognized. */
      reactionKey: string;
      occurredAt: string;
    });

export type CallOutcome = "answered_elsewhere" | "rejected" | "missed";

export interface ProviderCallLog {
  type: "call";
  callId: string;
  chatJid: string;
  fromJid: string;
  callerPnJid: string | null;
  isVideo: boolean;
  isGroup: boolean;
  groupJid: string | null;
  offline: boolean;
  outcome: CallOutcome;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string;
  durationSeconds: number | null;
  /** True for a call this account placed itself (from its phone); false for incoming calls. */
  fromMe: boolean;
  /**
   * 1 for the first log. A call first logged `missed` after the silence window is logged again
   * (2) when a later accept, reject, or terminate shows what really happened; consumers keep the
   * highest revision per `callId`.
   */
  revision: number;
  /** Baileys statuses seen for this call, in order, so the linked-device spike can be audited. */
  providerStatuses: string[];
}

export type ProviderChangeEvent = ProviderMessageChange | ProviderCallLog;
export type ProviderChangeListener = (event: ProviderChangeEvent) => void;

/** Edits and revokes arrive as `messages.update` (Baileys process-message.js, MESSAGE_EDIT/REVOKE). */
export function normalizeMessageUpdateChange(
  update: WAMessageUpdate,
  ownJid: string | null,
  fallbackTimestamp: string,
): ProviderMessageChange | null {
  const key = update.key;
  const whatsappMessageId = nonEmpty(key?.id);
  const chatJid = nonEmpty(key?.remoteJid)?.toLowerCase() ?? null;
  if (!whatsappMessageId || !chatJid) return null;
  const recipientType = isJidGroup(chatJid) ? "group" : "individual";
  if (recipientType === "individual" && ownJid && areJidsSameUser(chatJid, ownJid)) return null;

  const content = update.update;
  const edited = content?.message?.editedMessage?.message;
  if (edited) {
    const fromMe = key.fromMe === true;
    return {
      type: "edited",
      whatsappMessageId,
      chatJid,
      peerJidAlt: nonEmpty(key.remoteJidAlt),
      senderJid: changeAuthor(key, chatJid, fromMe, ownJid),
      fromMe,
      recipientType,
      body: textOf(edited),
      occurredAt: secondsToIso(content.messageTimestamp, fallbackTimestamp),
    };
  }
  if (content?.messageStubType === WAMessageStubType.REVOKE && content.message === null) {
    // `update.key` is the revoking protocol message: it names who deleted, which in a group can
    // be an admin rather than the original sender.
    const revoker = (content.key ?? key) as WAMessageUpdate["key"];
    const fromMe = revoker.fromMe === true;
    return {
      type: "deleted",
      whatsappMessageId,
      chatJid,
      peerJidAlt: nonEmpty(key.remoteJidAlt),
      senderJid: changeAuthor(revoker, chatJid, fromMe, ownJid),
      fromMe,
      recipientType,
      occurredAt: fallbackTimestamp,
    };
  }
  return null;
}

/** `messages.reaction`: `key` is the target message, `reaction.key` the reacting message. */
export function normalizeReaction(
  event: { key: WAMessageUpdate["key"]; reaction: proto.IReaction },
  ownJid: string | null,
  fallbackTimestamp: string,
): ProviderMessageChange | null {
  const target = event.key;
  const reactor = event.reaction?.key;
  const whatsappMessageId = nonEmpty(target?.id);
  const chatJid =
    (nonEmpty(reactor?.remoteJid) ?? nonEmpty(target?.remoteJid))?.toLowerCase() ?? null;
  if (!whatsappMessageId || !chatJid || !reactor) return null;
  const recipientType = isJidGroup(chatJid) ? "group" : "individual";
  if (recipientType === "individual" && ownJid && areJidsSameUser(chatJid, ownJid)) return null;
  const fromMe = reactor.fromMe === true;
  const senderJid = changeAuthor(reactor, chatJid, fromMe, ownJid);
  const sentMs = toNumber(event.reaction.senderTimestampMs);
  const occurredAt =
    sentMs !== null && sentMs > 0 ? new Date(sentMs).toISOString() : fallbackTimestamp;
  const emoji = typeof event.reaction.text === "string" ? event.reaction.text.slice(0, 32) : "";
  return {
    type: "reaction",
    whatsappMessageId,
    chatJid,
    peerJidAlt:
      nonEmpty((reactor as WAMessageUpdate["key"]).remoteJidAlt) ?? nonEmpty(target.remoteJidAlt),
    senderJid,
    fromMe,
    recipientType,
    emoji,
    reactionKey: nonEmpty(reactor.id) ?? `${senderJid ?? "unknown"}:${sentMs ?? occurredAt}`,
    occurredAt,
  };
}

/** WhatsApp/linked devices ring for roughly a minute; silence after that means nobody answered. */
export const CALL_SILENCE_TIMEOUT_MS = 90_000;
/** An answered call with no termination notice is closed after this, so memory stays bounded. */
export const ANSWERED_CALL_MAX_MS = 4 * 60 * 60 * 1_000;

interface PendingCall {
  callId: string;
  chatJid: string;
  fromJid: string;
  callerPnJid: string | null;
  isVideo: boolean;
  isGroup: boolean;
  groupJid: string | null;
  offline: boolean;
  startedAt: string;
  answeredAt: string | null;
  rejectedAt: string | null;
  /** Ended by terminate after the silence window: it lasted, so it was answered on another device. */
  answeredLate: boolean;
  /** Answered on another device: this device never learns when the call ended. */
  durationUnknown: boolean;
  revision: number;
  statuses: string[];
  timer: ReturnType<typeof setTimeout> | null;
}

const MAX_CALL_STATUSES = 32;
/** Raw note for `<terminate reason="accepted_elsewhere">`, seen live on 2026-11-05. */
const ACCEPTED_ELSEWHERE_NOTE = "raw:terminate:accepted_elsewhere";

export interface CallAggregatorClock {
  now(): string;
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const realClock: CallAggregatorClock = {
  now: () => new Date().toISOString(),
  setTimeout: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    timer.unref?.();
    return timer;
  },
  clearTimeout: (timer) => clearTimeout(timer),
};

/**
 * Joins Baileys `call` updates by call id and emits exactly one log when the call ends.
 * Observation only: this class has no access to the socket and therefore cannot reject a call.
 */
export class CallLogAggregator {
  private readonly calls = new Map<string, PendingCall>();
  private readonly finished = new Set<string>();
  /** Raw stanza notes that arrived before Baileys' parsed `call` event for the same id. */
  private readonly earlyNotes = new Map<string, string[]>();
  /** Calls logged `missed` by the silence timer, kept so a late status can correct the log. */
  private readonly provisional = new Map<string, { call: PendingCall; until: number }>();

  constructor(
    private readonly emit: (call: ProviderCallLog) => void,
    private readonly clock: CallAggregatorClock = realClock,
    private readonly ownJid: () => string | null = () => null,
  ) {}

  /**
   * Records the raw `<call>` child tag and its `reason` attribute (e.g. a terminate reason) so the
   * linked-device spike can see what WhatsApp actually sends. Never contains numbers or content.
   */
  noteRawStanza(
    callId: string | undefined,
    tag: string | undefined,
    reason: string | undefined,
  ): void {
    const id = nonEmpty(callId);
    const label = nonEmpty(tag);
    if (!id || !label || this.finished.has(id)) return;
    const safeReason = nonEmpty(reason)
      ?.toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "")
      .slice(0, 40);
    const note = `raw:${label.slice(0, 40)}${safeReason ? `:${safeReason}` : ""}`;
    const call = this.calls.get(id);
    if (call) {
      pushStatus(call, note);
      return;
    }
    const notes = this.earlyNotes.get(id) ?? [];
    if (notes.length < 16) notes.push(note);
    this.earlyNotes.set(id, notes);
    if (this.earlyNotes.size > 200) {
      const oldest = this.earlyNotes.keys().next().value;
      if (oldest !== undefined) this.earlyNotes.delete(oldest);
    }
  }

  observe(event: WACallEvent): void {
    const callId = nonEmpty(event.id);
    if (!callId) return;
    const at = validDate(event.date) ?? this.clock.now();
    this.reviveProvisional(callId, event.status, at);
    if (this.finished.has(callId)) return;
    let call = this.calls.get(callId);
    if (!call) {
      const fromJid = (nonEmpty(event.from) ?? nonEmpty(event.chatId) ?? "").toLowerCase();
      const chatJid = (nonEmpty(event.chatId) ?? fromJid).toLowerCase();
      if (!fromJid && !chatJid) return;
      call = {
        callId,
        chatJid,
        fromJid: fromJid || chatJid,
        callerPnJid: nonEmpty(event.callerPn)?.toLowerCase() ?? null,
        isVideo: event.isVideo === true,
        isGroup: event.isGroup === true || Boolean(event.groupJid),
        groupJid: nonEmpty(event.groupJid)?.toLowerCase() ?? null,
        offline: event.offline === true,
        startedAt: at,
        answeredAt: null,
        rejectedAt: null,
        answeredLate: false,
        durationUnknown: false,
        revision: 1,
        statuses: this.earlyNotes.get(callId) ?? [],
        timer: null,
      };
      this.earlyNotes.delete(callId);
      this.calls.set(callId, call);
    }
    pushStatus(call, event.status);
    if (event.isVideo === true) call.isVideo = true;
    if (event.isGroup === true) call.isGroup = true;
    if (!call.callerPnJid && event.callerPn) call.callerPnJid = event.callerPn.toLowerCase();

    switch (event.status) {
      case "accept":
        call.answeredAt ??= at;
        this.arm(call, ANSWERED_CALL_MAX_MS);
        return;
      case "reject":
        call.rejectedAt ??= at;
        this.finish(call, at);
        return;
      case "timeout":
        this.finish(call, at);
        return;
      case "terminate":
        if (call.statuses.includes(ACCEPTED_ELSEWHERE_NOTE)) {
          // The number's own phone (or another linked device) picked up. WhatsApp stops the
          // ringing on this linked device with `<terminate reason="accepted_elsewhere">` and
          // sends it nothing more about the call, so the answer time is known but the end is not.
          call.answeredAt ??= at;
          call.durationUnknown = true;
        } else if (call.revision > 1 && !call.answeredAt && !call.rejectedAt) {
          call.answeredLate = true;
        }
        this.finish(call, at);
        return;
      default:
        // offer, ringing, preaccept, transport, relaylatency: still ringing.
        if (!call.answeredAt) this.arm(call, CALL_SILENCE_TIMEOUT_MS);
    }
  }

  /** Emits nothing for calls still in progress; used when the socket goes away. */
  clear(): void {
    for (const call of this.calls.values()) if (call.timer) this.clock.clearTimeout(call.timer);
    this.calls.clear();
    this.earlyNotes.clear();
    this.provisional.clear();
  }

  /** A status after a provisional `missed` log reopens the call as revision 2. */
  private reviveProvisional(callId: string, status: string, at: string): void {
    const entry = this.provisional.get(callId);
    if (!entry) return;
    if (status !== "accept" && status !== "reject" && status !== "terminate") return;
    this.provisional.delete(callId);
    if (Date.parse(at) > entry.until) return;
    this.finished.delete(callId);
    this.calls.set(callId, { ...entry.call, revision: entry.call.revision + 1, timer: null });
  }

  private arm(call: PendingCall, milliseconds: number): void {
    if (call.timer) this.clock.clearTimeout(call.timer);
    call.timer = this.clock.setTimeout(() => {
      call.timer = null;
      pushStatus(call, "silence");
      const ringing = !call.answeredAt;
      this.finish(call, this.clock.now());
      if (ringing && call.revision === 1) {
        this.provisional.set(call.callId, {
          call,
          until: Date.parse(this.clock.now()) + ANSWERED_CALL_MAX_MS,
        });
        if (this.provisional.size > 200) {
          const oldest = this.provisional.keys().next().value;
          if (oldest !== undefined) this.provisional.delete(oldest);
        }
      }
    }, milliseconds);
  }

  private finish(call: PendingCall, endedAt: string): void {
    if (call.timer) this.clock.clearTimeout(call.timer);
    this.calls.delete(call.callId);
    this.finished.add(call.callId);
    if (this.finished.size > 1_000) {
      const oldest = this.finished.values().next().value;
      if (oldest !== undefined) this.finished.delete(oldest);
    }
    const outcome: CallOutcome =
      call.answeredAt || call.answeredLate
        ? "answered_elsewhere"
        : call.rejectedAt
          ? "rejected"
          : "missed";
    const durationSeconds =
      call.answeredAt && !call.durationUnknown
        ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(call.answeredAt)) / 1_000))
        : null;
    try {
      this.emit({
        type: "call",
        callId: call.callId,
        chatJid: call.chatJid,
        fromJid: call.fromJid,
        callerPnJid: call.callerPnJid,
        isVideo: call.isVideo,
        isGroup: call.isGroup,
        groupJid: call.groupJid,
        offline: call.offline,
        outcome,
        startedAt: call.startedAt,
        answeredAt: call.answeredAt,
        endedAt,
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
        fromMe: isOwn(call.fromJid, this.ownJid()),
        revision: call.revision,
        providerStatuses: call.statuses.slice(0, MAX_CALL_STATUSES),
      });
    } catch {
      // Call logging is auxiliary and must never break the socket event loop.
    }
  }
}

function pushStatus(call: PendingCall, status: string): void {
  if (call.statuses.length < MAX_CALL_STATUSES) call.statuses.push(status);
}

function isOwn(jid: string, ownJid: string | null): boolean {
  try {
    return Boolean(ownJid && jid && areJidsSameUser(jid, ownJid));
  } catch {
    return false;
  }
}

function changeAuthor(
  key: { fromMe?: boolean | null; participant?: string | null; participantAlt?: string | null },
  chatJid: string,
  fromMe: boolean,
  ownJid: string | null,
): string | null {
  if (fromMe) return ownJid;
  if (isJidGroup(chatJid)) {
    return (nonEmpty(key.participant) ?? nonEmpty(key.participantAlt))?.toLowerCase() ?? null;
  }
  return chatJid;
}

function textOf(message: proto.IMessage): string | null {
  const content = normalizeMessageContent(message);
  const value =
    content?.conversation ??
    content?.extendedTextMessage?.text ??
    content?.imageMessage?.caption ??
    content?.videoMessage?.caption ??
    content?.documentMessage?.caption ??
    null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function secondsToIso(value: unknown, fallback: string): string {
  const seconds = toNumber(value);
  if (seconds === null || seconds <= 0) return fallback;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    const number = (value as { toNumber(): number }).toNumber();
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function validDate(value: Date | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
