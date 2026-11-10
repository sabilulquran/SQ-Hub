import { Archive, ArchiveRestore, CheckCircle2, ChevronDown, Copy, History, Paperclip, Pencil, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { errorMessage, kerjaFetch, kerjaUpload, lampiranUrl, type JenisSelesai, type KartuDetail, type Lampiran, type Orang, type Papan } from "@/kerja/api";
import { Composer, RichText } from "@/kerja/Composer";
import { formatTanggal, fromWibInput, JENIS_SELESAI, RIWAYAT, toWibInput, ukuranBerkas } from "@/kerja/format";
import { Avatar, dangerButton, ErrorNote, LabelChip, Link, primaryButton, secondaryButton, StateCard, useLoad, useViewerId } from "@/kerja/ui";

interface KartuPanelProps {
  kartuId: string;
  /** The board it was opened from, so columns, labels and members need no second request. */
  papan?: Papan | null;
  onClose?: () => void;
  onChanged?: () => void;
  preview?: { detail: KartuDetail; papan: Papan };
}

/**
 * §8 Kartu: a side panel next to the board on wide screens, a full page on phones. Everything
 * a card holds, with the actions the viewer's room role allows (§7.3).
 */
export function KartuPanel({ kartuId, papan: boardFromParent, onClose, onChanged, preview }: KartuPanelProps) {
  const { state, reload } = useLoad<KartuDetail>(() => (preview ? Promise.resolve(preview.detail) : kerjaFetch<KartuDetail>(`/kartu/${kartuId}`)), kartuId, preview?.detail);
  const detail = state.status === "ready" ? state.data : null;
  const boardNeeded = detail && (!boardFromParent || boardFromParent.id !== detail.papan.id);
  const board = useLoad<Papan | null>(
    () => (preview ? Promise.resolve(preview.papan) : boardNeeded && detail ? kerjaFetch<Papan>(`/papan/${detail.papan.id}`) : Promise.resolve(boardFromParent ?? null)),
    `${detail?.papan.id ?? ""}:${boardNeeded ? "own" : "parent"}`,
    preview?.papan,
  );
  const papan = board.state.status === "ready" ? board.state.data ?? boardFromParent ?? null : boardFromParent ?? null;
  const [error, setError] = useState<string | null>(null);

  if (state.status === "loading") return <StateCard kind="loading" title="Memuat kartu" />;
  if (state.status === "error") {
    return <StateCard kind="error" title={state.code === "tidak_ditemukan" ? "Kartu tidak ditemukan" : "Kartu belum dapat dimuat"} body={state.code === "tidak_ditemukan" ? "Kartu ini tidak ada atau berada di ruang yang tidak Anda ikuti." : state.message} />;
  }
  const card = state.data;
  const canWork = card.ruang.peranSaya !== "peninjau" && card.ruang.status === "aktif" && !card.arsip;
  const members = (papan?.anggota ?? []).filter((member) => member.peran !== "peninjau");

  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
      await reload();
      onChanged?.();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  return (
    <article className="flex flex-col gap-5" aria-labelledby="kartu-judul">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-muted-foreground">
            <Link href={`/ruang/${card.ruang.id}`} className="hover:underline">{card.ruang.nama}</Link> ·{" "}
            <Link href={`/papan/${card.papan.id}`} className="hover:underline">{card.papan.nama}</Link> · {card.kolom.nama}
          </p>
          <TitleEditor key={card.judul} judul={card.judul} editable={canWork} onSave={(judul) => act(() => kerjaFetch(`/kartu/${card.id}`, { method: "PATCH", body: { judul } }))} />
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Tutup panel kartu" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {card.arsip ? <p className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning-ink">Kartu ini diarsipkan. Pulihkan dulu untuk mengubahnya.</p> : null}
      {card.ruang.peranSaya === "peninjau" ? <p className="rounded-xl bg-info-soft px-3 py-2 text-sm text-info-ink">Anda peninjau di ruang ini: kartu hanya bisa dibaca.</p> : null}
      <ErrorNote message={error} />

      <StatusRow card={card} papan={papan} canWork={canWork} canRestore={card.ruang.peranSaya !== "peninjau" && card.ruang.status === "aktif"} act={act} />

      <Section title="Waktu">
        <div className="grid gap-3">
          <DateField label="Mulai" value={card.mulaiPada} disabled={!canWork} onSave={(value) => act(() => kerjaFetch(`/kartu/${card.id}`, { method: "PATCH", body: { mulai_pada: value } }))} />
          <DateField label="Tenggat" value={card.tenggatPada} disabled={!canWork} onSave={(value) => act(() => kerjaFetch(`/kartu/${card.id}`, { method: "PATCH", body: { tenggat_pada: value } }))} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">Waktu Indonesia Barat, format 24 jam. Pengingat dikirim H−1 hari dan H−1 jam.</p>
      </Section>

      <Section title="Penanggung jawab">
        <PeoplePicker
          selected={card.orang}
          options={members}
          disabled={!canWork}
          onSave={(ids) => act(() => kerjaFetch(`/kartu/${card.id}/orang`, { method: "PUT", body: { orang: ids } }))}
        />
      </Section>

      <Section title="Label">
        <div className="flex flex-wrap gap-1.5">
          {(papan?.label ?? card.label).map((label) => {
            const on = card.label.some((item) => item.id === label.id);
            return canWork ? (
              <button
                key={label.id}
                type="button"
                aria-pressed={on}
                onClick={() => act(() => kerjaFetch(`/kartu/${card.id}/label`, { method: "PUT", body: { label: on ? card.label.filter((item) => item.id !== label.id).map((item) => item.id) : [...card.label.map((item) => item.id), label.id] } }))}
                className={`rounded-lg border-2 ${on ? "border-brand-primary" : "border-transparent opacity-60 hover:opacity-100"}`}
              >
                <LabelChip label={label} />
              </button>
            ) : on ? <LabelChip key={label.id} label={label} /> : null;
          })}
          {(papan?.label ?? card.label).length === 0 ? <p className="text-sm text-muted-foreground">Papan ini belum punya label. Penanggung jawab ruang bisa menambahkannya di Pengaturan.</p> : null}
        </div>
      </Section>

      <Section title="Uraian">
        <DescriptionEditor key={card.uraian} html={card.uraian} members={papan?.anggota ?? []} editable={canWork} onSave={(uraian) => act(() => kerjaFetch(`/kartu/${card.id}`, { method: "PATCH", body: { uraian } }))} />
      </Section>

      <Section title="Ceklis">
        <Checklists card={card} members={members} canWork={canWork} act={act} />
      </Section>

      <Section title="Lampiran">
        <Attachments items={card.lampiran} canWork={canWork} canDeleteAll={card.ruang.peranSaya === "pj"} uploadPath={`/kartu/${card.id}/lampiran`} act={act} setError={setError} />
      </Section>

      <Section title={`Komentar (${card.komentar.reduce((sum, item) => sum + (item.dihapus ? 0 : 1) + item.balasan.filter((reply) => !reply.dihapus).length, 0)})`}>
        <Comments card={card} members={papan?.anggota ?? []} canWork={canWork} act={act} />
      </Section>

      <HistoryList items={card.riwayat} />
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold text-brand-heading">{title}</h3>
      {children}
    </section>
  );
}

