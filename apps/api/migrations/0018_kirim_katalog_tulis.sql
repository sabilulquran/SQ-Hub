-- KIRIM-IMPL-004 §17.4 (review of SQ Hub #195, M1): a new catalog product is made once per Idempotency-Key. A row
-- is reserved before the engine is asked, so a retry after a time-out never makes the product twice: `selesai`
-- replays the stored answer, `berjalan` is still at WhatsApp, `tidak_pasti` means WhatsApp may have made it.
-- `hasil` holds the catalog answer only (product id, name, price, flags); no personal data, no phone number.
-- Additive: one new table. Recovery plan: dump the Hub database before migrating; this file runs in one transaction
-- (migrate.ts). Rolling the application back is safe: older code ignores the table. To remove:
--   DROP TABLE kirim_catalog_writes;

CREATE TABLE IF NOT EXISTS kirim_catalog_writes (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES kirim_devices (id) ON DELETE CASCADE,
  consumer_id uuid NOT NULL REFERENCES kirim_consumers (id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'berjalan' CHECK (status IN ('berjalan', 'selesai', 'tidak_pasti')),
  hasil jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kirim_catalog_writes_key_idx ON kirim_catalog_writes (consumer_id, idempotency_key);
CREATE INDEX IF NOT EXISTS kirim_catalog_writes_device_idx ON kirim_catalog_writes (device_id, created_at DESC);
