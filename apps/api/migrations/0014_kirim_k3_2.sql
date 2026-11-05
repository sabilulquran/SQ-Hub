-- KIRIM-IMPL-004 §4: Kirim SQ K3.2 (aksi pesan, panggilan, foto profil, grup bersama) and R3 (kelola grup).
-- Additive only: new nullable or defaulted columns, new tables, and CHECK lists that only allow more
-- values. No row is changed and nothing is dropped, so the production data written since R1 is untouched.
-- Recovery plan (§4.3): dump sq_hub_production before migrating; this file runs in one transaction
-- (migrate.ts), so a failure leaves the database unchanged. An application rollback to the previous
-- release is safe: older code never reads the new columns or tables, and the only new message type
-- (`panggilan`) has no body or media, so the older message list shows it as an empty inbound message.
-- Columns ending in _enc hold AES-256-GCM envelopes; columns ending in _hmac hold HMAC lookups.

-- §4.1 kirim_messages: quotes, forwards, edits, deletes, reactions and calls.
ALTER TABLE kirim_messages
  ADD COLUMN IF NOT EXISTS quoted_message_id uuid NULL REFERENCES kirim_messages (id),
  ADD COLUMN IF NOT EXISTS quoted_wa_message_id text NULL
    CHECK (quoted_wa_message_id IS NULL OR length(quoted_wa_message_id) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS forwarded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  -- `issuer sub` of the officer, or `pengirim`, `admin_grup`, `hp`.
  ADD COLUMN IF NOT EXISTS deleted_by text NULL CHECK (deleted_by IS NULL OR length(deleted_by) BETWEEN 2 AND 512),
  -- One entry per reactor; group members are kept only as an HMAC plus an encrypted identity.
  ADD COLUMN IF NOT EXISTS reactions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reactions) = 'array'),
  ADD COLUMN IF NOT EXISTS panggilan jsonb NULL CHECK (panggilan IS NULL OR jsonb_typeof(panggilan) = 'object'),
  ADD COLUMN IF NOT EXISTS call_id text NULL CHECK (call_id IS NULL OR length(call_id) BETWEEN 1 AND 200);

ALTER TABLE kirim_messages DROP CONSTRAINT IF EXISTS kirim_messages_tipe_check;
ALTER TABLE kirim_messages ADD CONSTRAINT kirim_messages_tipe_check
  CHECK (tipe IN ('teks', 'dokumen', 'gambar', 'audio', 'video', 'stiker', 'lainnya', 'panggilan'));
ALTER TABLE kirim_messages DROP CONSTRAINT IF EXISTS kirim_messages_panggilan_check;
ALTER TABLE kirim_messages ADD CONSTRAINT kirim_messages_panggilan_check
  CHECK ((tipe = 'panggilan') = (panggilan IS NOT NULL) AND (tipe = 'panggilan' OR call_id IS NULL));
ALTER TABLE kirim_messages DROP CONSTRAINT IF EXISTS kirim_messages_deleted_check;
ALTER TABLE kirim_messages ADD CONSTRAINT kirim_messages_deleted_check
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

-- A call is logged once per number, however often the engine repeats its event.
CREATE UNIQUE INDEX IF NOT EXISTS kirim_messages_call_idx
  ON kirim_messages (device_id, call_id) WHERE call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kirim_messages_quoted_idx
  ON kirim_messages (quoted_message_id) WHERE quoted_message_id IS NOT NULL;

-- §4.2 "isi lama tetap tersimpan": every replaced body, encrypted, oldest first.
CREATE TABLE IF NOT EXISTS kirim_message_edits (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES kirim_messages (id),
  body_enc text NULL,
  -- `issuer sub` of the officer, or `pengirim`, `hp`.
  oleh text NOT NULL CHECK (length(oleh) BETWEEN 2 AND 512),
  diganti_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kirim_message_edits_message_idx ON kirim_message_edits (message_id, diganti_at);

-- §4.2 grup bersama: members of each group, both identities when the engine knows them.
CREATE TABLE IF NOT EXISTS kirim_group_members (
  group_id uuid NOT NULL REFERENCES kirim_groups (id),
  member_hmac text NOT NULL CHECK (member_hmac ~ '^[0-9a-f]{64}$'),
  member_enc text NOT NULL,
  member_alt_hmac text NULL CHECK (member_alt_hmac IS NULL OR member_alt_hmac ~ '^[0-9a-f]{64}$'),
  member_alt_enc text NULL,
  admin boolean NOT NULL DEFAULT false,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, member_hmac),
  CHECK ((member_alt_hmac IS NULL) = (member_alt_enc IS NULL))
);
CREATE INDEX IF NOT EXISTS kirim_group_members_member_idx ON kirim_group_members (member_hmac);
CREATE INDEX IF NOT EXISTS kirim_group_members_alt_idx ON kirim_group_members (member_alt_hmac) WHERE member_alt_hmac IS NOT NULL;

-- §4.2 foto profil: one current small photo per conversation or group, as an encrypted file.
CREATE TABLE IF NOT EXISTS kirim_profile_photos (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  conversation_id uuid NULL UNIQUE REFERENCES kirim_conversations (id),
  group_id uuid NULL UNIQUE REFERENCES kirim_groups (id),
  tersedia boolean NOT NULL,
  -- The encrypted file is named by file_id; a new photo gets a new file_id.
  file_id uuid NULL,
  path text NULL,
  sha256 text NULL CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  ukuran integer NULL CHECK (ukuran IS NULL OR ukuran BETWEEN 1 AND 1048576),
  fetched_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((conversation_id IS NULL) <> (group_id IS NULL)),
  CHECK (tersedia = (path IS NOT NULL)),
  CHECK ((path IS NULL) = (file_id IS NULL) AND (path IS NULL) = (sha256 IS NULL))
);
CREATE INDEX IF NOT EXISTS kirim_profile_photos_device_idx ON kirim_profile_photos (device_id, fetched_at);

-- §4.2 R3: participants offered to WhatsApp per number, for the hourly add limit (KIRIM-001 §5.4).
-- A group creation is recorded here too, with its Idempotency-Key, so a retried create returns the same group.
CREATE TABLE IF NOT EXISTS kirim_group_additions (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  group_id uuid NULL REFERENCES kirim_groups (id),
  consumer_id uuid NOT NULL REFERENCES kirim_consumers (id),
  aksi text NOT NULL CHECK (aksi IN ('buat', 'tambah')),
  jumlah integer NOT NULL CHECK (jumlah BETWEEN 0 AND 100),
  idempotency_key text NULL CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  request_hash text NULL CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kirim_group_additions_device_idx ON kirim_group_additions (device_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS kirim_group_additions_key_idx
  ON kirim_group_additions (consumer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- §7: new events for the number's owner.
ALTER TABLE kirim_webhook_deliveries DROP CONSTRAINT IF EXISTS kirim_webhook_deliveries_event_type_check;
ALTER TABLE kirim_webhook_deliveries ADD CONSTRAINT kirim_webhook_deliveries_event_type_check
  CHECK (event_type IN (
    'message.status', 'message.received', 'message.sent', 'group.message.received', 'device.status',
    'message.edited', 'message.deleted', 'message.reaction', 'call.logged'
  ));

REVOKE ALL ON kirim_message_edits, kirim_group_members, kirim_profile_photos, kirim_group_additions FROM PUBLIC;
