import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { z } from "zod";

import { atasNamaRef, atasNamaSchema, type AtasNama, type KirimConversations } from "./conversations.js";
import { columnAad, InvalidNumberError, normalizePhone, phoneCanonical, type KirimCrypto } from "./crypto.js";
import { KirimApiError } from "./errors.js";
import { contactFromJid, memberAad, type KirimIngest } from "./ingest.js";
import type { KirimLog } from "./providers/log.js";
import { ProviderOperationError, type KirimProvider, type ParticipantUpdate, type ProviderGroup, type ProviderName } from "./providers/types.js";
import { findDevice, groupJid, withTransaction, writeAudit, type ConsumerRow, type DeviceRow, type Queryable } from "./repository.js";
import { canonicalJson, type KirimService } from "./service.js";

/**
 * KIRIM-IMPL-004 §9 (R3, KIRIM-001 §5.4) and §10 (grup bersama). Groups of the number the calling module
 * owns: create, add and remove members, invite link, name and description, members, and the groups a
 * contact shares with the number. Additions are limited per number per hour to keep the number from being
 * blocked; who may manage groups is the module's rule (SPMB-IMPL-005 §7.3).
 */

const nomorList = z.array(z.string().trim().min(1).max(40)).min(1).max(100);

export const createGroupSchema = z
  .object({
    nama: z.string().trim().min(1).max(100),
    deskripsi: z.string().max(2048).optional(),
    anggota: nomorList,
    atas_nama: atasNamaSchema,
  })
  .strict();
export const participantsSchema = z.object({ nomor: nomorList, atas_nama: atasNamaSchema }).strict();
export const updateGroupSchema = z
  .object({ nama: z.string().trim().min(1).max(100).optional(), deskripsi: z.string().max(2048).optional(), atas_nama: atasNamaSchema })
  .strict()
  .refine((body) => body.nama !== undefined || body.deskripsi !== undefined, { message: "send nama or deskripsi" });
export const inviteRevokeSchema = z.object({ atas_nama: atasNamaSchema }).strict();

const HOUR_MS = 3_600_000;

/** One requested member and what WhatsApp did with them. */
export interface MemberResult {
  nomor: string;
  status: "ditambahkan" | "perlu_undangan" | "sudah_anggota" | "baru_keluar" | "dikeluarkan" | "bukan_anggota" | "optout" | "gagal";
  perlu_undangan: boolean;
  kode_whatsapp: string | null;
}

/** JalurPesan K3.2 §E participant statuses ("200", "403", …) for an addition or a removal. */
export function memberStatus(action: "add" | "remove", code: string | null): MemberResult["status"] {
  if (code === "200") return action === "add" ? "ditambahkan" : "dikeluarkan";
  if (action === "add" && code === "403") return "perlu_undangan";
  if (action === "add" && code === "409") return "sudah_anggota";
  if (action === "add" && code === "408") return "baru_keluar";
  if (action === "remove" && code === "404") return "bukan_anggota";
  return "gagal";
}

/**
 * When enough of the last hour's additions age out for `wanted` more, in whole seconds, or null when the
 * request is larger than the limit itself. `rows` are the last hour's reservations, oldest first. Pure.
 */
export function addLimitRetry(rows: Array<{ at: Date; jumlah: number }>, now: Date, limit: number, wanted: number): number | null {
  if (wanted > limit) return null;
  let used = rows.reduce((sum, row) => sum + row.jumlah, 0);
  if (used + wanted <= limit) return 0;
  for (const row of rows) {
    used -= row.jumlah;
    if (used + wanted <= limit) return Math.max(1, Math.ceil((row.at.getTime() + HOUR_MS - now.getTime()) / 1000));
  }
  return Math.ceil(HOUR_MS / 1000);
}

export class KirimGroupAdmin {
  constructor(
    private readonly pool: Pool,
    private readonly crypto: KirimCrypto,
    private readonly service: KirimService,
    private readonly conversations: KirimConversations,
    private readonly providers: Record<ProviderName, KirimProvider | undefined>,
    private readonly ingest: KirimIngest | undefined,
    private readonly options: { addLimitPerHour: number; log?: KirimLog },
  ) {}

  // ------------------------------------------------------------------------------- create

