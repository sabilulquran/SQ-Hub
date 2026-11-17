import type { Pool } from "pg";

import { columnAad, type WaCrypto } from "../crypto.js";
import { canonicalLidJid, canonicalPnJid } from "../wa/identity.js";

/**
 * KIRIM-IMPL-005 §5 `GET /contacts`. What WhatsApp tells the engine about the people this number
 * talks to: the name the phone shows, and — the part Kirim SQ actually needs — the link between a
 * contact's LID and their phone number (D-6: without it one person becomes two conversations and
 * the replies land in the one nobody reads).
 *
 * Display names are sealed: a contact list is personal data.
 */

export interface ContactRecord {
  jid: string;
  canonicalJid: string;
  displayName: string | null;
}

export class ContactStore {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: WaCrypto,
  ) {}

  /** One contact as WhatsApp gave it; several identities of the same person share a canonical JID. */
  async upsert(kode: string, input: { identities: string[]; displayName: string | null; displayPriority?: number }): Promise<void> {
    const identities = [...new Set(input.identities.map((jid) => jid.trim().toLowerCase()).filter(Boolean))];
    if (identities.length === 0) return;
    // The phone-number identity is the canonical one when WhatsApp gave one; otherwise the LID.
    const canonical = identities.map(canonicalPnJid).find(Boolean) ?? identities.map(canonicalLidJid).find(Boolean) ?? identities[0]!;
    for (const jid of identities) {
      await this.pool.query(
        `INSERT INTO kirim_wa_contacts (kode, jid, canonical_jid, display_name_enc, display_priority, updated_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (kode, jid) DO UPDATE SET
           canonical_jid = EXCLUDED.canonical_jid,
           display_name_enc = CASE
             WHEN EXCLUDED.display_name_enc IS NULL THEN kirim_wa_contacts.display_name_enc
             WHEN EXCLUDED.display_priority >= kirim_wa_contacts.display_priority THEN EXCLUDED.display_name_enc
             ELSE kirim_wa_contacts.display_name_enc END,
           display_priority = greatest(kirim_wa_contacts.display_priority, EXCLUDED.display_priority),
           updated_at = now()`,
        [
          kode,
          jid,
          canonical,
          input.displayName ? this.crypto.seal(input.displayName.slice(0, 200), this.aad(kode, jid)) : null,
          input.displayPriority ?? 0,
        ],
      );
    }
  }

  /** A LID learnt to belong to a number: both identities become one contact. */
  async linkLid(kode: string, lid: string, phoneJid: string): Promise<void> {
    await this.upsert(kode, { identities: [lid, phoneJid], displayName: null });
  }

  async list(kode: string, page: number, pageSize: number): Promise<{ contacts: ContactRecord[]; totalPages: number }> {
    const total = await this.pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM kirim_wa_contacts WHERE kode = $1`, [kode]);
    const count = Number(total.rows[0]?.count ?? 0);
    const result = await this.pool.query<{ jid: string; canonical_jid: string; display_name_enc: string | null }>(
      `SELECT jid, canonical_jid, display_name_enc FROM kirim_wa_contacts
        WHERE kode = $1 ORDER BY updated_at DESC, jid ASC LIMIT $2 OFFSET $3`,
      [kode, pageSize, Math.max(0, page - 1) * pageSize],
    );
    return {
      contacts: result.rows.map((row) => ({
        jid: row.jid,
        canonicalJid: row.canonical_jid,
        displayName: row.display_name_enc ? this.safeOpen(row.display_name_enc, this.aad(kode, row.jid)) : null,
      })),
      totalPages: Math.max(1, Math.ceil(count / pageSize)),
    };
  }

  async forgetDevice(kode: string): Promise<void> {
    await this.pool.query(`DELETE FROM kirim_wa_contacts WHERE kode = $1`, [kode]);
  }

  /** A name that cannot be opened is reported as no name, never as an error that hides the contact. */
  private safeOpen(envelope: string, aad: string): string | null {
    try {
      return this.crypto.open(envelope, aad);
    } catch {
      return null;
    }
  }

  private aad(kode: string, jid: string): string {
    return columnAad("kirim_wa_contacts", "display_name_enc", `${kode}:${jid}`);
  }
}
