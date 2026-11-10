-- KERJA-IMPL-001 §4: Kerja SQ R1 tables. Additive only: no existing table is altered or dropped.
-- Recovery plan (§15 langkah 2): dump sq_hub_production before migrating; this file runs in one
-- transaction (migrate.ts) so a failure leaves the database unchanged; application rollback
-- returns to the previous SQ Hub release and leaves kerja_* untouched. No DROP in production
-- once real cards exist.
-- People are Organization Directory person ids (`hcis:employee:<uuid>`); there is no user table
-- (KERJA-001 §7.3 nomor 1). Actors are a person id, `staff:<sha256>` for a session without a
-- Directory person, or `operator:<name>` for the CLI.

CREATE TABLE IF NOT EXISTS kerja_ruang (
  id uuid PRIMARY KEY,
  jenis text NOT NULL CHECK (jenis IN ('tetap', 'panitia')),
  nama text NOT NULL CHECK (length(trim(nama)) BETWEEN 1 AND 120),
  unit_id text NULL CHECK (unit_id IS NULL OR unit_id ~ '^hcis:org-node:[0-9a-f-]{36}$'),
  berakhir_pada date NULL,
  status text NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'arsip')),
  kuota_bytes bigint NULL CHECK (kuota_bytes IS NULL OR kuota_bytes BETWEEN 1048576 AND 107374182400),
  dibuat_oleh text NOT NULL CHECK (length(trim(dibuat_oleh)) BETWEEN 1 AND 300),
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  diperbarui_pada timestamptz NOT NULL DEFAULT now(),
  CHECK (jenis <> 'panitia' OR berakhir_pada IS NOT NULL),
  CHECK (jenis <> 'tetap' OR unit_id IS NOT NULL)
);

-- One active permanent room per Directory unit.
CREATE UNIQUE INDEX IF NOT EXISTS kerja_ruang_unit_aktif_idx
  ON kerja_ruang (unit_id) WHERE jenis = 'tetap' AND status = 'aktif';

CREATE TABLE IF NOT EXISTS kerja_ruang_anggota (
  ruang_id uuid NOT NULL REFERENCES kerja_ruang (id),
  person_id text NOT NULL CHECK (person_id ~ '^hcis:employee:[0-9a-f-]{36}$'),
  peran text NOT NULL CHECK (peran IN ('pj', 'anggota', 'peninjau')),
  dicatat_oleh text NOT NULL CHECK (length(trim(dicatat_oleh)) BETWEEN 1 AND 300),
  dicatat_pada timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ruang_id, person_id)
);

CREATE INDEX IF NOT EXISTS kerja_ruang_anggota_person_idx ON kerja_ruang_anggota (person_id);

