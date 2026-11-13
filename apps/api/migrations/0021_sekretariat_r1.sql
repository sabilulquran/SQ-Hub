-- SEK-IMPL-001 §4: Sekretariat R1 tables. Additive only: no existing table is altered or dropped.
-- Recovery plan (§14 langkah 2): dump sq_hub_production before migrating; this file runs in one
-- transaction (migrate.ts) so a failure leaves the database unchanged; application rollback
-- returns to the previous SQ Hub release and leaves sekretariat_* untouched.
-- People are Organization Directory person ids (`hcis:employee:<uuid>`); actors follow the Kerja
-- convention: a person id, `staff:<sha256>` for a session without a Directory person,
-- `operator:<name>` for the CLI, `system:*` for timers, and `modul:<client>` for machine callers.

-- Jenis naskah: the 21 two-digit codes of Pedoman Tata Naskah Dinas YSQ v0.11 Pasal 8, seeded
-- below. Legacy DOC-003 letter-coded types arrive through the import CLI as aktif = false.
CREATE TABLE IF NOT EXISTS sekretariat_jenis (
  kode text PRIMARY KEY CHECK (kode ~ '^[0-9A-Z][0-9A-Z-]{0,9}$'),
  nama text NOT NULL CHECK (length(trim(nama)) BETWEEN 1 AND 80),
  aktif boolean NOT NULL DEFAULT true,
  urutan integer NOT NULL DEFAULT 0
);

-- Penerbit: the fixed catalog of Pasal 13 ayat (7), seeded below. Committee issuers
-- (PAN./TIM./SATGAS.) are created by the admin with a mandatory end date. Codes never change;
-- issuers are deactivated, not deleted (a code change takes a Keputusan Pengurus).
CREATE TABLE IF NOT EXISTS sekretariat_penerbit (
  id uuid PRIMARY KEY,
  kode text NOT NULL UNIQUE CHECK (kode ~ '^[A-Z0-9][A-Z0-9.\-]{1,29}$'),
  nama text NOT NULL CHECK (length(trim(nama)) BETWEEN 1 AND 120),
  kelompok text NOT NULL CHECK (kelompok IN ('organ', 'direktorat', 'bidang', 'divisi', 'satuan', 'panitia', 'lainnya')),
  unit_id text NULL CHECK (unit_id IS NULL OR unit_id ~ '^hcis:org-node:[0-9a-f-]{36}$'),
  berakhir_pada date NULL,
  aktif boolean NOT NULL DEFAULT true,
  dibuat_oleh text NOT NULL DEFAULT 'system:migration',
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  CHECK (kelompok <> 'panitia' OR berakhir_pada IS NOT NULL)
);

