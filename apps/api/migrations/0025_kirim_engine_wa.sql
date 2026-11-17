-- KIRIM-IMPL-005 (ADR-0011 amendment 2026-11-17): Kirim SQ gains a WhatsApp engine of its own,
-- `kirim-wa`, a worker process in the SQ Hub release. This migration opens the third provider and
-- adds the worker's own tables. No existing row is rewritten and no number changes engine here:
-- that is one deliberate admin action per number (KIRIM-IMPL-005 §9).
--
-- Additive. Recovery plan: dump the Hub database before migrating; this file runs in one
-- transaction (migrate.ts). An application rollback to the previous release is safe: older code
-- never writes 'wa' and ignores every kirim_wa_* table. To remove:
--   DROP TABLE kirim_wa_cursors, kirim_wa_events, kirim_wa_idempotency, kirim_wa_media,
--     kirim_wa_messages, kirim_wa_history_imports, kirim_wa_contacts, kirim_wa_phone_state,
--     kirim_wa_devices;
--   restore the three CHECK constraints below to ('log','jalurpesan') / ('jalurpesan');
--   DROP INDEX kirim_messages_wa_message_idx; recreate kirim_messages_provider_message_idx.

-- 1. The third provider -------------------------------------------------------------------

ALTER TABLE kirim_devices DROP CONSTRAINT IF EXISTS kirim_devices_provider_check;
ALTER TABLE kirim_devices ADD CONSTRAINT kirim_devices_provider_check
  CHECK (provider IN ('log', 'jalurpesan', 'wa'));

ALTER TABLE kirim_messages DROP CONSTRAINT IF EXISTS kirim_messages_provider_check;
ALTER TABLE kirim_messages ADD CONSTRAINT kirim_messages_provider_check
  CHECK (provider IN ('log', 'jalurpesan', 'wa'));

ALTER TABLE kirim_media_engine_refs DROP CONSTRAINT IF EXISTS kirim_media_engine_refs_provider_check;
ALTER TABLE kirim_media_engine_refs ADD CONSTRAINT kirim_media_engine_refs_provider_check
  CHECK (provider IN ('jalurpesan', 'wa'));

ALTER TABLE kirim_events DROP CONSTRAINT IF EXISTS kirim_events_provider_check;
ALTER TABLE kirim_events ADD CONSTRAINT kirim_events_provider_check
  CHECK (provider IN ('jalurpesan', 'wa'));

-- 2. One WhatsApp message id is one message, whichever engine delivered it ------------------
-- KIRIM-IMPL-005 §8.2. `provider_message_id` holds the WhatsApp message id, which is the same on
-- both engines. The old index put `provider` in the key, so the same message could be stored
-- twice if a number changed engine mid-conversation -- the shape of the `spmb-2` duplicate that
-- once made the SPMB inbox deaf. The engine is dropped from the key; `log` keeps its own space
-- because its ids are made up locally.

