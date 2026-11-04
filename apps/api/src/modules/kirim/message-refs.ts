import { columnAad, type KirimCrypto } from "./crypto.js";
import type { QuotedMessage } from "./providers/types.js";
import type { Queryable } from "./repository.js";

/** KIRIM-IMPL-004 §3: helpers shared by the worker, ingest and the message actions. */

/** Kirim `tipe` → JalurPesan `messageType` for a quote; types WhatsApp cannot quote by preview are `text`. */
export const ENGINE_TYPE_BY_TIPE: Record<string, QuotedMessage["messageType"]> = {
  teks: "text",
  gambar: "image",
  video: "video",
  audio: "audio",
  dokumen: "document",
  stiker: "sticker",
};

/** `pn:+62…` → `62…@s.whatsapp.net`; `lid:<jid>` → `<jid>`. */
export function jidFromCanonical(canonical: string): string | null {
  if (canonical.startsWith("pn:+")) return `${canonical.slice(4)}@s.whatsapp.net`;
  if (canonical.startsWith("lid:")) return canonical.slice(4);
  return null;
}

/**
 * The engine `quoted` object for a stored message: its WhatsApp id, whether this number sent it, the
 * group sender when it came from a member, and its text for the preview. Null when WhatsApp has no id
 * for it (never handed over), so a send never quotes something the recipient's phone cannot find.
 * A masked verification code is quoted without its text.
 */
export async function quotedFor(db: Queryable, crypto: KirimCrypto, messageId: string): Promise<QuotedMessage | null> {
  const result = await db.query<{
    waMessageId: string | null;
    arah: "masuk" | "keluar";
    tipe: string;
    bodyEnc: string | null;
    bodyDisamarkan: boolean;
    pengirimEnc: string | null;
    groupId: string | null;
  }>(
    `SELECT wa_message_id AS "waMessageId", arah, tipe, body_enc AS "bodyEnc", body_disamarkan AS "bodyDisamarkan",
            pengirim_enc AS "pengirimEnc", group_id AS "groupId"
       FROM kirim_messages WHERE id = $1`,
    [messageId],
  );
  const row = result.rows[0];
  if (!row?.waMessageId) return null;
  const fromMe = row.arah === "keluar";
  let participant: string | undefined;
  if (row.groupId && !fromMe && row.pengirimEnc) {
    participant = jidFromCanonical(crypto.open(row.pengirimEnc, columnAad("kirim_messages", "pengirim_enc", messageId))) ?? undefined;
  }
  // The engine needs the member who wrote a quoted group message.
  if (row.groupId && !fromMe && !participant) return null;
  const text = row.bodyEnc && !row.bodyDisamarkan ? crypto.open(row.bodyEnc, columnAad("kirim_messages", "body_enc", messageId)).slice(0, 4096) : undefined;
  const messageType = ENGINE_TYPE_BY_TIPE[row.tipe];
  return {
    id: row.waMessageId,
    fromMe,
    ...(participant ? { participant } : {}),
    ...(text ? { text } : {}),
    ...(messageType ? { messageType } : {}),
  };
}