function TitleEditor({ judul, editable, onSave }: { judul: string; editable: boolean; onSave: (judul: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(judul);
  if (!editing) {
    return (
      <h2 id="kartu-judul" className="mt-0.5 font-display text-xl font-bold text-brand-heading">
        {editable ? (
          <button type="button" className="text-left hover:underline" onClick={() => setEditing(true)} title="Ubah judul">{judul}</button>
        ) : judul}
      </h2>
    );
  }
  return (
    <form
      className="mt-1 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() && value.trim() !== judul) void onSave(value.trim());
        setEditing(false);
      }}
    >
      <input id="kartu-judul" aria-label="Judul kartu" className="sq-admin-input" value={value} maxLength={200} autoFocus onChange={(event) => setValue(event.target.value)} />
      <button type="submit" className={primaryButton}>Simpan</button>
    </form>
  );
}

function StatusRow({ card, papan, canWork, canRestore, act }: { card: KartuDetail; papan: Papan | null; canWork: boolean; canRestore: boolean; act: (run: () => Promise<unknown>) => Promise<void> }) {
  const [menu, setMenu] = useState<"tutup" | "salin" | "pindah" | null>(null);
  const openColumns = papan?.kolom ?? [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {card.selesai ? (
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-success-soft px-3 py-2 text-sm font-bold text-success-ink">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {JENIS_SELESAI[card.selesai.jenis]} · {card.selesai.oleh.nama}, {formatTanggal(card.selesai.pada)}
          </span>
        ) : null}
        {canWork && !card.selesai ? <button type="button" className={primaryButton} onClick={() => setMenu(menu === "tutup" ? null : "tutup")}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Tutup kartu<ChevronDown className="h-4 w-4" aria-hidden="true" /></button> : null}
        {canWork && card.selesai ? <button type="button" className={secondaryButton} onClick={() => void act(() => kerjaFetch(`/kartu/${card.id}/buka`, { method: "POST" }))}><RotateCcw className="h-4 w-4" aria-hidden="true" />Buka kembali</button> : null}
        {canWork && openColumns.length > 0 ? <button type="button" className={secondaryButton} onClick={() => setMenu(menu === "pindah" ? null : "pindah")}>Pindahkan</button> : null}
        {canWork ? <button type="button" className={secondaryButton} onClick={() => setMenu(menu === "salin" ? null : "salin")}><Copy className="h-4 w-4" aria-hidden="true" />Salin</button> : null}
        {canWork ? <button type="button" className={secondaryButton} onClick={() => void act(() => kerjaFetch(`/kartu/${card.id}/arsip`, { method: "POST" }))}><Archive className="h-4 w-4" aria-hidden="true" />Arsipkan</button> : null}
        {card.arsip && canRestore ? <button type="button" className={secondaryButton} onClick={() => void act(() => kerjaFetch(`/kartu/${card.id}/pulihkan`, { method: "POST" }))}><ArchiveRestore className="h-4 w-4" aria-hidden="true" />Pulihkan</button> : null}
      </div>
      {menu === "tutup" ? (
        <div className="flex flex-wrap gap-2 rounded-xl border border-border p-2" role="group" aria-label="Pilih jenis selesai">
          {(Object.keys(JENIS_SELESAI) as JenisSelesai[]).map((jenis) => (
            <button key={jenis} type="button" className={jenis === "tuntas" ? primaryButton : secondaryButton} onClick={() => { setMenu(null); void act(() => kerjaFetch(`/kartu/${card.id}/tutup`, { method: "POST", body: { jenis } })); }}>
              {JENIS_SELESAI[jenis]}
            </button>
          ))}
        </div>
      ) : null}
      {menu === "pindah" ? <MoveForm card={card} columns={openColumns} onMove={(kolomId, jenis) => { setMenu(null); return act(() => kerjaFetch(`/kartu/${card.id}/pindah`, { method: "POST", body: { kolom_id: kolomId, indeks: 100000, ...(jenis ? { selesai_jenis: jenis } : {}) } })); }} /> : null}
      {menu === "salin" ? <CopyForm card={card} onCopy={(options) => { setMenu(null); return act(() => kerjaFetch(`/kartu/${card.id}/salin`, { method: "POST", body: options })); }} /> : null}
    </div>
  );
}

