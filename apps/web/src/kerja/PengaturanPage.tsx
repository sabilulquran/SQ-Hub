import { ArrowDown, ArrowUp, Trash2, UserPlus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { CardDialog, CardLink } from "@/kerja/CardDialog";
import { errorMessage, kerjaFetch, type Calon, type Orang, type Papan, type Peran, type RuangDetail, type Warna } from "@/kerja/api";
import { formatTanggal, PERAN, WARNA } from "@/kerja/format";
import { ErrorNote, LabelChip, Link, PageHeader, Panel, primaryButton, ReasonDialog, secondaryButton, StateCard, useLoad } from "@/kerja/ui";

type Pending = { title: string; body: string; confirm: string; danger?: boolean; run: (alasan: string) => Promise<unknown> };

/** §8 Pengaturan ruang (pj only): members and Directory proposals, orphans, boards, columns, labels, end date. */
export function PengaturanPage({ ruangId }: { ruangId: string }) {
  const room = useLoad<RuangDetail>(() => kerjaFetch<RuangDetail>(`/ruang/${ruangId}`), ruangId);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  if (room.state.status === "loading") return <StateCard kind="loading" title="Memuat pengaturan" />;
  if (room.state.status === "error") return <StateCard kind="error" title="Pengaturan belum dapat dimuat" body={room.state.message} />;
  const data = room.state.data;
  if (data.peranSaya !== "pj") return <StateCard kind="forbidden" title="Hanya penanggung jawab ruang yang bisa membuka pengaturan" />;

  const refresh = async () => {
    await room.reload();
    setVersion((value) => value + 1);
  };
  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  const ask = (next: Pending) => {
    setDialogError(null);
    setPending(next);
  };

  return (
    <>
      <PageHeader eyebrow={<Link href={data.papan[0] ? `/papan/${data.papan[0].id}` : "/ruang"} className="hover:underline">{data.nama}</Link>} title="Pengaturan ruang" />
      <ErrorNote message={error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle>Anggota</SectionTitle>
          <ul className="divide-y divide-border">
            {data.anggota.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className={`min-w-0 flex-1 text-sm font-semibold ${member.aktif ? "" : "text-muted-foreground line-through"}`}>{member.nama}</span>
                <select
                  aria-label={`Peran ${member.nama}`}
                  className="sq-admin-input w-auto"
                  value={member.peran}
                  onChange={(event) => {
                    const peran = event.target.value as Peran;
                    ask({ title: `Ubah peran ${member.nama}`, body: `Menjadi ${PERAN[peran].toLowerCase()}.`, confirm: "Ubah peran", run: (alasan) => kerjaFetch(`/ruang/${ruangId}/anggota/${member.id}`, { method: "PATCH", body: { peran, alasan } }) });
                  }}
                >
                  {(Object.keys(PERAN) as Peran[]).map((peran) => <option key={peran} value={peran}>{PERAN[peran]}</option>)}
                </select>
                <button type="button" aria-label={`Keluarkan ${member.nama}`} className="text-muted-foreground hover:text-destructive" onClick={() => ask({ title: `Keluarkan ${member.nama}`, body: "Kartu yang ditugaskan kepadanya tetap ada dan muncul di daftar kartu yatim.", confirm: "Keluarkan", danger: true, run: (alasan) => kerjaFetch(`/ruang/${ruangId}/anggota/${member.id}`, { method: "DELETE", body: { alasan } }) })}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <Candidates key={`c${version}`} ruangId={ruangId} onAdd={(person, peran) => ask({ title: `Tambah ${person.nama}`, body: `Sebagai ${PERAN[peran].toLowerCase()}. Keanggotaan dicatat dengan nama Anda dan alasannya.`, confirm: "Tambahkan", run: (alasan) => kerjaFetch(`/ruang/${ruangId}/anggota`, { method: "POST", body: { person_id: person.id, peran, alasan } }) })} />
        </Panel>

        <div className="flex flex-col gap-4">
          <Proposals key={`p${version}`} ruangId={ruangId} ask={ask} />
          <Orphans key={`o${version}`} ruangId={ruangId} />
          <RoomSettings room={data} ask={ask} act={act} />
        </div>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-bold text-brand-heading">Papan, kolom, dan label</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.papan.map((board) => <BoardSettings key={`${board.id}-${version}`} papanId={board.id} act={act} />)}
        <Panel>
          <SectionTitle>Papan baru</SectionTitle>
          <InlineAdd label="Nama papan" placeholder="Misalnya Kalender kegiatan" maxLength={80} onAdd={(nama) => act(() => kerjaFetch(`/ruang/${ruangId}/papan`, { method: "POST", body: { nama } }))} />
          <p className="mt-1 text-xs text-muted-foreground">Papan baru dibuat dengan tiga kolom: Akan dikerjakan, Sedang dikerjakan, Selesai.</p>
        </Panel>
      </div>

      <CardDialog />
      {pending ? (
        <ReasonDialog
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirm}
          danger={pending.danger ?? false}
          busy={busy}
          error={dialogError}
          onClose={() => setPending(null)}
          onConfirm={(alasan) => {
            setBusy(true);
            setDialogError(null);
            void pending.run(alasan)
              .then(async () => { setPending(null); await refresh(); })
              .catch((failure: unknown) => setDialogError(errorMessage(failure)))
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
    </>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 font-display text-base font-bold text-brand-heading">{children}</h3>;
}

function Candidates({ ruangId, onAdd }: { ruangId: string; onAdd: (person: Calon, peran: Peran) => void }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const list = useLoad<{ unit: Calon[]; atasan: Calon[]; cari: Calon[]; directory: { stale: boolean } }>(() => kerjaFetch(`/ruang/${ruangId}/calon?q=${encodeURIComponent(query)}`), query);
  const data = list.state.status === "ready" ? list.state.data : null;
  const groups: Array<[string, Calon[]]> = data ? [["Dari unit ini", data.unit], ["Dari unit di atasnya (usul peninjau)", data.atasan], ["Hasil pencarian", data.cari]] : [];
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><UserPlus className="h-4 w-4" aria-hidden="true" />Tambah anggota</p>
      <p className="mb-2 text-xs text-muted-foreground">Calon diambil dari Organization Directory. Tidak ada yang masuk ruang sebelum Anda menambahkannya.</p>
      {data?.directory.stale ? <p className="mb-2 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning-ink">Organization Directory belum diperbarui; daftar calon mungkin tertinggal.</p> : null}
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); setQuery(q.trim()); }}>
        <input className="sq-admin-input" placeholder="Cari nama atau NIP" aria-label="Cari calon anggota" value={q} onChange={(event) => setQ(event.target.value)} />
        <button type="submit" className={secondaryButton}>Cari</button>
      </form>
      {groups.filter(([, items]) => items.length > 0).map(([title, items]) => (
        <div key={title} className="mt-3">
          <p className="text-xs font-bold text-muted-foreground">{title}</p>
          <ul className="mt-1 space-y-1">
            {items.map((person) => (
              <li key={person.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{person.nama}{person.unit ? <span className="text-xs text-muted-foreground"> · {person.unit}</span> : null}</span>
                <button type="button" className="text-xs font-bold text-brand-primary-deep hover:underline" onClick={() => onAdd(person, person.saran)}>+ {PERAN[person.saran]}</button>
                {person.saran !== "anggota" ? <button type="button" className="text-xs font-bold text-brand-primary-deep hover:underline" onClick={() => onAdd(person, "anggota")}>+ Anggota</button> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Proposals({ ruangId, ask }: { ruangId: string; ask: (pending: Pending) => void }) {
  const list = useLoad<{ items: Array<{ id: string; orang: Orang; jenis: "tambah" | "keluarkan"; alasan: string; dibuatPada: string }> }>(() => kerjaFetch(`/ruang/${ruangId}/usulan`), ruangId);
  if (list.state.status !== "ready" || list.state.data.items.length === 0) return null;
  return (
    <Panel>
      <SectionTitle>Usulan dari Organization Directory</SectionTitle>
      <p className="mb-2 text-xs text-muted-foreground">Usulan tidak mengubah keanggotaan sampai Anda menerimanya.</p>
      <ul className="space-y-2">
        {list.state.data.items.map((item) => (
          <li key={item.id} className="rounded-xl border border-border p-2.5 text-sm">
            <p><span className="font-bold">{item.jenis === "tambah" ? "Tambahkan" : "Keluarkan"} {item.orang.nama}</span></p>
            <p className="text-xs text-muted-foreground">{item.alasan} · {formatTanggal(item.dibuatPada)}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className={primaryButton} onClick={() => ask({ title: `Terima usulan untuk ${item.orang.nama}`, body: item.jenis === "tambah" ? "Ditambahkan sebagai anggota." : "Dikeluarkan dari ruang.", confirm: "Terima", run: (alasan) => kerjaFetch(`/usulan/${item.id}/terima`, { method: "POST", body: { alasan } }) })}>Terima</button>
              <button type="button" className={secondaryButton} onClick={() => ask({ title: `Tolak usulan untuk ${item.orang.nama}`, body: "Usulan yang sama tidak akan muncul lagi.", confirm: "Tolak", run: (alasan) => kerjaFetch(`/usulan/${item.id}/tolak`, { method: "POST", body: { alasan } }) })}>Tolak</button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Orphans({ ruangId }: { ruangId: string }) {
  const list = useLoad<{ items: Array<{ kartuId: string; judul: string; orang: Orang; tenggatPada: string | null }> }>(() => kerjaFetch(`/ruang/${ruangId}/yatim`), ruangId);
  if (list.state.status !== "ready" || list.state.data.items.length === 0) return null;
  return (
    <Panel>
      <SectionTitle>Kartu yatim</SectionTitle>
      <p className="mb-2 text-xs text-muted-foreground">Kartu terbuka yang ditugaskan kepada orang yang sudah keluar dari ruang atau tidak aktif lagi. Tugaskan ulang.</p>
      <ul className="space-y-1">
        {list.state.data.items.map((item) => (
          <li key={`${item.kartuId}-${item.orang.id}`} className="text-sm">
            <CardLink kartuId={item.kartuId} className="font-semibold text-brand-primary-deep hover:underline">{item.judul}</CardLink>
            <span className="text-muted-foreground"> · {item.orang.nama}{item.tenggatPada ? ` · tenggat ${formatTanggal(item.tenggatPada)}` : ""}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RoomSettings({ room, ask, act }: { room: RuangDetail; ask: (pending: Pending) => void; act: (run: () => Promise<unknown>) => Promise<void> }) {
  const [nama, setNama] = useState(room.nama);
  const [berakhir, setBerakhir] = useState(room.berakhirPada ?? "");
  return (
    <Panel>
      <SectionTitle>Ruang</SectionTitle>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (nama.trim() && nama.trim() !== room.nama) void act(() => kerjaFetch(`/ruang/${room.id}`, { method: "PATCH", body: { nama: nama.trim() } })); }}>
        <input className="sq-admin-input" aria-label="Nama ruang" value={nama} maxLength={120} onChange={(event) => setNama(event.target.value)} />
        <button type="submit" className={secondaryButton} disabled={!nama.trim() || nama.trim() === room.nama}>Simpan</button>
      </form>
      {room.jenis === "panitia" ? (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); ask({ title: "Ubah tanggal berakhir", body: `Ruang panitia berakhir ${berakhir}; setelah itu otomatis diarsipkan.`, confirm: "Simpan", run: (alasan) => kerjaFetch(`/ruang/${room.id}`, { method: "PATCH", body: { berakhir_pada: berakhir, alasan } }) }); }}>
          <label className="text-xs font-bold text-brand-heading">Berakhir pada<input type="date" className="sq-admin-input mt-1" value={berakhir} onChange={(event) => setBerakhir(event.target.value)} /></label>
          <button type="submit" className={secondaryButton} disabled={!berakhir || berakhir === room.berakhirPada}>Perpanjang</button>
        </form>
      ) : null}
      <div className="mt-3 border-t border-border pt-3">
        {room.status === "aktif" ? (
          <button type="button" className={secondaryButton} onClick={() => ask({ title: "Arsipkan ruang", body: "Isinya tetap bisa dibaca, tetapi kartu tidak bisa ditambah atau diubah.", confirm: "Arsipkan", danger: true, run: (alasan) => kerjaFetch(`/ruang/${room.id}`, { method: "PATCH", body: { status: "arsip", alasan } }) })}>Arsipkan ruang</button>
        ) : (
          <button type="button" className={secondaryButton} onClick={() => ask({ title: "Aktifkan kembali ruang", body: "Ruang panitia perlu tanggal berakhir yang belum lewat.", confirm: "Aktifkan", run: (alasan) => kerjaFetch(`/ruang/${room.id}`, { method: "PATCH", body: { status: "aktif", alasan } }) })}>Aktifkan kembali</button>
        )}
      </div>
    </Panel>
  );
}

function BoardSettings({ papanId, act }: { papanId: string; act: (run: () => Promise<unknown>) => Promise<void> }) {
  const board = useLoad<Papan>(() => kerjaFetch<Papan>(`/papan/${papanId}`), papanId);
  const [warna, setWarna] = useState<Warna>("biru");
  if (board.state.status !== "ready") return <Panel><p className="text-sm text-muted-foreground">Memuat papan…</p></Panel>;
  const data = board.state.data;
  const columns = data.kolom;
  return (
    <Panel>
      <SectionTitle>{data.nama}</SectionTitle>
      <InlineAdd label="Ganti nama papan" placeholder={data.nama} maxLength={80} submitLabel="Ganti nama" onAdd={(nama) => act(() => kerjaFetch(`/papan/${papanId}`, { method: "PATCH", body: { nama } }))} />
      <p className="mb-1 mt-3 text-xs font-bold text-muted-foreground">Kolom</p>
      <ul className="space-y-1.5">
        {columns.map((column, index) => (
          <li key={column.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 font-semibold">{column.nama} <span className="text-xs font-normal text-muted-foreground">({column.kartu.length})</span></span>
            <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={column.menandaiSelesai} onChange={(event) => void act(() => kerjaFetch(`/kolom/${column.id}`, { method: "PATCH", body: { menandai_selesai: event.target.checked } }))} />Menandai selesai</label>
            <button type="button" aria-label={`Naikkan ${column.nama}`} disabled={index === 0} className="disabled:opacity-30" onClick={() => void act(() => kerjaFetch(`/kolom/${column.id}`, { method: "PATCH", body: { urutan: index - 1 } }))}><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" aria-label={`Turunkan ${column.nama}`} disabled={index === columns.length - 1} className="disabled:opacity-30" onClick={() => void act(() => kerjaFetch(`/kolom/${column.id}`, { method: "PATCH", body: { urutan: index + 1 } }))}><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" aria-label={`Hapus kolom ${column.nama}`} className="text-muted-foreground hover:text-destructive" onClick={() => void act(() => kerjaFetch(`/kolom/${column.id}`, { method: "DELETE" }))}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
          </li>
        ))}
      </ul>
      <InlineAdd label="Kolom baru" placeholder="Nama kolom baru" maxLength={60} onAdd={(nama) => act(() => kerjaFetch(`/papan/${papanId}/kolom`, { method: "POST", body: { nama } }))} />
      <p className="mb-1 mt-3 text-xs font-bold text-muted-foreground">Label</p>
      <div className="flex flex-wrap gap-1.5">
        {data.label.map((label) => (
          <span key={label.id} className="inline-flex items-center gap-1">
            <LabelChip label={label} />
            <button type="button" aria-label={`Hapus label ${label.nama}`} className="text-muted-foreground hover:text-destructive" onClick={() => void act(() => kerjaFetch(`/label/${label.id}`, { method: "DELETE" }))}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </span>
        ))}
        {data.label.length === 0 ? <span className="text-sm text-muted-foreground">Belum ada label.</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <select aria-label="Warna label baru" className="sq-admin-input w-auto" value={warna} onChange={(event) => setWarna(event.target.value as Warna)}>
          {(Object.keys(WARNA) as Warna[]).map((value) => <option key={value} value={value}>{WARNA[value].nama}</option>)}
        </select>
        <div className="min-w-0 flex-1"><InlineAdd label="Label baru" placeholder="Nama label baru" maxLength={40} onAdd={(nama) => act(() => kerjaFetch(`/papan/${papanId}/label`, { method: "POST", body: { nama, warna } }))} /></div>
      </div>
    </Panel>
  );
}

function InlineAdd({ label, placeholder, maxLength, submitLabel = "Tambah", onAdd }: { label: string; placeholder: string; maxLength: number; submitLabel?: string; onAdd: (value: string) => Promise<unknown> }) {
  const [value, setValue] = useState("");
  return (
    <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (value.trim()) { void onAdd(value.trim()); setValue(""); } }}>
      <input className="sq-admin-input" aria-label={label} placeholder={placeholder} maxLength={maxLength} value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="submit" className={secondaryButton} disabled={!value.trim()}>{submitLabel}</button>
    </form>
  );
}
