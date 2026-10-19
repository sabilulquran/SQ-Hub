-- KIRIM-IMPL-002 §4: Kirim SQ R2 (API percakapan, grup, impor riwayat).
-- Unlike 0010 this file changes R1 tables, but never removes data: the one dropped column
-- (kirim_conversations.ditangani_oleh) is checked to be empty first, and every replaced CHECK
-- only allows more values. Recovery plan (§4.3): dump sq_hub_production before migrating; the
-- file runs in one transaction (migrate.ts), so a failure leaves the database unchanged. Before
-- an application rollback to R1, pause the owner numbers and cancel queued officer and group
-- replies, because the R1 worker does not know them.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kirim_conversations WHERE ditangani_oleh IS NOT NULL) THEN
    RAISE EXCEPTION 'kirim_conversations.ditangani_oleh has values; KIRIM-001 §13 no. 1 assumed it was always empty';
  END IF;
END $$;

-- §6.2: groups the number belongs to. Group messages never create a private conversation.
CREATE TABLE IF NOT EXISTS kirim_groups (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  group_hmac text NOT NULL CHECK (group_hmac ~ '^[0-9a-f]{64}$'),
  group_jid_enc text NOT NULL,
  nama_enc text NULL,
  jumlah_anggota integer NULL CHECK (jumlah_anggota IS NULL OR jumlah_anggota >= 0),
  nomor_ini_admin boolean NOT NULL DEFAULT false,
  pesan_terakhir_at timestamptz NULL,
  belum_dibaca integer NOT NULL DEFAULT 0 CHECK (belum_dibaca >= 0),
  dibaca_sampai_at timestamptz NULL,
  keluar_at timestamptz NULL,
  disegarkan_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, group_hmac)
);