function MoveForm({ card, columns, onMove }: { card: KartuDetail; columns: Papan["kolom"]; onMove: (kolomId: string, jenis?: JenisSelesai) => Promise<void> }) {
  const [kolom, setKolom] = useState(columns.find((column) => column.id !== card.kolom.id)?.id ?? "");
  const [jenis, setJenis] = useState<JenisSelesai>("tuntas");
  const target = columns.find((column) => column.id === kolom);
  const asksKind = Boolean(target?.menandaiSelesai && !card.selesai);
  return (
    <form className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); if (kolom) void onMove(kolom, asksKind ? jenis : undefined); }}>
      <label className="flex-1 text-xs font-bold text-brand-heading">Ke kolom
        <select className="sq-admin-input mt-1" value={kolom} onChange={(event) => setKolom(event.target.value)}>
          {columns.map((column) => <option key={column.id} value={column.id}>{column.nama}{column.id === card.kolom.id ? " (sekarang)" : ""}</option>)}
        </select>
      </label>
      {asksKind ? (
        <label className="text-xs font-bold text-brand-heading">Jenis selesai
          <select className="sq-admin-input mt-1" value={jenis} onChange={(event) => setJenis(event.target.value as JenisSelesai)}>
            {(Object.keys(JENIS_SELESAI) as JenisSelesai[]).map((value) => <option key={value} value={value}>{JENIS_SELESAI[value]}</option>)}
          </select>
        </label>
      ) : null}
      <button type="submit" className={primaryButton} disabled={!kolom}>Pindahkan</button>
    </form>
  );
}

