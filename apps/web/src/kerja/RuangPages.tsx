import { ArrowLeft, Search } from "lucide-react";
import { useState, type ReactNode } from "react";

import { kerjaFetch, type KartuRingkas, type Lampiran, type RuangDetail } from "@/kerja/api";
import { formatTanggal, JENIS_SELESAI, ukuranBerkas } from "@/kerja/format";
import { Attachments } from "@/kerja/KartuPanel";
import { CardCounters } from "@/kerja/TugasPage";
import { AvatarStack, ErrorNote, LabelChip, Link, PageHeader, StateCard, useLoad } from "@/kerja/ui";

function RoomFrame({ ruangId, title, children }: { ruangId: string; title: string; children: (room: RuangDetail) => ReactNode }) {
  const { state } = useLoad<RuangDetail>(() => kerjaFetch<RuangDetail>(`/ruang/${ruangId}`), ruangId);
  if (state.status === "loading") return <StateCard kind="loading" title="Memuat ruang" />;
  if (state.status === "error") {
    return <StateCard kind="error" title={state.code === "tidak_ditemukan" ? "Ruang tidak ditemukan" : "Ruang belum dapat dimuat"} body={state.code === "tidak_ditemukan" ? "Ruang ini tidak ada atau Anda bukan anggotanya." : state.message} />;
  }
  const room = state.data;
  return (
    <>
      <PageHeader
        eyebrow={<Link href={room.papan[0] ? `/papan/${room.papan[0].id}` : "/ruang"} className="inline-flex items-center gap-1 hover:underline"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{room.nama}</Link>}
        title={title}
      />
      {children(room)}
    </>
  );
}

export function CardRows({ items, empty }: { items: KartuRingkas[]; empty: string }) {
  if (items.length === 0) return <p className="rounded-xl bg-muted px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((card) => (
        <li key={card.id}>
          <Link href={`/papan/${card.papanId}?kartu=${card.id}`} className="block rounded-2xl border border-border/70 bg-surface-raised p-3 hover:border-brand-primary/50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-muted-foreground">{card.papanNama} · {card.kolomNama}</p>
                <p className="font-semibold text-foreground">{card.judul}</p>
              </div>
              <AvatarStack people={card.orang} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              {card.selesaiJenis ? <span className="rounded-md bg-success-soft px-1.5 py-0.5 font-bold text-success-ink">{JENIS_SELESAI[card.selesaiJenis]}</span> : null}
              {card.tenggatPada ? <span className="text-muted-foreground">Tenggat {formatTanggal(card.tenggatPada)}</span> : null}
              {card.label.map((label) => <LabelChip key={label.id} label={label} />)}
              <CardCounters ceklis={card.ceklis} komentar={card.komentar} lampiran={card.lampiran} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** §6.6: search inside one room, with its filters. */
export function CariPage({ ruangId }: { ruangId: string }) {
  const [form, setForm] = useState({ q: "", status: "semua", orang: "", label: "", arsip: "false", tenggat_dari: "", tenggat_sampai: "" });
  const [submitted, setSubmitted] = useState<typeof form | null>(null);
  const query = submitted ? new URLSearchParams(Object.entries(submitted).filter(([, value]) => value !== "")).toString() : "";
  const results = useLoad<{ items: KartuRingkas[] } | null>(() => (submitted ? kerjaFetch(`/ruang/${ruangId}/cari?${query}`) : Promise.resolve(null)), query);
  return (
    <RoomFrame ruangId={ruangId} title="Cari kartu">
      {(room) => (
        <>
          <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setSubmitted({ ...form }); }}>
            <label className="sm:col-span-2 lg:col-span-4">
              <span className="sr-only">Kata kunci</span>
              <span className="flex gap-2">
                <input className="sq-admin-input" type="search" placeholder="Judul, uraian, atau isi komentar" value={form.q} maxLength={200} onChange={(event) => setForm({ ...form, q: event.target.value })} />
                <button type="submit" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-brand-primary px-4 text-sm font-bold text-brand-foreground"><Search className="h-4 w-4" aria-hidden="true" />Cari</button>
              </span>
            </label>
            <select aria-label="Status" className="sq-admin-input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="semua">Semua status</option><option value="terbuka">Belum selesai</option>
              {Object.entries(JENIS_SELESAI).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select aria-label="Penanggung jawab" className="sq-admin-input" value={form.orang} onChange={(event) => setForm({ ...form, orang: event.target.value })}>
              <option value="">Semua orang</option>
              {room.anggota.filter((member) => member.peran !== "peninjau").map((member) => <option key={member.id} value={member.id}>{member.nama}</option>)}
            </select>
            <label className="text-xs font-bold text-brand-heading">Tenggat dari<input type="date" className="sq-admin-input mt-1" value={form.tenggat_dari} onChange={(event) => setForm({ ...form, tenggat_dari: event.target.value })} /></label>
            <label className="text-xs font-bold text-brand-heading">sampai<input type="date" className="sq-admin-input mt-1" value={form.tenggat_sampai} onChange={(event) => setForm({ ...form, tenggat_sampai: event.target.value })} /></label>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.arsip === "true"} onChange={(event) => setForm({ ...form, arsip: event.target.checked ? "true" : "false" })} /> Termasuk kartu arsip</label>
          </form>
          {!submitted ? <p className="text-sm text-muted-foreground">Pencarian hanya di ruang ini. Ketik kata kunci atau pilih penyaring, lalu tekan Cari.</p> : null}
          {results.state.status === "loading" && submitted ? <StateCard kind="loading" title="Mencari" /> : null}
          {results.state.status === "error" ? <StateCard kind="error" title="Pencarian gagal" body={results.state.message} /> : null}
          {results.state.status === "ready" && results.state.data ? <CardRows items={results.state.data.items} empty="Tidak ada kartu yang cocok di ruang ini." /> : null}
        </>
      )}
    </RoomFrame>
  );
}

