-- KIRIM-IMPL-002 D-6 revisi 2026-10-30: satu orang, satu percakapan.
--
-- WhatsApp kini mengalamatkan chat masuk dengan LID, sedangkan chat yang dimulai petugas memakai nomor telepon.
-- Karena percakapan dikunci pada nilai itu, satu orang mendapat dua percakapan dan balasannya tampak hilang.
-- Mesin (JalurPesan) sudah mengirimkan nomor teleponnya di `peerJidAlt`; kolom ini menyimpan LID-nya supaya
-- percakapan yang dikunci pada nomor tetap ditemukan dari kejadian yang hanya membawa LID.
--
-- Pemulihan: kolom ini boleh dikosongkan tanpa kehilangan pesan (`UPDATE kirim_conversations SET
-- kontak_lid_hmac = NULL;`), dan DROP COLUMN mengembalikan keadaan sebelumnya. Pesan dan percakapan tidak disentuh.
ALTER TABLE kirim_conversations ADD COLUMN IF NOT EXISTS kontak_lid_hmac text
  CHECK (kontak_lid_hmac IS NULL OR kontak_lid_hmac ~ '^[0-9a-f]{64}$');

-- Satu LID hanya boleh menunjuk satu percakapan per perangkat.
CREATE UNIQUE INDEX IF NOT EXISTS kirim_conversations_lid
  ON kirim_conversations (device_id, kontak_lid_hmac) WHERE kontak_lid_hmac IS NOT NULL;