function CopyForm({ card, onCopy }: { card: KartuDetail; onCopy: (options: Record<string, unknown>) => Promise<void> }) {
  const [judul, setJudul] = useState(`${card.judul} (salinan)`.slice(0, 200));
  const [options, setOptions] = useState({ label: true, orang: false, ceklis: true, ceklis_isi: true, lampiran: false });
  const toggles: Array<[keyof typeof options, string]> = [["label", "Label"], ["orang", "Penanggung jawab"], ["ceklis", "Ceklis"], ["ceklis_isi", "Isi butir ceklis"], ["lampiran", "Lampiran"]];
  return (
    <form className="rounded-xl border border-border p-3" onSubmit={(event) => { event.preventDefault(); void onCopy({ judul, ...options, ceklis: options.ceklis || options.ceklis_isi }); }}>
      <label className="block text-xs font-bold text-brand-heading">Judul salinan
        <input className="sq-admin-input mt-1" value={judul} maxLength={200} onChange={(event) => setJudul(event.target.value)} />
      </label>
      <fieldset className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <legend className="mb-1 text-xs font-bold text-brand-heading">Ikut disalin</legend>
        {toggles.map(([key, label]) => (
          <label key={key} className="inline-flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={options[key]} onChange={(event) => setOptions({ ...options, [key]: event.target.checked })} /> {label}
          </label>
        ))}
      </fieldset>
      <p className="mt-2 text-xs text-muted-foreground">Komentar, riwayat, dan status selesai tidak pernah ikut disalin.</p>
      <button type="submit" className={`${primaryButton} mt-3`} disabled={!judul.trim()}>Buat salinan</button>
    </form>
  );
}

function DateField({ label, value, disabled, onSave }: { label: string; value: string | null; disabled: boolean; onSave: (value: string | null) => Promise<void> }) {
  const [draft, setDraft] = useState(toWibInput(value));
  useEffect(() => setDraft(toWibInput(value)), [value]);
  const commit = () => {
    if (draft === toWibInput(value)) return;
    void onSave(fromWibInput(draft));
  };
  return (
    <label className="block text-xs font-bold text-brand-heading">
      {label}
      <span className="mt-1 flex gap-2">
        <input type="datetime-local" className="sq-admin-input" value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />
        {!disabled && value ? <button type="button" className={secondaryButton} aria-label={`Hapus ${label.toLowerCase()}`} onClick={() => { setDraft(""); void onSave(null); }}><X className="h-4 w-4" aria-hidden="true" /></button> : null}
      </span>
    </label>
  );
}

