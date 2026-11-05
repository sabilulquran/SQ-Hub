-- KIRIM-IMPL-003 addendum 2026-11-05 (§11): one Kirim number per WhatsApp phone, and event cursors per
-- engine tenant.
-- Additive: two nullable columns and two indexes. The only rows written are the new
-- kirim_events.provider_ref values, set to the tenant each number uses now, which keeps every number's
-- pull cursor exactly where it is today. kirim_devices.nomor_hmac is filled by the application (it needs
-- the Kirim lookup key) from nomor_enc at start and on every engine status refresh.
-- Recovery plan: dump the Hub database before migrating; this file runs in one transaction
-- (migrate.ts). An application rollback to the previous release is safe: older code never reads the
-- columns. To remove them: DROP INDEX kirim_devices_nomor_hmac_idx, kirim_events_tenant_cursor_idx;
-- ALTER TABLE kirim_devices DROP COLUMN nomor_hmac; ALTER TABLE kirim_events DROP COLUMN provider_ref.

ALTER TABLE kirim_devices
  ADD COLUMN IF NOT EXISTS nomor_hmac text NULL CHECK (nomor_hmac IS NULL OR nomor_hmac ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS kirim_devices_nomor_hmac_idx ON kirim_devices (nomor_hmac) WHERE nomor_hmac IS NOT NULL;

-- The engine numbers events across all tenants, so a number that changes tenant (Sambungkan ulang with
-- a new engine device, or taking over a duplicate's tenant) must read its cursor from the events of the
-- tenant it uses now, not from the highest cursor it ever saw.
ALTER TABLE kirim_events
  ADD COLUMN IF NOT EXISTS provider_ref text NULL CHECK (provider_ref IS NULL OR provider_ref ~ '^[A-Za-z0-9._-]{1,64}$');

UPDATE kirim_events e SET provider_ref = d.provider_ref
  FROM kirim_devices d
 WHERE e.device_id = d.id AND e.provider_ref IS NULL AND d.provider_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS kirim_events_tenant_cursor_idx
  ON kirim_events (device_id, provider_ref, provider_cursor DESC) WHERE provider_cursor IS NOT NULL;
