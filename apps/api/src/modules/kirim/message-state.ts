import { randomUUID } from "node:crypto";

import { columnAad, type KirimCrypto } from "./crypto.js";
import type { Queryable } from "./repository.js";

/**
 * KIRIM-IMPL-004 §4–§6: edits, deletes and reactions on a stored message, shared by the engine events
 * (ingest) and the actions a module asks for (actions.ts). Bodies stay encrypted; an edit keeps the
 * replaced body in `kirim_message_edits` ("isi lama tetap tersimpan").
 */

/** Who changed a message: an officer (`issuer sub`), the contact or member who sent it, a group admin, or the number's phone. */
export type ChangedBy = string;
export const BY_SENDER = "pengirim";
export const BY_GROUP_ADMIN = "admin_grup";
export const BY_PHONE = "hp";

export interface TargetMessage {
  id: string;
  deviceId: string;
  conversationId: string | null;
  groupId: string | null;
  arah: "masuk" | "keluar";
  asal: string | null;
  tipe: string;
  bodyEnc: string | null;
  bodyDisamarkan: boolean;
  pengirimHmac: string | null;
  waMessageId: string | null;
  status: string;
  consumerId: string | null;
  sentAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  reactions: StoredReaction[];
}

/** One reactor's current reaction. `k` is `nomor_ini` or the reactor's HMAC; `enc` holds a group member's identity. */
export interface StoredReaction {
  k: string;
  dari: "kontak" | "nomor_ini" | "anggota";
  emoji: string;
  at: string;
  enc?: string;
  petugas?: string;
}

const TARGET_COLUMNS = `
  id, device_id AS "deviceId", conversation_id AS "conversationId", group_id AS "groupId", arah, asal, tipe,
  body_enc AS "bodyEnc", body_disamarkan AS "bodyDisamarkan", pengirim_hmac AS "pengirimHmac", wa_message_id AS "waMessageId",
  status, consumer_id AS "consumerId", coalesce(provider_at, created_at) AS "sentAt", edited_at AS "editedAt",
  deleted_at AS "deletedAt", reactions
`;

/** The stored message an engine event points at, by WhatsApp id within the number; locked for the change. */
export async function messageByWaId(db: Queryable, deviceId: string, waMessageId: string): Promise<TargetMessage | null> {
  const result = await db.query<TargetMessage>(
    `SELECT ${TARGET_COLUMNS} FROM kirim_messages WHERE device_id = $1 AND wa_message_id = $2
      ORDER BY diimpor, created_at LIMIT 1 FOR UPDATE`,
    [deviceId, waMessageId],
  );
  return result.rows[0] ?? null;
}

export async function messageById(db: Queryable, id: string, lock = false): Promise<TargetMessage | null> {
  const result = await db.query<TargetMessage>(`SELECT ${TARGET_COLUMNS} FROM kirim_messages WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [id]);
  return result.rows[0] ?? null;
}

/**
 * Replaces the body and keeps the old one. Returns false when nothing changed, e.g. the engine reporting
 * an edit this number already made through the API, so no second history row or webhook follows.
 */
export async function recordEdit(
  db: Queryable,
  crypto: KirimCrypto,
  target: TargetMessage,
  input: { body: string | null; at: Date | string; by: ChangedBy },
): Promise<boolean> {
  if (target.deletedAt) return false;
  const old = target.bodyEnc ? crypto.open(target.bodyEnc, columnAad("kirim_messages", "body_enc", target.id)) : null;
  if (input.body !== null && old === input.body) return false;
  const editId = randomUUID();
  await db.query(
    `INSERT INTO kirim_message_edits (id, message_id, body_enc, oleh, diganti_at) VALUES ($1, $2, $3, $4, $5)`,
    [editId, target.id, old ? crypto.seal(old, columnAad("kirim_message_edits", "body_enc", editId)) : null, input.by, input.at],
  );
  await db.query(
    `UPDATE kirim_messages SET body_enc = coalesce($2, body_enc), edited_at = $3, updated_at = now() WHERE id = $1`,
    [target.id, input.body ? crypto.seal(input.body, columnAad("kirim_messages", "body_enc", target.id)) : null, input.at],
  );
  return true;
}

/** Marks a message deleted for everyone; its body is kept. False when it already was. */
export async function recordDelete(db: Queryable, target: TargetMessage, input: { at: Date | string; by: ChangedBy }): Promise<boolean> {
  if (target.deletedAt) return false;
  await db.query(`UPDATE kirim_messages SET deleted_at = $2, deleted_by = $3, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [
    target.id,
    input.at,
    input.by,
  ]);
  return true;
}

/** At most this many reactors are kept per message; a WhatsApp group has at most 1024 members. */
const MAX_REACTIONS = 1024;

/**
 * Sets or removes one reactor's reaction (`""` removes). Pure: returns the new list and whether it
 * changed. A repeat of the same emoji is not a change, and keeps the officer recorded by the API.
 */
export function nextReactions(
  current: StoredReaction[],
  input: { k: string; dari: StoredReaction["dari"]; emoji: string; at: string; enc?: string; petugas?: string },
): { reactions: StoredReaction[]; changed: boolean } {
  const list = Array.isArray(current) ? current.filter((item) => item && typeof item.k === "string") : [];
  const existing = list.find((item) => item.k === input.k);
  if (input.emoji === "") {
    return existing ? { reactions: list.filter((item) => item.k !== input.k), changed: true } : { reactions: list, changed: false };
  }
  if (existing && existing.emoji === input.emoji) {
    if (input.petugas && existing.petugas !== input.petugas) {
      return { reactions: list.map((item) => (item.k === input.k ? { ...item, petugas: input.petugas! } : item)), changed: false };
    }
    return { reactions: list, changed: false };
  }
  const entry: StoredReaction = {
    k: input.k,
    dari: input.dari,
    emoji: input.emoji,
    at: input.at,
    ...(input.enc ? { enc: input.enc } : {}),
    ...(input.petugas ? { petugas: input.petugas } : {}),
  };
  const others = list.filter((item) => item.k !== input.k);
  return { reactions: [...others, entry].slice(-MAX_REACTIONS), changed: true };
}

export async function saveReactions(db: Queryable, messageId: string, reactions: StoredReaction[]): Promise<void> {
  await db.query("UPDATE kirim_messages SET reactions = $2::jsonb, updated_at = now() WHERE id = $1", [messageId, JSON.stringify(reactions)]);
}

/** AAD for a group member's identity inside a reaction entry. */
export function reactionAad(messageId: string, key: string): string {
  return columnAad("kirim_messages", "reactions", `${messageId}:${key}`);
}

/** Opaque `issuer sub` → `{ issuer, sub }`, or the fixed word it is. */
export function changedByItem(value: string | null): { jenis: "petugas" | "pengirim" | "admin_grup" | "hp"; petugas: { issuer: string; sub: string } | null } | null {
  if (!value) return null;
  if (value === BY_SENDER || value === BY_GROUP_ADMIN || value === BY_PHONE) return { jenis: value as "pengirim" | "admin_grup" | "hp", petugas: null };
  const space = value.indexOf(" ");
  return space > 0 ? { jenis: "petugas", petugas: { issuer: value.slice(0, space), sub: value.slice(space + 1) } } : null;
}
