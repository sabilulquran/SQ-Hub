-- KIRIM-IMPL-003 addendum 2026-11-05 (§11): one Kirim number per WhatsApp phone.
-- Additive only: one nullable column and one partial index. No row is changed here; the HMAC is
-- filled by the application (it needs the Kirim lookup key) from nomor_enc at start and on every
-- engine status refresh.
-- Recovery plan: dump the Hub database before migrating; this file runs in one transaction
-- (migrate.ts). An application rollback to the previous release is safe: older code never reads
-- the column. To remove it: DROP INDEX kirim_devices_nomor_hmac_idx; ALTER TABLE kirim_devices DROP COLUMN nomor_hmac.

ALTER TABLE kirim_devices
  ADD COLUMN IF NOT EXISTS nomor_hmac text NULL CHECK (nomor_hmac IS NULL OR nomor_hmac ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS kirim_devices_nomor_hmac_idx ON kirim_devices (nomor_hmac) WHERE nomor_hmac IS NOT NULL;
