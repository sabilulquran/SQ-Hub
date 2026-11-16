-- ADR-0011 amendment 2026-11-17: Kirim SQ is the WhatsApp API gateway for portals and applications
-- outside SQ Suite. One generic "Aplikasi luar" card holds their numbers; each application gets an
-- API key issued by Kirim SQ (stored as a keyed hash, shown once), bound to one number on that
-- card and revocable without disconnecting the number. No Keycloak client is involved.
-- Additive only. Recovery plan: dump the Hub database before migrating; this file runs in one
-- transaction. Rolling the application back is safe: older code ignores the new columns, the
-- gateway consumer owns nothing until a number is connected, and keys are simply not accepted.

-- The gateway card's consumer: owner of every outside number. Its client_id can never be a
-- Keycloak client id used through the module token path, which refuses gateway consumers anyway.
ALTER TABLE kirim_consumers ADD COLUMN IF NOT EXISTS gerbang boolean NOT NULL DEFAULT false;
INSERT INTO kirim_consumers (id, client_id, nama, gerbang)
VALUES ('00000000-0000-4000-8000-00000000a1a1', 'gerbang:aplikasi-luar', 'aplikasi-luar', true)
ON CONFLICT (nama) DO UPDATE SET gerbang = true, updated_at = now();

-- Webhook per outside number: an application registers its own address with its key; the
-- secret is sealed with the Kirim data key (AAD kirim_devices/webhook_secret_enc/<device id>).
ALTER TABLE kirim_devices
  ADD COLUMN IF NOT EXISTS webhook_url text NULL CHECK (webhook_url IS NULL OR length(webhook_url) <= 2048),
  ADD COLUMN IF NOT EXISTS webhook_secret_enc text NULL;

-- A delivery for the gateway consumer names the number whose webhook receives it.
ALTER TABLE kirim_webhook_deliveries ADD COLUMN IF NOT EXISTS device_id uuid NULL REFERENCES kirim_devices (id);

CREATE TABLE IF NOT EXISTS kirim_api_keys (
  id uuid PRIMARY KEY,
  consumer_id uuid NOT NULL REFERENCES kirim_consumers (id),
  device_id uuid NOT NULL REFERENCES kirim_devices (id),
  nama_aplikasi text NOT NULL CHECK (length(trim(nama_aplikasi)) BETWEEN 1 AND 60),
  awalan text NOT NULL CHECK (awalan ~ '^krm_[A-Za-z0-9_-]{8}$'),
  kunci_hash text NOT NULL UNIQUE CHECK (length(kunci_hash) = 64),
  dibuat_oleh text NOT NULL CHECK (length(trim(dibuat_oleh)) > 0),
  dibuat_at timestamptz NOT NULL DEFAULT now(),
  terakhir_dipakai_at timestamptz NULL,
  dicabut_at timestamptz NULL,
  dicabut_oleh text NULL,
  dicabut_alasan text NULL
);
CREATE INDEX IF NOT EXISTS kirim_api_keys_device_idx ON kirim_api_keys (device_id);
