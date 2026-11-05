-- KIRIM-IMPL-002 §10.3 (2026-11-05): import every private chat from JalurPesan's initial history copy.
-- Additive: one more allowed `jalur` value and one nullable column. No row is changed.
-- `chat_enc` holds the chat JID and number of one stored chat (AES-256-GCM envelope, AAD per row);
-- a `salinan` row without it is the request that the runner expands into one row per chat.
-- Recovery plan: dump the Hub database before migrating; this file runs in one transaction (migrate.ts).
-- An application rollback is safe while no `salinan` row exists; with such rows the older runner ignores
-- them (it reads `perangkat` rows only). To remove: delete the `salinan` rows, drop the column and restore
-- the old CHECK (jalur IN ('perangkat', 'ekspor')).

ALTER TABLE kirim_history_imports DROP CONSTRAINT IF EXISTS kirim_history_imports_jalur_check;
ALTER TABLE kirim_history_imports
  ADD CONSTRAINT kirim_history_imports_jalur_check CHECK (jalur IN ('perangkat', 'ekspor', 'salinan'));

ALTER TABLE kirim_history_imports ADD COLUMN IF NOT EXISTS chat_enc text NULL;

CREATE INDEX IF NOT EXISTS kirim_history_imports_salinan_idx
  ON kirim_history_imports (created_at) WHERE jalur = 'salinan' AND status IN ('antre', 'memasukkan');
