-- SEK-IMPL-004: Asisten Surat. The draft letter already exists and already carries issuer, type,
-- subject, recipient and signer; this migration only adds the body text that belongs to it, plus a
-- monthly meter for the model calls. Nothing here touches the letter-number book.

-- One row per draft. ON DELETE CASCADE matters: SEK-IMPL-001 deletes a draft outright
-- (surat.ts batalkan), so without it deleting a draft that has a body would fail (§4.2).
CREATE TABLE IF NOT EXISTS sekretariat_surat_isi (
  surat_id uuid PRIMARY KEY REFERENCES sekretariat_surat_keluar (id) ON DELETE CASCADE,
  -- Snapshot of the type the body was written for; a mismatch warns in the preview (§5.5).
  jenis_kode text NOT NULL REFERENCES sekretariat_jenis (kode),
  -- { dasar, fakta, tindakan_korektif, tenggat, tanggapan, tembusan } — each a string.
  bagian jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { penjelasan, jawaban: [{kunci, nilai}], kutipan: [{surat_masuk_id, awal, panjang, teks}] }.
  konteks jsonb NOT NULL DEFAULT '{}'::jsonb,
  sumber text NOT NULL DEFAULT 'asisten' CHECK (sumber IN ('asisten', 'manual')),
  disunting boolean NOT NULL DEFAULT false,
  putaran integer NOT NULL DEFAULT 0 CHECK (putaran >= 0),
  token_masuk bigint NOT NULL DEFAULT 0 CHECK (token_masuk >= 0),
  token_keluar bigint NOT NULL DEFAULT 0 CHECK (token_keluar >= 0),
  dibuat_oleh text NOT NULL,
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  diubah_oleh text NOT NULL,
  diubah_pada timestamptz NOT NULL DEFAULT now(),
  -- Belt and braces next to the zod schemas: a body or a context cannot grow without bound.
  CONSTRAINT sekretariat_surat_isi_bagian_ukuran CHECK (length(bagian::text) <= 40000),
  CONSTRAINT sekretariat_surat_isi_konteks_ukuran CHECK (length(konteks::text) <= 40000),
  CONSTRAINT sekretariat_surat_isi_kutipan_jumlah
    CHECK (jsonb_array_length(coalesce(konteks -> 'kutipan', '[]'::jsonb)) <= 3)
);

-- The monthly meter for SEKRETARIAT_AI_MAKS_PANGGILAN_BULAN (§10). It holds counts only: no
-- person, no letter, no text.
CREATE TABLE IF NOT EXISTS sekretariat_ai_pemakaian (
  bulan text PRIMARY KEY CHECK (bulan ~ '^[0-9]{4}-[0-9]{2}$'),
  panggilan integer NOT NULL DEFAULT 0 CHECK (panggilan >= 0),
  token_masuk bigint NOT NULL DEFAULT 0 CHECK (token_masuk >= 0),
  token_keluar bigint NOT NULL DEFAULT 0 CHECK (token_keluar >= 0),
  diubah_pada timestamptz NOT NULL DEFAULT now()
);

-- Down: additive-only; recovery is restoring the pre-migration dump. Dropping these tables once
-- real drafts exist would lose work staff typed.