  async create(consumer: ConsumerRow, kode: string, idempotencyKey: string | null, input: z.infer<typeof createGroupSchema>) {
    const device = await this.conversations.ownedDevice(consumer, kode);
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    const requestHash = this.crypto.lookup(`group-create:${device.id}:${canonicalJson(input)}`);
    if (idempotencyKey) {
      const replay = await this.pool.query<{ groupId: string | null; requestHash: string | null }>(
        `SELECT group_id AS "groupId", request_hash AS "requestHash" FROM kirim_group_additions WHERE consumer_id = $1 AND idempotency_key = $2`,
        [consumer.id, idempotencyKey],
      );
      const row = replay.rows[0];
      if (row) {
        if (row.requestHash !== requestHash) throw new KirimApiError(409, "idempotency_key_conflict", "Idempotency-Key sudah dipakai untuk permintaan lain.");
        if (!row.groupId) throw new KirimApiError(409, "idempotency_request_in_progress", "Pembuatan grup dengan kunci ini masih berjalan.");
        return { status: 200, body: { grup: await this.groupItem(row.groupId), anggota: null, ulangan: true } };
      }
    }
    const { provider, sendable, skipped } = await this.prepare(consumer, device, input.anggota);
    const reservation = await this.reserve(consumer, device, null, "buat", sendable.length, idempotencyKey, requestHash);
    let group: ProviderGroup;
    try {
      group = await provider.createGroup(device, input.nama, sendable.map((member) => member.digits));
    } catch (error) {
      await this.release(reservation);
      throw this.engineError(error, true);
    }
    let deskripsi: "berhasil" | "gagal" | null = null;
    if (input.deskripsi) {
      try {
        await provider.setGroupDescription(device, group.jid, input.deskripsi);
        deskripsi = "berhasil";
      } catch {
        // The group exists; a failed description is reported, not undone.
        deskripsi = "gagal";
      }
    }
    const results = [
      ...sendable.map((member): MemberResult => {
        const joined = group.participants.some((participant) => this.isMember(participant, member.canonical));
        return { nomor: member.nomor, status: joined ? "ditambahkan" : "perlu_undangan", perlu_undangan: !joined, kode_whatsapp: null };
      }),
      ...skipped,
    ];
    const groupId = await withTransaction(this.pool, async (client) => {
      const id = await this.storeGroup(client, device, group);
      await client.query("UPDATE kirim_group_additions SET group_id = $2 WHERE id = $1", [reservation, id]);
      await this.audit(client, consumer, "grup.buat", id, device, input.atas_nama, counts(results));
      return id;
    });
    return { status: 201, body: { grup: await this.groupItem(groupId), anggota: results, deskripsi } };
  }

  // ---------------------------------------------------------------------------- members

  async addMembers(consumer: ConsumerRow, groupId: string, input: z.infer<typeof participantsSchema>) {
    const { group, device, jid } = await this.owned(consumer, groupId);
    const { provider, sendable, skipped } = await this.prepare(consumer, device, input.nomor);
    const reservation = await this.reserve(consumer, device, group.id, "tambah", sendable.length, null, null);
    let outcome: { updates: ParticipantUpdate[]; group: ProviderGroup | null };
    try {
      outcome = await provider.updateParticipants(device, jid, "add", sendable.map((member) => member.digits));
    } catch (error) {
      await this.release(reservation);
      throw this.engineError(error, group.nomorIniAdmin);
    }
    const results = [...this.mapUpdates("add", sendable, outcome.updates), ...skipped];
    await withTransaction(this.pool, async (client) => {
      if (outcome.group) await this.storeGroup(client, device, outcome.group);
      await this.audit(client, consumer, "grup.anggota_tambah", group.id, device, input.atas_nama, counts(results));
    });
    return { grup: await this.groupItem(group.id), anggota: results };
  }

  async removeMembers(consumer: ConsumerRow, groupId: string, input: z.infer<typeof participantsSchema>) {
    const { group, device, jid } = await this.owned(consumer, groupId);
    const provider = this.provider(device);
    const members = this.normalizeAll(input.nomor);
    let outcome: { updates: ParticipantUpdate[]; group: ProviderGroup | null };
    try {
      outcome = await provider.updateParticipants(device, jid, "remove", members.map((member) => member.digits));
    } catch (error) {
      throw this.engineError(error, group.nomorIniAdmin);
    }
    const results = this.mapUpdates("remove", members, outcome.updates);
    await withTransaction(this.pool, async (client) => {
      if (outcome.group) await this.storeGroup(client, device, outcome.group);
      await this.audit(client, consumer, "grup.anggota_keluarkan", group.id, device, input.atas_nama, counts(results));
    });
    return { grup: await this.groupItem(group.id), anggota: results };
  }

