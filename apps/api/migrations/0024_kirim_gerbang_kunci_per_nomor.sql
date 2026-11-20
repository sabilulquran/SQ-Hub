-- ADR-0011 amendment 2026-11-17 (owner correction): the API key belongs to the NUMBER on the
-- "Aplikasi luar" card, like a JalurPesan device key, not to a registered application. Kirim SQ
-- never learns the application's name; the owner copies the number's key from the card into
-- whatever application they want. The key stays readable from the card (sealed with the Kirim
-- data key), so `kunci_enc` holds it next to the lookup hash. One active key per number.
-- Additive: rows created by 0023 keep working for lookup; without `kunci_enc` they cannot be shown
-- and are replaced by "Putar ulang". Recovery plan: dump the Hub database before migrating.
ALTER TABLE kirim_api_keys ALTER COLUMN nama_aplikasi DROP NOT NULL;
ALTER TABLE kirim_api_keys ADD COLUMN IF NOT EXISTS kunci_enc text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kirim_api_keys_active_device_idx ON kirim_api_keys (device_id) WHERE dicabut_at IS NULL;
