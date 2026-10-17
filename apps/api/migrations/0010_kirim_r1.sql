-- KIRIM-IMPL-001 §4: Kirim SQ R1 tables. Additive only: no existing table is altered or dropped.
-- Recovery plan (§4.2): dump sq_hub_production before migrating; this file runs in one
-- transaction (migrate.ts) so a failure leaves the database unchanged; application rollback
-- returns to the previous SQ Hub release and leaves kirim_* untouched. No DROP in production
-- once real messages exist.
-- Columns ending in _enc hold AES-256-GCM envelopes (v1.<kid>.<iv>.<ciphertext>.<tag>);
-- columns ending in _hmac hold hex HMAC-SHA256 lookups. Neither holds plaintext.

CREATE TABLE IF NOT EXISTS kirim_consumers (
  id uuid PRIMARY KEY,
  client_id text NOT NULL UNIQUE CHECK (length(trim(client_id)) BETWEEN 1 AND 255),
  nama text NOT NULL UNIQUE CHECK (nama ~ '^[a-z][a-z0-9-]{1,30}$'),
  webhook_url text NULL CHECK (webhook_url IS NULL OR length(webhook_url) <= 2048),
  webhook_secret_ref text NULL CHECK (webhook_secret_ref IS NULL OR webhook_secret_ref ~ '^KIRIM_CONSUMER_SECRET_[A-Z0-9_]{1,64}$'),
  kuota_harian integer NOT NULL DEFAULT 500 CHECK (kuota_harian BETWEEN 1 AND 100000),
  aktif boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((webhook_url IS NULL) = (webhook_secret_ref IS NULL))
);

CREATE TABLE IF NOT EXISTS kirim_devices (
  id uuid PRIMARY KEY,
  kode text NOT NULL UNIQUE CHECK (kode ~ '^[a-z][a-z0-9-]{1,30}$'),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 100),
  pemilik_consumer_id uuid NOT NULL REFERENCES kirim_consumers (id),
  provider text NOT NULL DEFAULT 'log' CHECK (provider IN ('log', 'jalurpesan')),
  provider_ref text NULL CHECK (provider_ref IS NULL OR provider_ref ~ '^[A-Za-z0-9._-]{1,64}$'),
  nomor_tersamar text NULL,
  nomor_enc text NULL,
  status text NOT NULL DEFAULT 'belum_dipasang'
    CHECK (status IN ('belum_dipasang', 'menunggu_pairing', 'tersambung', 'terputus', 'nonaktif')),
  antrean_dijeda boolean NOT NULL DEFAULT false,
  rate_per_menit integer NOT NULL DEFAULT 10 CHECK (rate_per_menit BETWEEN 1 AND 60),
  jam_kirim_mulai time NOT NULL DEFAULT '06:00',
  jam_kirim_selesai time NOT NULL DEFAULT '21:00',
  status_berubah_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jam_kirim_mulai < jam_kirim_selesai),
  CHECK (provider = 'log' OR provider_ref IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS kirim_routes (
  consumer_id uuid NOT NULL REFERENCES kirim_consumers (id),
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  jenis text NOT NULL CHECK (jenis IN ('notifikasi', 'kode')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_id, device_id, jenis)
);

CREATE TABLE IF NOT EXISTS kirim_conversations (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  kontak_hmac text NOT NULL CHECK (kontak_hmac ~ '^[0-9a-f]{64}$'),
  kontak_enc text NOT NULL,
  kontak_jenis text NOT NULL CHECK (kontak_jenis IN ('pn', 'lid')),
  nama_profil_enc text NULL,
  pesan_terakhir_at timestamptz NULL,
  belum_dibaca integer NOT NULL DEFAULT 0 CHECK (belum_dibaca >= 0),
  ditangani_oleh text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, kontak_hmac)
);