function PeoplePicker({ selected, options, disabled, onSave, compact = false }: { selected: Orang[]; options: Orang[]; disabled: boolean; onSave: (ids: string[]) => Promise<void>; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const selectedIds = selected.map((person) => person.id);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((person) => (
          <span key={person.id} className={`inline-flex items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-2 text-xs font-semibold ${person.aktif ? "" : "text-muted-foreground"}`}>
            <Avatar orang={person} /> {person.nama}{person.aktif ? "" : " (tidak aktif)"}
          </span>
        ))}
        {selected.length === 0 && !compact ? <span className="text-sm text-muted-foreground">Belum ada.</span> : null}
        {!disabled ? <button type="button" className="text-xs font-bold text-brand-primary-deep hover:underline" onClick={() => setOpen(!open)}>{open ? "Selesai" : "Atur"}</button> : null}
      </div>
      {open ? (
        <ul className="mt-2 grid gap-1 rounded-xl border border-border p-1.5 sm:grid-cols-2">
          {options.map((person) => {
            const on = selectedIds.includes(person.id);
            return (
              <li key={person.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" checked={on} onChange={() => void onSave(on ? selectedIds.filter((id) => id !== person.id) : [...selectedIds, person.id])} />
                  {person.nama}
                </label>
              </li>
            );
          })}
          {options.length === 0 ? <li className="px-2 py-1.5 text-sm text-muted-foreground">Belum ada anggota yang bisa ditugaskan.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function DescriptionEditor({ html, members, editable, onSave }: { html: string; members: Orang[]; editable: boolean; onSave: (html: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const draft = useRef(html);
  if (!editing) {
    return (
      <div>
        <RichText html={html} empty={editable ? "Belum ada uraian. Tulis tujuan, langkah, atau bahan yang dibutuhkan." : "Belum ada uraian."} />
        {editable ? <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-primary-deep hover:underline" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Ubah uraian</button> : null}
      </div>
    );
  }
  return (
    <div>
      <Composer initialHtml={html} members={members} label="Uraian kartu" placeholder="Tulis uraian. Ketik @ untuk menyebut anggota ruang." autoFocus onChange={(value) => { draft.current = value; }} />
      <div className="mt-2 flex gap-2">
        <button type="button" className={primaryButton} onClick={() => { setEditing(false); void onSave(draft.current); }}>Simpan</button>
        <button type="button" className={secondaryButton} onClick={() => setEditing(false)}>Batal</button>
      </div>
    </div>
  );
}

function Checklists({ card, members, canWork, act }: { card: KartuDetail; members: Orang[]; canWork: boolean; act: (run: () => Promise<unknown>) => Promise<void> }) {
  const [newList, setNewList] = useState("");
  return (
    <div className="space-y-4">
      {card.ceklis.map((list) => (
        <div key={list.id} className="rounded-xl border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-bold text-foreground">{list.nama}</p>
            <span className="text-xs font-semibold text-muted-foreground">{list.kemajuan.selesai}/{list.kemajuan.total}</span>
            {canWork ? <button type="button" aria-label={`Hapus ceklis ${list.nama}`} className="text-muted-foreground hover:text-destructive" onClick={() => void act(() => kerjaFetch(`/ceklis/${list.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" aria-hidden="true" /></button> : null}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full bg-brand-primary" style={{ width: `${list.kemajuan.total ? (list.kemajuan.selesai / list.kemajuan.total) * 100 : 0}%` }} />
          </div>
          <ul className="mt-2 space-y-1.5">
            {list.butir.map((item) => (
              <li key={item.id} className="rounded-lg px-1 py-1 hover:bg-muted/50">
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" aria-label={`Selesai: ${item.nama}`} checked={item.selesai} disabled={!canWork} onChange={() => void act(() => kerjaFetch(`/butir/${item.id}`, { method: "PATCH", body: { selesai: !item.selesai } }))} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${item.selesai ? "text-muted-foreground line-through" : ""}`}>{item.nama}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {item.tenggatPada ? <span>Tenggat {formatTanggal(item.tenggatPada)}</span> : null}
                      {item.lampiran.map((file) => <a key={file.id} href={lampiranUrl(file.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-primary-deep hover:underline"><Paperclip className="h-3 w-3" aria-hidden="true" />{file.nama}</a>)}
                    </div>
                    <ItemDetails item={item} members={members} canWork={canWork} act={act} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {canWork ? <AddLine label="Tambah butir" placeholder="Butir baru" onAdd={(nama) => act(() => kerjaFetch(`/ceklis/${list.id}/butir`, { method: "POST", body: { nama } }))} /> : null}
        </div>
      ))}
      {card.ceklis.length === 0 && !canWork ? <p className="text-sm text-muted-foreground">Belum ada ceklis.</p> : null}
      {canWork ? (
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (newList.trim()) { void act(() => kerjaFetch(`/kartu/${card.id}/ceklis`, { method: "POST", body: { nama: newList.trim() } })); setNewList(""); } }}>
          <input className="sq-admin-input" placeholder="Nama ceklis baru, misalnya Persiapan" aria-label="Nama ceklis baru" value={newList} maxLength={120} onChange={(event) => setNewList(event.target.value)} />
          <button type="submit" className={secondaryButton} disabled={!newList.trim()}>Tambah ceklis</button>
        </form>
      ) : null}
    </div>
  );
}

function ItemDetails({ item, members, canWork, act }: { item: KartuDetail["ceklis"][number]["butir"][number]; members: Orang[]; canWork: boolean; act: (run: () => Promise<unknown>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {item.orang.map((person) => <span key={person.id} className="inline-flex items-center gap-1 text-xs"><Avatar orang={person} />{person.nama}</span>)}
        {canWork ? <button type="button" className="text-xs font-bold text-brand-primary-deep hover:underline" onClick={() => setOpen(!open)}>{open ? "Tutup" : "Rincian"}</button> : null}
      </div>
      {open ? (
        <div className="mt-2 space-y-2 rounded-lg border border-border p-2">
          <DateField label="Tenggat butir" value={item.tenggatPada} disabled={!canWork} onSave={(value) => act(() => kerjaFetch(`/butir/${item.id}`, { method: "PATCH", body: { tenggat_pada: value } }))} />
          <PeoplePicker compact selected={item.orang} options={members} disabled={!canWork} onSave={(ids) => act(() => kerjaFetch(`/butir/${item.id}`, { method: "PATCH", body: { orang: ids } }))} />
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void act(() => kerjaUpload(`/butir/${item.id}/lampiran`, file)); event.target.value = ""; }} />
            <button type="button" className={secondaryButton} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />Lampirkan</button>
            <button type="button" className={dangerButton} onClick={() => void act(() => kerjaFetch(`/butir/${item.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" aria-hidden="true" />Hapus butir</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddLine({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (value: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  return (
    <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (value.trim()) { void onAdd(value.trim()); setValue(""); } }}>
      <input className="sq-admin-input" placeholder={placeholder} aria-label={label} value={value} maxLength={300} onChange={(event) => setValue(event.target.value)} />
      <button type="submit" className={secondaryButton} disabled={!value.trim()}>Tambah</button>
    </form>
  );
}

export function Attachments({ items, canWork, canDeleteAll, uploadPath, act, setError }: { items: Lampiran[]; canWork: boolean; canDeleteAll: boolean; uploadPath: string; act: (run: () => Promise<unknown>) => Promise<void>; setError: (message: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const viewerId = useViewerId();
  return (
    <div>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada lampiran.</p> : null}
      <ul className="space-y-1.5">
        {items.map((file) => (
          <li key={file.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
            <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              {file.diArsip ? <span className="block truncate text-sm font-semibold">{file.nama}</span> : <a href={lampiranUrl(file.id)} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-brand-primary-deep hover:underline">{file.nama}</a>}
              <span className="block text-xs text-muted-foreground">{ukuranBerkas(file.ukuran)} · {file.diunggahOleh.nama} · {formatTanggal(file.diunggahPada)}{file.diArsip ? " · di arsip" : ""}</span>
            </div>
            {!file.diArsip ? <a href={lampiranUrl(file.id, true)} className="text-xs font-bold text-brand-primary-deep hover:underline">Unduh</a> : null}
            {canWork && (canDeleteAll || file.diunggahOleh.id === viewerId) ? <button type="button" aria-label={`Hapus ${file.nama}`} className="text-muted-foreground hover:text-destructive" onClick={() => void act(() => kerjaFetch(`/lampiran/${file.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" aria-hidden="true" /></button> : null}
          </li>
        ))}
      </ul>
      {canWork ? (
        <>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > 25 * 1024 * 1024) {
                setError("Lampiran melebihi batas 25 MB.");
                return;
              }
              setBusy(true);
              void act(() => kerjaUpload(uploadPath, file)).finally(() => setBusy(false));
            }}
          />
          <button type="button" className={`${secondaryButton} mt-2`} disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />{busy ? "Mengunggah…" : "Unggah lampiran"}</button>
          <p className="mt-1 text-xs text-muted-foreground">PDF, gambar, dokumen Office, teks, atau zip; paling besar 25 MB.</p>
        </>
      ) : null}
    </div>
  );
}

function Comments({ card, members, canWork, act }: { card: KartuDetail; members: Orang[]; canWork: boolean; act: (run: () => Promise<unknown>) => Promise<void> }) {
  const [composerKey, setComposerKey] = useState(0);
  const draft = useRef("");
  const [hasText, setHasText] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const send = (induk?: string) => {
    const isi = draft.current;
    draft.current = "";
    setHasText(false);
    setComposerKey((key) => key + 1);
    setReplyTo(null);
    return act(() => kerjaFetch(`/kartu/${card.id}/komentar`, { method: "POST", body: { isi, ...(induk ? { induk_id: induk } : {}) } }));
  };
  return (
    <div className="space-y-3">
      {card.komentar.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada komentar. Diskusi tentang kartu ini ditulis di sini, bukan di grup WhatsApp.</p> : null}
      {card.komentar.map((comment) => (
        <div key={comment.id}>
          <CommentItem comment={comment} card={card} members={members} canWork={canWork} act={act} />
          <div className="ml-8 mt-2 space-y-2 border-l-2 border-border pl-3">
            {comment.balasan.map((reply) => <CommentItem key={reply.id} comment={reply} card={card} members={members} canWork={canWork} act={act} />)}
            {canWork && !comment.dihapus ? (
              replyTo === comment.id ? (
                <div>
                  <Composer key={`reply-${composerKey}`} members={members} label="Balasan" placeholder="Tulis balasan" autoFocus onChange={(html, text) => { draft.current = html; setHasText(text.length > 0); }} />
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={primaryButton} disabled={!hasText} onClick={() => void send(comment.id)}>Balas</button>
                    <button type="button" className={secondaryButton} onClick={() => setReplyTo(null)}>Batal</button>
                  </div>
                </div>
              ) : <button type="button" className="text-xs font-bold text-brand-primary-deep hover:underline" onClick={() => { draft.current = ""; setHasText(false); setReplyTo(comment.id); }}>Balas</button>
            ) : null}
          </div>
        </div>
      ))}
      {canWork && replyTo === null ? (
        <div>
          <Composer key={`new-${composerKey}`} members={members} label="Komentar baru" placeholder="Tulis komentar. Ketik @ untuk menyebut anggota ruang." onChange={(html, text) => { draft.current = html; setHasText(text.length > 0); }} />
          <button type="button" className={`${primaryButton} mt-2`} disabled={!hasText} onClick={() => void send()}>Kirim komentar</button>
        </div>
      ) : null}
    </div>
  );
}

function CommentItem({ comment, card, members, canWork, act }: { comment: KartuDetail["komentar"][number] | KartuDetail["komentar"][number]["balasan"][number]; card: KartuDetail; members: Orang[]; canWork: boolean; act: (run: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const draft = useRef(comment.isi);
  if (comment.dihapus) return <p className="text-sm italic text-muted-foreground">Komentar dihapus.</p>;
  return (
    <div className="flex gap-2.5">
      <Avatar orang={comment.penulis} size="md" />
      <div className="min-w-0 flex-1">
        <p className="text-xs"><span className="font-bold text-foreground">{comment.penulis.nama}</span> <span className="text-muted-foreground">· {formatTanggal(comment.dibuatPada)}{comment.disuntingPada ? " · disunting" : ""}</span></p>
        {editing ? (
          <div className="mt-1">
            <Composer initialHtml={comment.isi} members={members} label="Sunting komentar" placeholder="" autoFocus onChange={(html) => { draft.current = html; }} />
            <div className="mt-2 flex gap-2">
              <button type="button" className={primaryButton} onClick={() => { setEditing(false); void act(() => kerjaFetch(`/komentar/${comment.id}`, { method: "PATCH", body: { isi: draft.current } })); }}>Simpan</button>
              <button type="button" className={secondaryButton} onClick={() => setEditing(false)}>Batal</button>
            </div>
          </div>
        ) : <div className="mt-0.5"><RichText html={comment.isi} /></div>}
        {canWork && !editing ? (
          <div className="mt-1 flex gap-3 text-xs font-bold">
            {comment.milikSaya ? <button type="button" className="text-brand-primary-deep hover:underline" onClick={() => setEditing(true)}>Sunting</button> : null}
            {comment.milikSaya || card.ruang.peranSaya === "pj" ? <button type="button" className="text-destructive hover:underline" onClick={() => void act(() => kerjaFetch(`/komentar/${comment.id}`, { method: "DELETE" }))}>Hapus</button> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HistoryList({ items }: { items: KartuDetail["riwayat"] }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button type="button" className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-heading" aria-expanded={open} onClick={() => setOpen(!open)}>
        <History className="h-4 w-4" aria-hidden="true" /> Riwayat kartu ({items.length})
      </button>
      {open ? (
        <ol className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
          {items.map((item, index) => (
            <li key={`${item.pada}-${index}`} className="text-sm">
              <span className="font-semibold">{item.aktor.nama}</span> {RIWAYAT[item.aksi] ?? item.aksi}
              {describeChange(item) ? <span className="text-muted-foreground"> {describeChange(item)}</span> : null}
              <span className="block text-xs text-muted-foreground">{formatTanggal(item.pada)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function describeChange(item: KartuDetail["riwayat"][number]): string {
  const baru = item.baru ?? {};
  const lama = item.lama ?? {};
  if (item.aksi === "pindah_kolom") return `ke ${String(baru.kolom ?? "")}`;
  if (item.aksi === "tambah_orang") return String(baru.orang ?? "");
  if (item.aksi === "lepas_orang") return String(lama.orang ?? "");
  if (item.aksi === "ditutup") return `sebagai ${JENIS_SELESAI[baru.jenis as JenisSelesai] ?? ""}`.toLowerCase();
  if (item.aksi === "ubah_tenggat") return `menjadi ${formatTanggal((baru.tenggat_pada as string | null) ?? null)}`;
  if (item.aksi === "ubah_mulai") return `menjadi ${formatTanggal((baru.mulai_pada as string | null) ?? null)}`;
  if (item.aksi === "ubah_judul") return `menjadi "${String(baru.judul ?? "")}"`;
  return "";
}