-- Hak ambil nomor = akses kotak/register/arsip penerbit (SEK-IMPL-001 §8): one active row per
-- person per issuer, like DOC-003 grants.
CREATE TABLE IF NOT EXISTS sekretariat_petugas (
  id uuid PRIMARY KEY,
  penerbit_id uuid NOT NULL REFERENCES sekretariat_penerbit (id),
  person_id text NOT NULL CHECK (person_id ~ '^hcis:employee:[0-9a-f-]{36}$'),
  alasan text NOT NULL CHECK (length(trim(alasan)) BETWEEN 1 AND 500),
  diberikan_oleh text NOT NULL,
  diberikan_pada timestamptz NOT NULL DEFAULT now(),
  dicabut_oleh text NULL,
  dicabut_pada timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sekretariat_petugas_aktif_idx
  ON sekretariat_petugas (penerbit_id, person_id) WHERE dicabut_pada IS NULL;
CREATE INDEX IF NOT EXISTS sekretariat_petugas_person_idx ON sekretariat_petugas (person_id);

-- Pemberi disposisi: the Direktur and explicit delegates; they read the foundation inbox.
CREATE TABLE IF NOT EXISTS sekretariat_disposisi_pemegang (
  id uuid PRIMARY KEY,
  person_id text NOT NULL CHECK (person_id ~ '^hcis:employee:[0-9a-f-]{36}$'),
  alasan text NOT NULL CHECK (length(trim(alasan)) BETWEEN 1 AND 500),
  diberikan_oleh text NOT NULL,
  diberikan_pada timestamptz NOT NULL DEFAULT now(),
  dicabut_oleh text NULL,
  dicabut_pada timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sekretariat_disposisi_pemegang_aktif_idx
  ON sekretariat_disposisi_pemegang (person_id) WHERE dicabut_pada IS NULL;

-- DOC-003 D-05 kept: the counter row is locked and raised in the same transaction that inserts
-- the register row, so two allocations at once get consecutive numbers without gaps.
CREATE TABLE IF NOT EXISTS sekretariat_penghitung (
  penerbit_id uuid NOT NULL REFERENCES sekretariat_penerbit (id),
  jenis_kode text NOT NULL REFERENCES sekretariat_jenis (kode),
  tahun integer NOT NULL CHECK (tahun BETWEEN 2000 AND 2200),
  urut_terakhir integer NOT NULL CHECK (urut_terakhir >= 0),
  PRIMARY KEY (penerbit_id, jenis_kode, tahun)
);

-- The register itself. Numbers are never deleted or reused (DOC-003 D-08); a voided number keeps
-- its row. Rows imported from DOC-003 keep their old format string and are unique by their
-- source id; the per-year uniqueness below applies only to numbers this book allocates itself,
-- because legacy monthly-reset sequences may repeat within one year.
CREATE TABLE IF NOT EXISTS sekretariat_nomor (
  id uuid PRIMARY KEY,
  penerbit_id uuid NOT NULL REFERENCES sekretariat_penerbit (id),
  jenis_kode text NOT NULL REFERENCES sekretariat_jenis (kode),
  tahun integer NOT NULL,
  urut integer NOT NULL CHECK (urut >= 1),
  nomor_lengkap text NOT NULL CHECK (length(nomor_lengkap) BETWEEN 5 AND 120),
  tanggal date NOT NULL,
  perihal text NOT NULL DEFAULT '' CHECK (length(perihal) <= 300),
  tujuan text NOT NULL DEFAULT '' CHECK (length(tujuan) <= 300),
  status text NOT NULL DEFAULT 'terpakai' CHECK (status IN ('terpakai', 'dibatalkan')),
  dibatalkan_pada timestamptz NULL,
  dibatalkan_oleh text NULL,
  dibatalkan_alasan text NULL CHECK (dibatalkan_alasan IS NULL OR length(trim(dibatalkan_alasan)) BETWEEN 10 AND 500),
  sumber text NOT NULL DEFAULT 'sekretariat' CHECK (sumber IN ('sekretariat', 'mesin', 'migrasi-doc003')),
  rujukan_modul text NULL CHECK (rujukan_modul IS NULL OR rujukan_modul ~ '^[a-z][a-z0-9-]{1,40}$'),
  rujukan_id text NULL CHECK (rujukan_id IS NULL OR length(rujukan_id) BETWEEN 1 AND 200),
  migrasi_sumber_id text NULL,
  diambil_oleh text NOT NULL,
  diambil_pada timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'dibatalkan' OR (dibatalkan_pada IS NOT NULL AND dibatalkan_alasan IS NOT NULL)),
  CHECK ((rujukan_modul IS NULL) = (rujukan_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS sekretariat_nomor_urut_idx
  ON sekretariat_nomor (penerbit_id, jenis_kode, tahun, urut) WHERE sumber <> 'migrasi-doc003';
CREATE UNIQUE INDEX IF NOT EXISTS sekretariat_nomor_lengkap_idx
  ON sekretariat_nomor (nomor_lengkap) WHERE sumber <> 'migrasi-doc003';
CREATE UNIQUE INDEX IF NOT EXISTS sekretariat_nomor_migrasi_idx
  ON sekretariat_nomor (migrasi_sumber_id) WHERE migrasi_sumber_id IS NOT NULL;
-- D-3: one number per machine reference; a repeated call returns the same number.
CREATE UNIQUE INDEX IF NOT EXISTS sekretariat_nomor_rujukan_idx
  ON sekretariat_nomor (rujukan_modul, rujukan_id) WHERE rujukan_modul IS NOT NULL;
CREATE INDEX IF NOT EXISTS sekretariat_nomor_register_idx ON sekretariat_nomor (penerbit_id, tanggal DESC, diambil_pada DESC);

-- Surat keluar: the archive the book never had. A published letter locks its PDF; a correction
-- is a void plus a new letter (SEK-IMPL-001 §6).
CREATE TABLE IF NOT EXISTS sekretariat_surat_keluar (
  id uuid PRIMARY KEY,
  penerbit_id uuid NOT NULL REFERENCES sekretariat_penerbit (id),
  jenis_kode text NOT NULL REFERENCES sekretariat_jenis (kode),
  nomor_id uuid NULL REFERENCES sekretariat_nomor (id),
  perihal text NOT NULL CHECK (length(trim(perihal)) BETWEEN 3 AND 300),
  tujuan text NOT NULL CHECK (length(trim(tujuan)) BETWEEN 2 AND 300),
  penandatangan text NOT NULL CHECK (length(trim(penandatangan)) BETWEEN 2 AND 200),
  status text NOT NULL DEFAULT 'draf' CHECK (status IN ('draf', 'terbit', 'dibatalkan')),
  retroaktif boolean NOT NULL DEFAULT false,
  nomor_asli text NULL CHECK (nomor_asli IS NULL OR length(trim(nomor_asli)) BETWEEN 3 AND 120),
  tanggal_asli date NULL,
  balasan_atas uuid NULL,
  dibuat_oleh text NOT NULL,
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  terbit_pada timestamptz NULL,
  dibatalkan_pada timestamptz NULL,
  dibatalkan_oleh text NULL,
  dibatalkan_alasan text NULL,
  CHECK (NOT retroaktif OR (nomor_asli IS NOT NULL AND tanggal_asli IS NOT NULL)),
  CHECK (status <> 'terbit' OR retroaktif OR nomor_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS sekretariat_surat_keluar_penerbit_idx ON sekretariat_surat_keluar (penerbit_id, dibuat_pada DESC);
CREATE INDEX IF NOT EXISTS sekretariat_surat_keluar_balasan_idx ON sekretariat_surat_keluar (balasan_atas) WHERE balasan_atas IS NOT NULL;

-- Kotak masuk: one foundation inbox plus one per issuer (SEK-001 §5.2).
CREATE TABLE IF NOT EXISTS sekretariat_kotak (
  id uuid PRIMARY KEY,
  jenis text NOT NULL CHECK (jenis IN ('yayasan', 'penerbit')),
  penerbit_id uuid NULL UNIQUE REFERENCES sekretariat_penerbit (id),
  CHECK ((jenis = 'yayasan') = (penerbit_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS sekretariat_kotak_yayasan_idx ON sekretariat_kotak (jenis) WHERE jenis = 'yayasan';

-- Incoming mail: e-mail pulled read-only over IMAP, and scanned physical letters. E-mail rows
-- are deduplicated by (uid) within one mailbox generation and by Message-ID across generations.
CREATE TABLE IF NOT EXISTS sekretariat_surat_masuk (
  id uuid PRIMARY KEY,
  kotak_id uuid NOT NULL REFERENCES sekretariat_kotak (id),
  kanal text NOT NULL CHECK (kanal IN ('email', 'fisik')),
  dari text NOT NULL CHECK (length(trim(dari)) BETWEEN 1 AND 300),
  perihal text NOT NULL DEFAULT '' CHECK (length(perihal) <= 500),
  isi_teks text NOT NULL DEFAULT '' CHECK (length(isi_teks) <= 200000),
  diterima_pada timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'baru' CHECK (status IN ('baru', 'didisposisi', 'selesai', 'spam')),
  email_message_id text NULL,
  email_uidvalidity text NULL,
  email_uid bigint NULL,
  dicatat_oleh text NULL,
  CHECK (kanal <> 'email' OR (email_uid IS NOT NULL AND email_uidvalidity IS NOT NULL)),
  CHECK (kanal <> 'fisik' OR dicatat_oleh IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS sekretariat_surat_masuk_uid_idx
  ON sekretariat_surat_masuk (email_uidvalidity, email_uid) WHERE email_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sekretariat_surat_masuk_msgid_idx
  ON sekretariat_surat_masuk (email_message_id) WHERE email_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sekretariat_surat_masuk_kotak_idx ON sekretariat_surat_masuk (kotak_id, status, diterima_pada DESC);

-- Disposisi: forwarding an item from the foundation inbox into an issuer's inbox, with a note
-- and a deadline. Never numbered (pedoman Pasal 13 ayat 6).
CREATE TABLE IF NOT EXISTS sekretariat_disposisi (
  id uuid PRIMARY KEY,
  surat_masuk_id uuid NOT NULL REFERENCES sekretariat_surat_masuk (id),
  ke_kotak_id uuid NOT NULL REFERENCES sekretariat_kotak (id),
  catatan text NOT NULL CHECK (length(trim(catatan)) BETWEEN 1 AND 1000),
  tenggat_pada date NULL,
  oleh text NOT NULL,
  pada timestamptz NOT NULL DEFAULT now(),
  selesai_pada timestamptz NULL,
  selesai_oleh text NULL,
  selesai_keterangan text NULL CHECK (selesai_keterangan IS NULL OR length(trim(selesai_keterangan)) BETWEEN 1 AND 1000),
  CHECK ((selesai_pada IS NULL) = (selesai_oleh IS NULL))
);

CREATE INDEX IF NOT EXISTS sekretariat_disposisi_kotak_idx ON sekretariat_disposisi (ke_kotak_id, selesai_pada);
CREATE INDEX IF NOT EXISTS sekretariat_disposisi_surat_idx ON sekretariat_disposisi (surat_masuk_id);

-- Files: the published letter PDF, scans, and e-mail attachments. Rows store a UUID storage key
-- and a checksum, never the original name as a path (Kerja/Karir pattern).
CREATE TABLE IF NOT EXISTS sekretariat_berkas (
  id uuid PRIMARY KEY,
  pemilik_jenis text NOT NULL CHECK (pemilik_jenis IN ('surat_keluar', 'surat_masuk')),
  pemilik_id uuid NOT NULL,
  nama text NOT NULL CHECK (length(trim(nama)) BETWEEN 1 AND 200),
  kunci text NOT NULL UNIQUE,
  mime text NOT NULL,
  -- The runtime limit is SEKRETARIAT_MAX_UPLOAD_BYTES (10 MiB by default); the schema only guards
  -- against absurd rows so raising the env within its 100 MB bound needs no migration.
  ukuran bigint NOT NULL CHECK (ukuran BETWEEN 1 AND 104857600),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  terkunci boolean NOT NULL DEFAULT false,
  diunggah_oleh text NOT NULL,
  diunggah_pada timestamptz NOT NULL DEFAULT now(),
  dihapus boolean NOT NULL DEFAULT false,
  dihapus_pada timestamptz NULL,
  berkas_dibuang_pada timestamptz NULL
);

CREATE INDEX IF NOT EXISTS sekretariat_berkas_pemilik_idx ON sekretariat_berkas (pemilik_jenis, pemilik_id) WHERE NOT dihapus;

-- IMAP progress per mailbox: UIDVALIDITY plus the last ingested UID, and the last error for the
-- admin screen (SEK-IMPL-001 §7). Read-only on the mailbox itself.
CREATE TABLE IF NOT EXISTS sekretariat_mail_state (
  mailbox text PRIMARY KEY,
  uidvalidity text NULL,
  uid_terakhir bigint NOT NULL DEFAULT 0,
  terakhir_tarik_pada timestamptz NULL,
  galat_terakhir text NULL,
  galat_pada timestamptz NULL
);

CREATE TABLE IF NOT EXISTS sekretariat_admins (
  id uuid PRIMARY KEY,
  identity_issuer text NOT NULL,
  identity_subject text NOT NULL,
  granted_by text NOT NULL,
  alasan text NOT NULL CHECK (length(trim(alasan)) BETWEEN 1 AND 500),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sekretariat_admins_aktif_idx
  ON sekretariat_admins (identity_issuer, identity_subject) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS sekretariat_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aktor text NOT NULL,
  aksi text NOT NULL,
  objek_jenis text NOT NULL,
  objek_ref text NOT NULL,
  alasan text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}',
  pada timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sekretariat_audit_pada_idx ON sekretariat_audit (pada DESC);

-- Seed: the 21 active types of Pedoman Tata Naskah Dinas YSQ v0.11 Pasal 8.
INSERT INTO sekretariat_jenis (kode, nama, urutan) VALUES
  ('01', 'Keputusan', 1), ('02', 'Perjanjian/Kesepakatan', 2), ('03', 'Edaran', 3), ('04', 'Surat Tugas', 4),
  ('05', 'Kuasa', 5), ('06', 'Pernyataan', 6), ('07', 'Peringatan', 7), ('08', 'Keterangan', 8),
  ('09', 'Rekomendasi', 9), ('10', 'Permohonan', 10), ('11', 'Pemberitahuan/Pengumuman', 11), ('12', 'Undangan', 12),
  ('13', 'Panggilan', 13), ('14', 'Balasan/Tanggapan', 14), ('15', 'Penawaran', 15), ('16', 'Pengantar', 16),
  ('17', 'Nota Dinas/Memo', 17), ('18', 'Berita Acara', 18), ('19', 'Laporan', 19), ('20', 'Notula', 20),
  ('21', 'Sertifikat/Piagam', 21)
ON CONFLICT (kode) DO NOTHING;

-- Seed: the fixed issuer catalog of Pasal 13 ayat (7). Committee issuers are created at runtime.
INSERT INTO sekretariat_penerbit (id, kode, nama, kelompok) VALUES
  ('b4a1c67e-0000-4000-8000-000000000001', 'PEMB.YSQ', 'Pembina Yayasan Sabilul Qur''an', 'organ'),
  ('b4a1c67e-0000-4000-8000-000000000002', 'PENG.YSQ', 'Pengurus Yayasan Sabilul Qur''an', 'organ'),
  ('b4a1c67e-0000-4000-8000-000000000003', 'PENGAWAS.YSQ', 'Pengawas Yayasan Sabilul Qur''an', 'organ'),
  ('b4a1c67e-0000-4000-8000-000000000004', 'DIR.YSQ', 'Direktorat', 'direktorat'),
  ('b4a1c67e-0000-4000-8000-000000000005', 'PEND.YSQ', 'Bidang Pendidikan', 'bidang'),
  ('b4a1c67e-0000-4000-8000-000000000006', 'OPS.YSQ', 'Bidang Operasional', 'bidang'),
  ('b4a1c67e-0000-4000-8000-000000000007', 'HCM.YSQ', 'Divisi Human Capital Management', 'divisi'),
  ('b4a1c67e-0000-4000-8000-000000000008', 'GA.YSQ', 'Divisi General Affairs', 'divisi'),
  ('b4a1c67e-0000-4000-8000-000000000009', 'KEU.YSQ', 'Divisi Keuangan', 'divisi'),
  ('b4a1c67e-0000-4000-8000-00000000000a', 'MEDIA.YSQ', 'Divisi Komunikasi Marketing dan Media', 'divisi'),
  ('b4a1c67e-0000-4000-8000-00000000000b', 'SOSIAL.YSQ', 'Divisi Sosial', 'divisi'),
  ('b4a1c67e-0000-4000-8000-00000000000c', 'USAHA.YSQ', 'Divisi Usaha', 'divisi'),
  ('b4a1c67e-0000-4000-8000-00000000000d', 'SDITTSQ', 'SDIT Tahfizh Sabilul Qur''an', 'satuan'),
  ('b4a1c67e-0000-4000-8000-00000000000e', 'SMPITTSQ', 'SMPIT Tahfizh Sabilul Qur''an', 'satuan'),
  ('b4a1c67e-0000-4000-8000-00000000000f', 'PKBMSQ', 'PKBM Sabilul Qur''an', 'satuan'),
  ('b4a1c67e-0000-4000-8000-000000000010', 'PESTSQ', 'Pesantren Tahfizh Sabilul Qur''an', 'satuan'),
  ('b4a1c67e-0000-4000-8000-000000000011', 'TTSQ', 'Taman Tahfizh Sabilul Qur''an', 'satuan')
ON CONFLICT (kode) DO NOTHING;

-- Seed: the foundation inbox and one inbox per seeded issuer.
INSERT INTO sekretariat_kotak (id, jenis, penerbit_id)
  SELECT gen_random_uuid(), 'yayasan', NULL
  WHERE NOT EXISTS (SELECT 1 FROM sekretariat_kotak WHERE jenis = 'yayasan');
INSERT INTO sekretariat_kotak (id, jenis, penerbit_id)
  SELECT gen_random_uuid(), 'penerbit', p.id FROM sekretariat_penerbit p
  WHERE NOT EXISTS (SELECT 1 FROM sekretariat_kotak k WHERE k.penerbit_id = p.id);

-- Down: additive-only migration; recovery is restoring the pre-migration dump. Once real rows
-- exist, sekretariat_* must not be dropped.