-- §4.1 kirim_conversations
ALTER TABLE kirim_conversations DROP COLUMN IF EXISTS ditangani_oleh;
ALTER TABLE kirim_conversations
  ADD COLUMN IF NOT EXISTS kontak_alt_hmac text NULL CHECK (kontak_alt_hmac IS NULL OR kontak_alt_hmac ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS kontak_alt_enc text NULL,
  ADD COLUMN IF NOT EXISTS dibaca_sampai_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pesan_masuk_terakhir_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS kirim_conversations_alt_idx
  ON kirim_conversations (device_id, kontak_alt_hmac) WHERE kontak_alt_hmac IS NOT NULL;
CREATE INDEX IF NOT EXISTS kirim_conversations_list_idx
  ON kirim_conversations (device_id, pesan_terakhir_at DESC, id DESC);

-- §4.1 kirim_messages
ALTER TABLE kirim_messages DROP CONSTRAINT IF EXISTS kirim_messages_asal_check;
ALTER TABLE kirim_messages ADD CONSTRAINT kirim_messages_asal_check
  CHECK (asal IS NULL OR asal IN ('otomatis', 'petugas', 'hp'));
ALTER TABLE kirim_messages DROP CONSTRAINT IF EXISTS kirim_messages_jenis_check;
ALTER TABLE kirim_messages ADD CONSTRAINT kirim_messages_jenis_check
  CHECK (jenis IS NULL OR jenis IN ('notifikasi', 'kode', 'percakapan'));
ALTER TABLE kirim_messages
  ADD COLUMN IF NOT EXISTS diimpor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wa_message_id text NULL CHECK (wa_message_id IS NULL OR length(wa_message_id) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS consumer_id uuid NULL REFERENCES kirim_consumers (id),
  ADD COLUMN IF NOT EXISTS group_id uuid NULL REFERENCES kirim_groups (id),
  ADD COLUMN IF NOT EXISTS pengirim_hmac text NULL CHECK (pengirim_hmac IS NULL OR pengirim_hmac ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS pengirim_enc text NULL;
ALTER TABLE kirim_messages ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE kirim_messages DROP CONSTRAINT IF EXISTS kirim_messages_tujuan_check;
ALTER TABLE kirim_messages ADD CONSTRAINT kirim_messages_tujuan_check
  CHECK ((conversation_id IS NULL) <> (group_id IS NULL));
CREATE INDEX IF NOT EXISTS kirim_messages_group_time_idx
  ON kirim_messages (group_id, created_at) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kirim_messages_wa_idx
  ON kirim_messages (device_id, wa_message_id) WHERE wa_message_id IS NOT NULL;
-- §5.2: one rate count per number for automatic and officer messages.
CREATE INDEX IF NOT EXISTS kirim_messages_rate_all_idx
  ON kirim_messages (device_id, provider_at)
  WHERE arah = 'keluar' AND asal IN ('otomatis', 'petugas') AND provider_at IS NOT NULL;

-- R1 stored the WhatsApp id of outbound engine messages as provider_message_id.
UPDATE kirim_messages SET wa_message_id = provider_message_id
WHERE arah = 'keluar' AND provider = 'jalurpesan' AND provider_message_id IS NOT NULL AND wa_message_id IS NULL;
-- Which consumer sent each R1 automatic message.
UPDATE kirim_messages m SET consumer_id = o.consumer_id
FROM kirim_outbox o WHERE o.message_id = m.id AND m.consumer_id IS NULL;
UPDATE kirim_conversations c SET pesan_masuk_terakhir_at = latest.at
FROM (SELECT conversation_id, max(coalesce(provider_at, created_at)) AS at FROM kirim_messages
      WHERE arah = 'masuk' AND conversation_id IS NOT NULL GROUP BY conversation_id) latest
WHERE latest.conversation_id = c.id AND c.pesan_masuk_terakhir_at IS NULL;

-- §4.1 kirim_outbox
ALTER TABLE kirim_outbox DROP CONSTRAINT IF EXISTS kirim_outbox_jenis_check;
ALTER TABLE kirim_outbox ADD CONSTRAINT kirim_outbox_jenis_check
  CHECK (jenis IN ('notifikasi', 'kode', 'percakapan'));
ALTER TABLE kirim_outbox DROP CONSTRAINT IF EXISTS kirim_outbox_prioritas_check;
ALTER TABLE kirim_outbox ADD CONSTRAINT kirim_outbox_prioritas_check
  CHECK (prioritas IN ('kode', 'petugas', 'tinggi', 'normal'));
ALTER TABLE kirim_outbox
  ADD COLUMN IF NOT EXISTS atas_nama text NULL CHECK (atas_nama IS NULL OR length(atas_nama) BETWEEN 3 AND 512),
  ADD COLUMN IF NOT EXISTS group_id uuid NULL REFERENCES kirim_groups (id);

-- §4.1 / §8 kirim_optouts: cakupan `device`, created by the number's owner or by an admin.
ALTER TABLE kirim_optouts DROP CONSTRAINT IF EXISTS kirim_optouts_cakupan_check;
ALTER TABLE kirim_optouts DROP CONSTRAINT IF EXISTS kirim_optouts_check;
ALTER TABLE kirim_optouts DROP CONSTRAINT IF EXISTS kirim_optouts_check1;
ALTER TABLE kirim_optouts
  ADD COLUMN IF NOT EXISTS device_id uuid NULL REFERENCES kirim_devices (id),
  ADD COLUMN IF NOT EXISTS nomor_tersamar text NULL;
ALTER TABLE kirim_optouts ADD CONSTRAINT kirim_optouts_cakupan_check
  CHECK (cakupan IN ('semua', 'consumer', 'device'));
ALTER TABLE kirim_optouts ADD CONSTRAINT kirim_optouts_scope_check CHECK (
  (cakupan = 'semua' AND consumer_id IS NULL AND device_id IS NULL AND sumber = 'admin')
  OR (cakupan = 'consumer' AND consumer_id IS NOT NULL AND device_id IS NULL)
  OR (cakupan = 'device' AND device_id IS NOT NULL AND (consumer_id IS NOT NULL OR sumber = 'admin'))
);
CREATE UNIQUE INDEX IF NOT EXISTS kirim_optouts_device_idx
  ON kirim_optouts (nomor_hmac, device_id) WHERE cakupan = 'device';

-- §7: new events for the number's owner.
ALTER TABLE kirim_webhook_deliveries DROP CONSTRAINT IF EXISTS kirim_webhook_deliveries_event_type_check;
ALTER TABLE kirim_webhook_deliveries ADD CONSTRAINT kirim_webhook_deliveries_event_type_check
  CHECK (event_type IN ('message.status', 'message.received', 'message.sent', 'group.message.received', 'device.status'));

-- §3: the officer a module named, as `issuer sub`.
ALTER TABLE kirim_audit ADD COLUMN IF NOT EXISTS atas_nama text NULL;
CREATE INDEX IF NOT EXISTS kirim_audit_read_idx
  ON kirim_audit (objek_ref, atas_nama, occurred_at DESC) WHERE aksi = 'percakapan.baca';

-- §10: one row per conversation per import attempt. Export files are not kept.
CREATE TABLE IF NOT EXISTS kirim_history_imports (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  conversation_id uuid NULL REFERENCES kirim_conversations (id),
  jalur text NOT NULL CHECK (jalur IN ('perangkat', 'ekspor')),
  status text NOT NULL DEFAULT 'antre' CHECK (status IN ('antre', 'menunggu_mesin', 'memasukkan', 'selesai', 'gagal')),
  diminta_oleh text NOT NULL CHECK (length(trim(diminta_oleh)) > 0),
  provider_import_id text NULL,
  jumlah_diminta integer NULL CHECK (jumlah_diminta IS NULL OR jumlah_diminta BETWEEN 1 AND 500),
  jumlah_dimasukkan integer NOT NULL DEFAULT 0,
  jumlah_ganda integer NOT NULL DEFAULT 0,
  jumlah_dilewati integer NOT NULL DEFAULT 0,
  galat text NULL CHECK (galat IS NULL OR length(galat) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  selesai_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS kirim_history_imports_device_idx ON kirim_history_imports (device_id, created_at DESC);

REVOKE ALL ON kirim_groups, kirim_history_imports FROM PUBLIC;