  /** §9.4: members as last refreshed; numbers in full, `null` for a member WhatsApp only knows by LID. */
  async members(consumer: ConsumerRow, groupId: string) {
    const group = await this.conversations.ownedGroup(this.pool, consumer, groupId);
    const own = this.ingest ? await this.ingest.ownPhone(this.pool, (await findDevice(this.pool, group.kode))!.id) : null;
    const rows = await this.pool.query<{ memberHmac: string; memberEnc: string; altEnc: string | null; admin: boolean }>(
      `SELECT member_hmac AS "memberHmac", member_enc AS "memberEnc", member_alt_enc AS "altEnc", admin
         FROM kirim_group_members WHERE group_id = $1`,
      [group.id],
    );
    const items = rows.rows.map((row) => {
      const primary = this.crypto.open(row.memberEnc, memberAad(group.id, row.memberHmac, "member_enc"));
      const alt = row.altEnc ? this.crypto.open(row.altEnc, memberAad(group.id, row.memberHmac, "member_alt_enc")) : null;
      const phone = primary.startsWith("pn:+") ? primary.slice(3) : alt?.startsWith("pn:+") ? alt.slice(3) : null;
      return { nomor: phone, jenis: primary.startsWith("pn:") ? "pn" : "lid", admin: row.admin, nomor_ini: own !== null && phone === `+${own}` };
    });
    items.sort((a, b) => Number(b.admin) - Number(a.admin) || (a.nomor ?? "~").localeCompare(b.nomor ?? "~"));
    const refreshed = await this.pool.query<{ at: Date | null }>("SELECT disegarkan_at AS at FROM kirim_groups WHERE id = $1", [group.id]);
    return { items, disegarkan_at: refreshed.rows[0]?.at?.toISOString() ?? null };
  }

  // ----------------------------------------------------------------- invite, name, about

  async inviteLink(consumer: ConsumerRow, groupId: string, atasNama: AtasNama, revoke: boolean) {
    const { group, device, jid } = await this.owned(consumer, groupId);
    const provider = this.provider(device);
    let code: string;
    try {
      code = revoke ? await provider.revokeGroupInvite(device, jid) : await provider.groupInviteCode(device, jid);
    } catch (error) {
      throw this.engineError(error, group.nomorIniAdmin);
    }
    await this.audit(this.pool, consumer, revoke ? "grup.undangan_tarik" : "grup.undangan_lihat", group.id, device, atasNama, {});
    return { tautan: `https://chat.whatsapp.com/${encodeURIComponent(code)}`, kode: code };
  }

  async update(consumer: ConsumerRow, groupId: string, input: z.infer<typeof updateGroupSchema>) {
    const { group, device, jid } = await this.owned(consumer, groupId);
    const provider = this.provider(device);
    try {
      if (input.nama !== undefined) await provider.setGroupSubject(device, jid, input.nama);
      if (input.deskripsi !== undefined) await provider.setGroupDescription(device, jid, input.deskripsi);
    } catch (error) {
      throw this.engineError(error, group.nomorIniAdmin);
    }
    await withTransaction(this.pool, async (client) => {
      if (input.nama !== undefined) {
        await client.query("UPDATE kirim_groups SET nama_enc = $2 WHERE id = $1", [group.id, this.crypto.seal(input.nama, columnAad("kirim_groups", "nama_enc", group.id))]);
      }
      await this.audit(client, consumer, "grup.ubah", group.id, device, input.atas_nama, { nama: input.nama !== undefined, deskripsi: input.deskripsi !== undefined });
    });
    return this.groupItem(group.id);
  }

  // ---------------------------------------------------------------------- grup bersama

