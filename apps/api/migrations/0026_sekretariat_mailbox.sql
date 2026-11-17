-- SEK-IMPL-002: the Sekretariat inbox is connected from the admin screen instead of from
-- SEKRETARIAT_IMAP_* in the Mi8 env. One row per mailbox, each bound to the inbox it feeds, with
-- the password sealed by SEKRETARIAT_DATA_KEYS (M-2). Only the key stays in the env.
--
-- Additive. Recovery plan: dump the Hub database before migrating; this file runs in one
-- transaction (migrate.ts). An application rollback to the previous release is safe: older code
-- never reads this table and keeps using the env, which M-5 still honours while the table is
-- empty. To remove:
--   DROP TABLE sekretariat_mailbox;
--   ALTER TABLE sekretariat_mail_state DROP COLUMN mailbox_id;

CREATE TABLE IF NOT EXISTS sekretariat_mailbox (
  id uuid PRIMARY KEY,
  -- The address as people write it; also the human key on the admin screen.
  alamat text NOT NULL UNIQUE CHECK (alamat ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  host text NOT NULL CHECK (length(trim(host)) BETWEEN 1 AND 255),
  port integer NOT NULL DEFAULT 993 CHECK (port BETWEEN 1 AND 65535),
  pengguna text NOT NULL CHECK (length(trim(pengguna)) BETWEEN 1 AND 320),
  -- `v1.<kid>.<iv>.<ciphertext>.<tag>`, AAD-bound to this row's id. Never logged, never returned.
  sandi_terenkripsi text NOT NULL,
  -- The inbox this mailbox feeds. The foundation inbox today; a penerbit inbox once units get
  -- their own address (SEK-001 §13 nomor 8).
  kotak_id uuid NOT NULL REFERENCES sekretariat_kotak (id),
  -- auth_gagal: five consecutive authentication refusals, so the puller stops trying until an
  -- admin saves it again (M-8). Nothing else moves a mailbox out of 'aktif'.
  status text NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif', 'nonaktif', 'auth_gagal')),
  gagal_berturut integer NOT NULL DEFAULT 0 CHECK (gagal_berturut >= 0),
  -- Why the last round failed. The five-strike rule counts consecutive refusals of the same kind,
  -- so a night of timeouts cannot add up to a parked mailbox.
  sebab_terakhir text NULL CHECK (sebab_terakhir IS NULL OR sebab_terakhir IN
    ('sandi_ditolak', 'host_tidak_ditemukan', 'sertifikat', 'waktu_habis', 'kunci_hilang', 'lainnya')),
  -- An error class or a short reason, never a password and never message content.
  galat_terakhir text NULL CHECK (galat_terakhir IS NULL OR length(galat_terakhir) <= 200),
  galat_pada timestamptz NULL,
  tarik_terakhir_pada timestamptz NULL,
  dibuat_oleh text NOT NULL,
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  diubah_oleh text NULL,
  diubah_pada timestamptz NULL
);

-- The puller asks for active mailboxes every round (M-6), so this is the hot path.
CREATE INDEX IF NOT EXISTS sekretariat_mailbox_aktif_idx ON sekretariat_mailbox (status) WHERE status = 'aktif';

-- IMAP progress already keys on the mailbox address; the id makes the link explicit and survives
-- a rename. Nullable, because rows written before this migration have no id to point at.
ALTER TABLE sekretariat_mail_state ADD COLUMN IF NOT EXISTS mailbox_id uuid NULL REFERENCES sekretariat_mailbox (id) ON DELETE SET NULL;