/** §8 Berkas ruang: files that belong to the room rather than one card, with the quota. */
export function BerkasPage({ ruangId }: { ruangId: string }) {
  const files = useLoad<{ items: Lampiran[]; kuota: { terpakai: number; batas: number } }>(() => kerjaFetch(`/ruang/${ruangId}/berkas`), ruangId);
  const [error, setError] = useState<string | null>(null);
  return (
    <RoomFrame ruangId={ruangId} title="Berkas ruang">
      {(room) => {
        if (files.state.status !== "ready") return files.state.status === "error" ? <StateCard kind="error" title="Berkas belum dapat dimuat" body={files.state.message} /> : <StateCard kind="loading" title="Memuat berkas" />;
        const { items, kuota } = files.state.data;
        const canWork = room.peranSaya !== "peninjau" && room.status === "aktif";
        const percent = Math.min(100, Math.round((kuota.terpakai / kuota.batas) * 100));
        return (
          <>
            <div className="mb-4 rounded-2xl border border-border/70 bg-surface-raised p-4">
              <p className="text-sm font-semibold">Kuota lampiran ruang: {ukuranBerkas(kuota.terpakai)} dari {ukuranBerkas(kuota.batas)}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className={`h-full ${percent > 90 ? "bg-destructive" : "bg-brand-primary"}`} style={{ width: `${percent}%` }} /></div>
              <p className="mt-1 text-xs text-muted-foreground">Termasuk lampiran semua kartu di ruang ini, dan lampiran yang baru dihapus sampai dibersihkan esok hari.</p>
            </div>
            <ErrorNote message={error} />
            <Attachments items={items} canWork={canWork} canDeleteAll={room.peranSaya === "pj"} uploadPath={`/ruang/${ruangId}/lampiran`} act={async (run) => { setError(null); try { await run(); await files.reload(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Gagal."); } }} setError={setError} />
          </>
        );
      }}
    </RoomFrame>
  );
}

/** §8 Arsip ruang: archived cards; each opens read-only and can be restored by pj or anggota. */
export function ArsipPage({ ruangId }: { ruangId: string }) {
  const cards = useLoad<{ items: KartuRingkas[] }>(() => kerjaFetch(`/ruang/${ruangId}/arsip`), ruangId);
  return (
    <RoomFrame ruangId={ruangId} title="Arsip ruang">
      {() => cards.state.status === "ready"
        ? <CardRows items={cards.state.data.items} empty="Belum ada kartu yang diarsipkan." />
        : cards.state.status === "error" ? <StateCard kind="error" title="Arsip belum dapat dimuat" body={cards.state.message} /> : <StateCard kind="loading" title="Memuat arsip" />}
    </RoomFrame>
  );
}