  /** §10: groups of this number that this contact is also in, by either of the contact's identities. */
  async sharedGroups(consumer: ConsumerRow, conversationId: string) {
    const conversation = await this.conversations.ownedConversation(this.pool, consumer, conversationId);
    const hmacs = [conversation.kontakHmac, ...(conversation.kontakAltHmac ? [conversation.kontakAltHmac] : [])];
    const rows = await this.pool.query<{ id: string; namaEnc: string | null; jumlahAnggota: number | null; nomorIniAdmin: boolean; admin: boolean; disegarkanAt: Date | null }>(
      `SELECT g.id, g.nama_enc AS "namaEnc", g.jumlah_anggota AS "jumlahAnggota", g.nomor_ini_admin AS "nomorIniAdmin",
              bool_or(gm.admin) AS admin, g.disegarkan_at AS "disegarkanAt"
         FROM kirim_group_members gm JOIN kirim_groups g ON g.id = gm.group_id
        WHERE g.device_id = $1 AND g.keluar_at IS NULL
          AND (gm.member_hmac = ANY($2::text[]) OR gm.member_alt_hmac = ANY($2::text[]))
        GROUP BY g.id ORDER BY g.pesan_terakhir_at DESC NULLS LAST, g.id`,
      [conversation.deviceId, hmacs],
    );
    return {
      items: rows.rows.map((row) => ({
        id: row.id,
        nama: row.namaEnc ? this.crypto.open(row.namaEnc, columnAad("kirim_groups", "nama_enc", row.id)) : null,
        jumlah_anggota: row.jumlahAnggota,
        kontak_admin: row.admin,
        nomor_ini_admin: row.nomorIniAdmin,
        disegarkan_at: row.disegarkanAt?.toISOString() ?? null,
      })),
    };
  }

  // ---------------------------------------------------------------------------- internals

  private async owned(consumer: ConsumerRow, groupId: string) {
    const group = await this.conversations.ownedGroup(this.pool, consumer, groupId);
    const device = (await findDevice(this.pool, group.kode))!;
    if (device.status === "nonaktif") throw new KirimApiError(422, "device_inactive", "Nomor tidak aktif.");
    return { group, device, jid: await groupJid(this.pool, this.crypto, group.id) };
  }

  private provider(device: DeviceRow): KirimProvider {
    const provider = this.providers[device.provider];
    if (!provider || !this.ingest) throw new KirimApiError(503, "engine_unavailable", "Mesin WhatsApp tidak tersedia.");
    return provider;
  }

  private normalizeAll(values: string[]): Array<{ nomor: string; digits: string; canonical: string }> {
    const seen = new Set<string>();
    const members: Array<{ nomor: string; digits: string; canonical: string }> = [];
    values.forEach((value, index) => {
      let nomor: string;
      try {
        nomor = normalizePhone(value);
      } catch (error) {
        if (error instanceof InvalidNumberError) throw new KirimApiError(422, "invalid_number", "Nomor tidak sah.", { indeks: index });
        throw error;
      }
      if (seen.has(nomor)) return;
      seen.add(nomor);
      members.push({ nomor, digits: nomor.slice(1), canonical: phoneCanonical(nomor) });
    });
    return members;
  }

  /** Numbers that asked not to be contacted are never offered to WhatsApp (KIRIM-001 §5.4). */
  private async prepare(consumer: ConsumerRow, device: DeviceRow, values: string[]) {
    const provider = this.provider(device);
    const members = this.normalizeAll(values);
    const sendable: typeof members = [];
    const skipped: MemberResult[] = [];
    for (const member of members) {
      if (await this.service.isOptedOut(this.pool, [this.crypto.lookup(member.canonical)], consumer.id, device.id)) {
        skipped.push({ nomor: member.nomor, status: "optout", perlu_undangan: false, kode_whatsapp: null });
      } else sendable.push(member);
    }
    if (sendable.length === 0) throw new KirimApiError(422, "optout", "Semua nomor minta tidak dihubungi.");
    return { provider, sendable, skipped };
  }