CREATE TABLE IF NOT EXISTS kirim_media (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  arah text NOT NULL CHECK (arah IN ('masuk', 'keluar')),
  mime text NOT NULL CHECK (length(mime) BETWEEN 1 AND 255),
  ukuran bigint NOT NULL CHECK (ukuran >= 0),
  sha256 text NULL CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  path text NULL,
  dienkripsi boolean NOT NULL DEFAULT true,
  -- D-7: inbound media that was not copied keeps metadata only, with the reason.
  tidak_disalin text NULL CHECK (tidak_disalin IS NULL OR tidak_disalin IN ('terlalu_besar', 'disk_rendah', 'gagal_unduh')),
  uploaded_by_consumer_id uuid NULL REFERENCES kirim_consumers (id),
  provider_media_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((path IS NULL) = (tidak_disalin IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS kirim_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES kirim_conversations (id),
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  arah text NOT NULL CHECK (arah IN ('masuk', 'keluar')),
  asal text NULL CHECK (asal IS NULL OR asal IN ('otomatis', 'petugas')),
  petugas text NULL,
  jenis text NULL CHECK (jenis IS NULL OR jenis IN ('notifikasi', 'kode')),
  tipe text NOT NULL CHECK (tipe IN ('teks', 'dokumen', 'gambar', 'audio', 'video', 'stiker', 'lainnya')),
  body_enc text NULL,
  body_disamarkan boolean NOT NULL DEFAULT false,
  media_id uuid NULL REFERENCES kirim_media (id),
  provider text NOT NULL CHECK (provider IN ('log', 'jalurpesan')),
  provider_message_id text NULL,
  dry_run boolean NOT NULL DEFAULT false,
  status text NOT NULL
    CHECK (status IN ('antre', 'diserahkan', 'terkirim', 'dibaca', 'gagal', 'dibatalkan', 'diterima')),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((arah = 'keluar') = (asal IS NOT NULL)),
  CHECK (arah = 'keluar' OR status = 'diterima')
);

CREATE UNIQUE INDEX IF NOT EXISTS kirim_messages_provider_message_idx
  ON kirim_messages (provider, device_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS kirim_messages_conversation_time_idx
  ON kirim_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS kirim_messages_rate_idx
  ON kirim_messages (device_id, provider_at)
  WHERE arah = 'keluar' AND asal = 'otomatis' AND provider_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS kirim_outbox (
  id uuid PRIMARY KEY,
  consumer_id uuid NOT NULL REFERENCES kirim_consumers (id),
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  jenis text NOT NULL CHECK (jenis IN ('notifikasi', 'kode')),
  prioritas text NOT NULL CHECK (prioritas IN ('kode', 'tinggi', 'normal')),
  to_hmac text NOT NULL CHECK (to_hmac ~ '^[0-9a-f]{64}$'),
  ref text NULL CHECK (ref IS NULL OR length(ref) <= 200),
  message_id uuid NOT NULL UNIQUE REFERENCES kirim_messages (id),
  status text NOT NULL DEFAULT 'antre'
    CHECK (status IN ('antre', 'diserahkan', 'terkirim', 'dibaca', 'gagal', 'dibatalkan')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS kirim_outbox_due_idx
  ON kirim_outbox (device_id, next_attempt_at)
  WHERE status = 'antre';
CREATE INDEX IF NOT EXISTS kirim_outbox_consumer_day_idx
  ON kirim_outbox (consumer_id, created_at);

CREATE TABLE IF NOT EXISTS kirim_media_engine_refs (
  media_id uuid NOT NULL REFERENCES kirim_media (id),
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  provider text NOT NULL CHECK (provider IN ('jalurpesan')),
  provider_media_id text NOT NULL CHECK (length(provider_media_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_id, device_id, provider)
);

CREATE TABLE IF NOT EXISTS kirim_optouts (
  id uuid PRIMARY KEY,
  nomor_hmac text NOT NULL CHECK (nomor_hmac ~ '^[0-9a-f]{64}$'),
  cakupan text NOT NULL CHECK (cakupan IN ('semua', 'consumer')),
  consumer_id uuid NULL REFERENCES kirim_consumers (id),
  alasan text NOT NULL CHECK (length(trim(alasan)) BETWEEN 1 AND 500),
  sumber text NOT NULL CHECK (sumber IN ('admin', 'consumer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((cakupan = 'semua') = (consumer_id IS NULL)),
  CHECK (cakupan = 'consumer' OR sumber = 'admin')
);

CREATE UNIQUE INDEX IF NOT EXISTS kirim_optouts_semua_idx
  ON kirim_optouts (nomor_hmac) WHERE cakupan = 'semua';
CREATE UNIQUE INDEX IF NOT EXISTS kirim_optouts_consumer_idx
  ON kirim_optouts (nomor_hmac, consumer_id) WHERE cakupan = 'consumer';

CREATE TABLE IF NOT EXISTS kirim_events (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  provider text NOT NULL CHECK (provider IN ('jalurpesan')),
  provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 200),
  provider_cursor bigint NULL CHECK (provider_cursor IS NULL OR provider_cursor >= 0),
  jenis text NOT NULL CHECK (length(jenis) BETWEEN 1 AND 100),
  payload_ringkas jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS kirim_events_cursor_idx
  ON kirim_events (device_id, provider_cursor DESC)
  WHERE provider_cursor IS NOT NULL;

CREATE TABLE IF NOT EXISTS kirim_webhook_deliveries (
  id uuid PRIMARY KEY,
  consumer_id uuid NOT NULL REFERENCES kirim_consumers (id),
  event_type text NOT NULL CHECK (event_type IN ('message.status', 'message.received', 'device.status')),
  payload_enc text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retry', 'berhasil', 'habis')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status_code integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS kirim_webhook_deliveries_due_idx
  ON kirim_webhook_deliveries (next_attempt_at)
  WHERE status IN ('pending', 'retry');

CREATE TABLE IF NOT EXISTS kirim_admins (
  id uuid PRIMARY KEY,
  identity_issuer text NOT NULL CHECK (length(trim(identity_issuer)) > 0),
  identity_subject text NOT NULL CHECK (length(trim(identity_subject)) > 0),
  granted_by text NOT NULL CHECK (length(trim(granted_by)) > 0),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  alasan text NOT NULL CHECK (length(trim(alasan)) BETWEEN 1 AND 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS kirim_admins_active_idx
  ON kirim_admins (identity_issuer, identity_subject) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS kirim_audit (
  id uuid PRIMARY KEY,
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'service', 'system')),
  actor_ref text NOT NULL CHECK (length(trim(actor_ref)) > 0),
  aksi text NOT NULL CHECK (length(trim(aksi)) > 0),
  objek_jenis text NOT NULL CHECK (length(trim(objek_jenis)) > 0),
  objek_ref text NOT NULL CHECK (length(trim(objek_ref)) > 0),
  hasil text NOT NULL CHECK (hasil IN ('berhasil', 'gagal')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kirim_audit_time_idx ON kirim_audit (occurred_at DESC);

-- §9: one encrypted canary per data-key id (and one lookup-key check), so a start with a
-- missing or wrong key is refused instead of writing unreadable history.
CREATE TABLE IF NOT EXISTS kirim_key_canaries (
  purpose text PRIMARY KEY CHECK (purpose ~ '^(data:[A-Za-z0-9_-]{1,32}|lookup)$'),
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON
  kirim_consumers, kirim_devices, kirim_routes, kirim_conversations, kirim_media,
  kirim_messages, kirim_outbox, kirim_media_engine_refs, kirim_optouts, kirim_events,
  kirim_webhook_deliveries, kirim_admins, kirim_audit, kirim_key_canaries
FROM PUBLIC;