CREATE TABLE IF NOT EXISTS kerja_ruang_usulan (
  id uuid PRIMARY KEY,
  ruang_id uuid NOT NULL REFERENCES kerja_ruang (id),
  person_id text NOT NULL CHECK (person_id ~ '^hcis:employee:[0-9a-f-]{36}$'),
  jenis text NOT NULL CHECK (jenis IN ('tambah', 'keluarkan')),
  alasan text NOT NULL CHECK (length(trim(alasan)) BETWEEN 1 AND 300),
  directory_version text NOT NULL,
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  keputusan text NULL CHECK (keputusan IS NULL OR keputusan IN ('diterima', 'ditolak', 'kedaluwarsa')),
  ditindak_pada timestamptz NULL,
  ditindak_oleh text NULL,
  CHECK ((keputusan IS NULL) = (ditindak_pada IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS kerja_ruang_usulan_terbuka_idx
  ON kerja_ruang_usulan (ruang_id, person_id, jenis) WHERE keputusan IS NULL;

CREATE TABLE IF NOT EXISTS kerja_papan (
  id uuid PRIMARY KEY,
  ruang_id uuid NOT NULL REFERENCES kerja_ruang (id),
  nama text NOT NULL CHECK (length(trim(nama)) BETWEEN 1 AND 80),
  urutan integer NOT NULL DEFAULT 0,
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kerja_papan_ruang_idx ON kerja_papan (ruang_id, urutan);

CREATE TABLE IF NOT EXISTS kerja_kolom (
  id uuid PRIMARY KEY,
  papan_id uuid NOT NULL REFERENCES kerja_papan (id),
  nama text NOT NULL CHECK (length(trim(nama)) BETWEEN 1 AND 60),
  urutan integer NOT NULL DEFAULT 0,
  menandai_selesai boolean NOT NULL DEFAULT false,
  dihapus boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS kerja_kolom_papan_idx ON kerja_kolom (papan_id, urutan);

CREATE TABLE IF NOT EXISTS kerja_kartu (
  id uuid PRIMARY KEY,
  ruang_id uuid NOT NULL REFERENCES kerja_ruang (id),
  kolom_id uuid NOT NULL REFERENCES kerja_kolom (id),
  judul text NOT NULL CHECK (length(trim(judul)) BETWEEN 1 AND 200),
  uraian text NOT NULL DEFAULT '' CHECK (length(uraian) <= 40000),
  uraian_teks text NOT NULL DEFAULT '' CHECK (length(uraian_teks) <= 20000),
  mulai_pada timestamptz NULL,
  tenggat_pada timestamptz NULL,
  selesai_jenis text NULL CHECK (selesai_jenis IS NULL OR selesai_jenis IN ('tuntas', 'batal', 'ditunda')),
  selesai_pada timestamptz NULL,
  selesai_oleh text NULL,
  arsip boolean NOT NULL DEFAULT false,
  posisi numeric(30, 15) NOT NULL,
  asal_modul text NULL,
  asal_jenis text NULL,
  asal_id text NULL,
  asal_judul text NULL,
  dibuat_oleh text NOT NULL CHECK (length(trim(dibuat_oleh)) BETWEEN 1 AND 300),
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  diperbarui_pada timestamptz NOT NULL DEFAULT now(),
  CHECK ((selesai_jenis IS NULL) = (selesai_pada IS NULL) AND (selesai_jenis IS NULL) = (selesai_oleh IS NULL)),
  CHECK (mulai_pada IS NULL OR tenggat_pada IS NULL OR mulai_pada <= tenggat_pada),
  CHECK ((asal_modul IS NULL) = (asal_id IS NULL))
);

CREATE INDEX IF NOT EXISTS kerja_kartu_kolom_posisi_idx ON kerja_kartu (kolom_id, posisi);
CREATE INDEX IF NOT EXISTS kerja_kartu_ruang_idx ON kerja_kartu (ruang_id, arsip);
CREATE INDEX IF NOT EXISTS kerja_kartu_tenggat_idx ON kerja_kartu (tenggat_pada) WHERE selesai_jenis IS NULL AND arsip = false;
CREATE INDEX IF NOT EXISTS kerja_kartu_mulai_idx ON kerja_kartu (mulai_pada) WHERE selesai_jenis IS NULL AND arsip = false;

CREATE TABLE IF NOT EXISTS kerja_kartu_orang (
  kartu_id uuid NOT NULL REFERENCES kerja_kartu (id),
  person_id text NOT NULL CHECK (person_id ~ '^hcis:employee:[0-9a-f-]{36}$'),
  PRIMARY KEY (kartu_id, person_id)
);

CREATE INDEX IF NOT EXISTS kerja_kartu_orang_person_idx ON kerja_kartu_orang (person_id);

CREATE TABLE IF NOT EXISTS kerja_label (
  id uuid PRIMARY KEY,
  papan_id uuid NOT NULL REFERENCES kerja_papan (id),
  nama text NOT NULL CHECK (length(trim(nama)) BETWEEN 1 AND 40),
  warna text NOT NULL CHECK (warna IN ('abu', 'merah', 'oranye', 'kuning', 'hijau', 'teal', 'biru', 'ungu', 'merah-muda')),
  dihapus boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS kerja_label_papan_idx ON kerja_label (papan_id);

CREATE TABLE IF NOT EXISTS kerja_kartu_label (
  kartu_id uuid NOT NULL REFERENCES kerja_kartu (id),
  label_id uuid NOT NULL REFERENCES kerja_label (id),
  PRIMARY KEY (kartu_id, label_id)
);

CREATE TABLE IF NOT EXISTS kerja_ceklis (
  id uuid PRIMARY KEY,
  kartu_id uuid NOT NULL REFERENCES kerja_kartu (id),
  nama text NOT NULL CHECK (length(trim(nama)) BETWEEN 1 AND 120),
  urutan integer NOT NULL DEFAULT 0,
  dihapus boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS kerja_ceklis_kartu_idx ON kerja_ceklis (kartu_id, urutan);

CREATE TABLE IF NOT EXISTS kerja_ceklis_item (
  id uuid PRIMARY KEY,
  ceklis_id uuid NOT NULL REFERENCES kerja_ceklis (id),
  nama text NOT NULL CHECK (length(trim(nama)) BETWEEN 1 AND 300),
  tenggat_pada timestamptz NULL,
  selesai boolean NOT NULL DEFAULT false,
  selesai_pada timestamptz NULL,
  selesai_oleh text NULL,
  urutan numeric(30, 15) NOT NULL,
  dihapus boolean NOT NULL DEFAULT false,
  CHECK (selesai = (selesai_pada IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS kerja_ceklis_item_ceklis_idx ON kerja_ceklis_item (ceklis_id, urutan);

CREATE TABLE IF NOT EXISTS kerja_ceklis_item_orang (
  item_id uuid NOT NULL REFERENCES kerja_ceklis_item (id),
  person_id text NOT NULL CHECK (person_id ~ '^hcis:employee:[0-9a-f-]{36}$'),
  PRIMARY KEY (item_id, person_id)
);

CREATE INDEX IF NOT EXISTS kerja_ceklis_item_orang_person_idx ON kerja_ceklis_item_orang (person_id);

CREATE TABLE IF NOT EXISTS kerja_lampiran (
  id uuid PRIMARY KEY,
  ruang_id uuid NOT NULL REFERENCES kerja_ruang (id),
  pemilik_jenis text NOT NULL CHECK (pemilik_jenis IN ('kartu', 'ceklis_item', 'ruang')),
  pemilik_id uuid NOT NULL,
  nama text NOT NULL CHECK (length(trim(nama)) BETWEEN 1 AND 200),
  kunci_penyimpanan uuid NOT NULL UNIQUE,
  mime text NOT NULL CHECK (length(mime) BETWEEN 1 AND 120),
  ukuran bigint NOT NULL CHECK (ukuran BETWEEN 1 AND 104857600),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  diunggah_oleh text NOT NULL CHECK (length(trim(diunggah_oleh)) BETWEEN 1 AND 300),
  diunggah_pada timestamptz NOT NULL DEFAULT now(),
  dihapus boolean NOT NULL DEFAULT false,
  dihapus_pada timestamptz NULL,
  dihapus_oleh text NULL,
  berkas_dibuang_pada timestamptz NULL,
  di_arsip boolean NOT NULL DEFAULT false,
  CHECK (dihapus = (dihapus_pada IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS kerja_lampiran_pemilik_idx ON kerja_lampiran (pemilik_jenis, pemilik_id);
CREATE INDEX IF NOT EXISTS kerja_lampiran_ruang_idx ON kerja_lampiran (ruang_id) WHERE dihapus = false;

CREATE TABLE IF NOT EXISTS kerja_komentar (
  id uuid PRIMARY KEY,
  kartu_id uuid NOT NULL REFERENCES kerja_kartu (id),
  induk_id uuid NULL REFERENCES kerja_komentar (id),
  penulis text NOT NULL CHECK (length(trim(penulis)) BETWEEN 1 AND 300),
  isi text NOT NULL CHECK (length(isi) <= 20000),
  isi_teks text NOT NULL CHECK (length(isi_teks) <= 10000),
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  disunting_pada timestamptz NULL,
  dihapus boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS kerja_komentar_kartu_idx ON kerja_komentar (kartu_id, dibuat_pada);

CREATE TABLE IF NOT EXISTS kerja_pengingat (
  kartu_id uuid PRIMARY KEY REFERENCES kerja_kartu (id),
  mulai_h1hari_pada timestamptz NULL,
  mulai_h1jam_pada timestamptz NULL,
  tenggat_h1hari_pada timestamptz NULL,
  tenggat_h1jam_pada timestamptz NULL
);

CREATE TABLE IF NOT EXISTS kerja_notifikasi (
  id uuid PRIMARY KEY,
  person_id text NOT NULL CHECK (person_id ~ '^hcis:employee:[0-9a-f-]{36}$'),
  jenis text NOT NULL CHECK (jenis IN (
    'mulai_h1hari', 'mulai_h1jam', 'tenggat_h1hari', 'tenggat_h1jam', 'penugasan', 'sebutan'
  )),
  kartu_id uuid NOT NULL REFERENCES kerja_kartu (id),
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  dibaca_pada timestamptz NULL
);

CREATE INDEX IF NOT EXISTS kerja_notifikasi_person_idx ON kerja_notifikasi (person_id, dibuat_pada DESC);

CREATE TABLE IF NOT EXISTS kerja_riwayat (
  id bigserial PRIMARY KEY,
  kartu_id uuid NOT NULL REFERENCES kerja_kartu (id),
  aksi text NOT NULL CHECK (aksi IN (
    'dibuat', 'disalin', 'pindah_kolom', 'tambah_orang', 'lepas_orang', 'ubah_tenggat', 'ubah_mulai',
    'ubah_judul', 'ubah_uraian', 'ditutup', 'dibuka', 'diarsipkan', 'dipulihkan'
  )),
  aktor text NOT NULL CHECK (length(trim(aktor)) BETWEEN 1 AND 300),
  pada timestamptz NOT NULL DEFAULT now(),
  lama jsonb NULL,
  baru jsonb NULL
);

CREATE INDEX IF NOT EXISTS kerja_riwayat_kartu_idx ON kerja_riwayat (kartu_id, pada DESC);

CREATE TABLE IF NOT EXISTS kerja_admins (
  id uuid PRIMARY KEY,
  identity_issuer text NOT NULL CHECK (length(trim(identity_issuer)) > 0),
  identity_subject text NOT NULL CHECK (length(trim(identity_subject)) > 0),
  granted_by text NOT NULL CHECK (length(trim(granted_by)) > 0),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  alasan text NOT NULL CHECK (length(trim(alasan)) BETWEEN 1 AND 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS kerja_admins_active_idx
  ON kerja_admins (identity_issuer, identity_subject) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS kerja_audit (
  id bigserial PRIMARY KEY,
  aktor text NOT NULL CHECK (length(trim(aktor)) BETWEEN 1 AND 300),
  aksi text NOT NULL CHECK (length(trim(aksi)) BETWEEN 1 AND 60),
  objek_jenis text NOT NULL CHECK (length(trim(objek_jenis)) BETWEEN 1 AND 40),
  objek_ref text NOT NULL CHECK (length(trim(objek_ref)) BETWEEN 1 AND 300),
  ruang_id uuid NULL REFERENCES kerja_ruang (id),
  alasan text NOT NULL CHECK (length(trim(alasan)) BETWEEN 1 AND 500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  pada timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kerja_audit_ruang_idx ON kerja_audit (ruang_id, pada DESC);

-- Daily jobs record their last run here so a restart does not run them twice the same day.
CREATE TABLE IF NOT EXISTS kerja_status (
  kunci text PRIMARY KEY CHECK (kunci ~ '^[a-z_]{1,40}$'),
  nilai jsonb NOT NULL,
  diperbarui_pada timestamptz NOT NULL DEFAULT now()
);

-- §2 Pencarian: `indonesian` when this PostgreSQL has it, `simple` otherwise. The chosen
-- configuration is recorded in kerja_status so search queries use the same one.
DO $$
DECLARE cfg text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'indonesian') THEN cfg := 'indonesian'; ELSE cfg := 'simple'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kerja_kartu' AND column_name = 'tsv') THEN
    EXECUTE format(
      'ALTER TABLE kerja_kartu ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector(%L::regconfig, judul || '' '' || uraian_teks)) STORED',
      cfg);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kerja_komentar' AND column_name = 'tsv') THEN
    EXECUTE format(
      'ALTER TABLE kerja_komentar ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector(%L::regconfig, CASE WHEN dihapus THEN '''' ELSE isi_teks END)) STORED',
      cfg);
  END IF;
  INSERT INTO kerja_status (kunci, nilai) VALUES ('pencarian', jsonb_build_object('konfigurasi', cfg))
    ON CONFLICT (kunci) DO NOTHING;
END $$;

CREATE INDEX IF NOT EXISTS kerja_kartu_tsv_idx ON kerja_kartu USING gin (tsv);
CREATE INDEX IF NOT EXISTS kerja_komentar_tsv_idx ON kerja_komentar USING gin (tsv);

REVOKE ALL ON
  kerja_ruang, kerja_ruang_anggota, kerja_ruang_usulan, kerja_papan, kerja_kolom, kerja_kartu,
  kerja_kartu_orang, kerja_label, kerja_kartu_label, kerja_ceklis, kerja_ceklis_item,
  kerja_ceklis_item_orang, kerja_lampiran, kerja_komentar, kerja_pengingat, kerja_notifikasi,
  kerja_riwayat, kerja_admins, kerja_audit, kerja_status
FROM PUBLIC;