  /**
   * Reserves `jumlah` additions under the number's hourly limit, serialised per number by a row lock.
   * A failed engine call releases the reservation; additions WhatsApp refused still count, since the
   * attempt is what WhatsApp sees.
   */
  private async reserve(
    consumer: ConsumerRow,
    device: DeviceRow,
    groupId: string | null,
    aksi: "buat" | "tambah",
    jumlah: number,
    idempotencyKey: string | null,
    requestHash: string | null,
  ): Promise<string> {
    const limit = this.options.addLimitPerHour;
    try {
      return await withTransaction(this.pool, async (client) => {
        await client.query("SELECT id FROM kirim_devices WHERE id = $1 FOR UPDATE", [device.id]);
        const recent = await client.query<{ at: Date; jumlah: number; now: Date }>(
          `SELECT created_at AS at, jumlah, now() AS now FROM kirim_group_additions
            WHERE device_id = $1 AND created_at > now() - interval '1 hour' ORDER BY created_at`,
          [device.id],
        );
        const now = recent.rows[0]?.now ?? new Date();
        const used = recent.rows.reduce((sum, row) => sum + row.jumlah, 0);
        const retry = addLimitRetry(recent.rows, now, limit, jumlah);
        if (retry === null) {
          throw new KirimApiError(422, "group_add_too_many", `Paling banyak ${limit} orang per jam untuk nomor ini; bagi permintaan ini.`, { batas_per_jam: limit });
        }
        if (retry > 0) {
          throw new KirimApiError(429, "group_add_limit", `Batas ${limit} penambahan anggota per jam untuk nomor ini tercapai.`, {
            batas_per_jam: limit,
            sisa: Math.max(0, limit - used),
            retry_after_detik: retry,
          });
        }
        const id = randomUUID();
        await client.query(
          `INSERT INTO kirim_group_additions (id, device_id, group_id, consumer_id, aksi, jumlah, idempotency_key, request_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, device.id, groupId, consumer.id, aksi, jumlah, idempotencyKey, requestHash],
        );
        return id;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new KirimApiError(409, "idempotency_request_in_progress", "Pembuatan grup dengan kunci ini masih berjalan.");
      }
      throw error;
    }
  }

  private async release(reservation: string): Promise<void> {
    await this.pool.query("DELETE FROM kirim_group_additions WHERE id = $1", [reservation]);
  }

  private mapUpdates(action: "add" | "remove", members: Array<{ nomor: string; digits: string }>, updates: ParticipantUpdate[]): MemberResult[] {
    return members.map((member, index) => {
      const update = updates.find((item) => item.jid.startsWith(`${member.digits}@`) || item.jid.startsWith(`${member.digits}:`))
        ?? (updates.length === members.length ? updates[index] : undefined);
      const status = memberStatus(action, update?.status ?? null);
      return { nomor: member.nomor, status, perlu_undangan: status === "perlu_undangan", kode_whatsapp: update?.status ?? null };
    });
  }

  private isMember(participant: ProviderGroup["participants"][number], canonical: string): boolean {
    return [participant.jid, participant.phoneJid ?? null].some((jid) => jid !== null && contactFromJid(jid)?.canonical === canonical);
  }

  private async storeGroup(client: Queryable, device: DeviceRow, group: ProviderGroup): Promise<string> {
    const own = await this.ingest!.ownPhone(client, device.id);
    return this.ingest!.storeGroupState(client, device.id, group, own);
  }

  private async groupItem(id: string) {
    const item = await this.conversations.groupItemById(id);
    if (!item) throw new KirimApiError(404, "not_found", "Grup tidak ditemukan.");
    return item;
  }

  /** Engine errors as stable API errors; a refusal while this number is not admin is named as such. */
  private engineError(error: unknown, isAdmin: boolean): Error {
    if (!(error instanceof ProviderOperationError)) return error as Error;
    this.options.log?.({ event: "kirim.group.failed", code: error.code }, "kirim group action refused by the engine");
    if (error.code === "group_not_found") return new KirimApiError(409, "group_unavailable", "Nomor ini sudah bukan anggota grup itu.");
    if (error.code === "engine_rejected" && !isAdmin) return new KirimApiError(409, "not_group_admin", "Nomor ini bukan admin grup itu.");
    if (error.code === "engine_rejected") return new KirimApiError(422, "engine_rejected", "WhatsApp menolak permintaan ini.");
    return new KirimApiError(503, "engine_unavailable", "Mesin WhatsApp tidak tersedia atau nomor tidak tersambung.");
  }

  private async audit(db: Queryable, consumer: ConsumerRow, aksi: string, groupId: string, device: DeviceRow, atasNama: AtasNama, metadata: Record<string, unknown>) {
    await writeAudit(db, {
      actorKind: "service",
      actorRef: consumer.clientId,
      aksi,
      objekJenis: "grup",
      objekRef: groupId,
      metadata: { device: device.kode, ...metadata },
      atasNama: atasNamaRef(atasNama),
    });
  }
}

/** Counts only: audit metadata never carries numbers. */
function counts(results: MemberResult[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const result of results) tally[result.status] = (tally[result.status] ?? 0) + 1;
  return tally;
}