-- One index, not one per engine: a number has only ever had one engine until now, so nothing in
-- the existing rows can violate it, and from now on the engine is not part of what makes a
-- message unique. `log` ids are made up locally and cannot collide with a WhatsApp id.
CREATE UNIQUE INDEX IF NOT EXISTS kirim_messages_wa_message_idx
  ON kirim_messages (device_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
DROP INDEX IF EXISTS kirim_messages_provider_message_idx;

-- 3. The worker's own tables ----------------------------------------------------------------
-- Only the `kirim-wa` process reads or writes these; the SQ Hub API never touches them, and the
-- worker never touches `kirim_*`. They live in the Hub database so that one dump (the one
-- `hub-release.sh` already takes) covers everything except the Baileys auth folders, which are
-- files on disk by nature.

CREATE TABLE IF NOT EXISTS kirim_wa_devices (
  kode text PRIMARY KEY CHECK (kode ~ '^[a-z][a-z0-9-]{1,30}$'),
  label text NOT NULL DEFAULT '',
  platform_id text NULL,
  external_tenant_id text NULL,
  wa_jid text NULL,
  wa_phone text NULL,
  wa_display_name text NULL,
  paired_at timestamptz NULL,
  last_connected_at timestamptz NULL,
  last_disconnect_reason text NULL,
  last_disconnect_code integer NULL,
  last_disconnected_at timestamptz NULL,
  requires_reset boolean NOT NULL DEFAULT false,
  -- KIRIM-IMPL-005 §9: held down on purpose, because the other engine holds this session.
  parked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS kirim_wa_devices_tenant_idx
  ON kirim_wa_devices (platform_id, external_tenant_id) WHERE deleted_at IS NULL;

-- The log Kirim SQ pulls by cursor. `cursor` is unique so a second writer fails loudly instead of
-- quietly reordering the log (KIRIM-IMPL-005 §5).
CREATE TABLE IF NOT EXISTS kirim_wa_events (
  id uuid PRIMARY KEY,
  cursor bigint NOT NULL UNIQUE CHECK (cursor > 0),
  kode text NOT NULL,
  type text NOT NULL CHECK (length(type) BETWEEN 1 AND 100),
  message_id text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload_enc text NOT NULL
);
CREATE INDEX IF NOT EXISTS kirim_wa_events_pull_idx ON kirim_wa_events (kode, cursor);
CREATE INDEX IF NOT EXISTS kirim_wa_events_age_idx ON kirim_wa_events (occurred_at);

-- How far Kirim SQ has read per number; only events below it may ever be pruned.
CREATE TABLE IF NOT EXISTS kirim_wa_cursors (
  kode text PRIMARY KEY,
  read_cursor bigint NOT NULL DEFAULT 0 CHECK (read_cursor >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kirim_wa_idempotency (
  kode text NOT NULL,
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 200),
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'done', 'failed')),
  result_enc text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kode, key)
);
CREATE INDEX IF NOT EXISTS kirim_wa_idempotency_age_idx ON kirim_wa_idempotency (updated_at);

CREATE TABLE IF NOT EXISTS kirim_wa_media (
  id uuid PRIMARY KEY,
  kode text NOT NULL,
  source text NOT NULL CHECK (source IN ('inbound', 'upload', 'history')),
  media_type text NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'document', 'sticker')),
  mime text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  original_filename text NULL,
  path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expired_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS kirim_wa_media_age_idx ON kirim_wa_media (created_at) WHERE expired_at IS NULL;

-- The index that answers "what is the oldest message I know in this chat", which is what a
-- request for older history has to anchor on, plus the copy WhatsApp pushes at link time.
CREATE TABLE IF NOT EXISTS kirim_wa_messages (
  id uuid NOT NULL,
  kode text NOT NULL,
  wa_message_id text NOT NULL CHECK (length(wa_message_id) BETWEEN 1 AND 200),
  chat_jid text NOT NULL,
  sender_jid text NULL,
  from_me boolean NOT NULL DEFAULT false,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  body_enc text NULL,
  media_id text NULL,
  bootstrap boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kode, wa_message_id)
);
CREATE INDEX IF NOT EXISTS kirim_wa_messages_anchor_idx ON kirim_wa_messages (kode, chat_jid, occurred_at);
CREATE INDEX IF NOT EXISTS kirim_wa_messages_bootstrap_idx ON kirim_wa_messages (kode, chat_jid) WHERE bootstrap;

CREATE TABLE IF NOT EXISTS kirim_wa_history_imports (
  id uuid PRIMARY KEY,
  kode text NOT NULL,
  chat_jid text NOT NULL,
  source text NOT NULL CHECK (source IN ('whatsapp', 'stored')),
  state text NOT NULL CHECK (state IN ('awaiting', 'completed', 'failed')),
  provider_request_id text NULL,
  reason text NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS kirim_wa_history_imports_request_idx
  ON kirim_wa_history_imports (provider_request_id) WHERE state = 'awaiting';

CREATE TABLE IF NOT EXISTS kirim_wa_contacts (
  kode text NOT NULL,
  jid text NOT NULL,
  canonical_jid text NOT NULL,
  display_name_enc text NULL,
  display_priority integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kode, jid)
);
CREATE INDEX IF NOT EXISTS kirim_wa_contacts_page_idx ON kirim_wa_contacts (kode, updated_at DESC, jid);

-- The phone's own WhatsApp Business lists (quick replies, labels, which label is on which chat).
CREATE TABLE IF NOT EXISTS kirim_wa_phone_state (
  kode text PRIMARY KEY,
  document_enc text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
