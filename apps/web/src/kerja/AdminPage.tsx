import { useState } from "react";

import { errorMessage, kerjaAdminFetch, type Orang } from "@/kerja/api";
import { formatTanggal, ukuranBerkas } from "@/kerja/format";
import { ErrorNote, Field, PageHeader, Panel, primaryButton, ReasonDialog, secondaryButton, StateCard, useLoad } from "@/kerja/ui";

interface AdminRoom {
  id: string;
  jenis: "tetap" | "panitia";
  nama: string;
  status: "aktif" | "arsip";
  berakhirPada: string | null;
  unit: { id: string; nama: string | null } | null;
  anggota: number;
  pj: Orang[];
  kuota: { terpakai: number; batas: number };
}

interface AdminUnit {
  id: string;
  nama: string;
  jenis: string;
  induk: string | null;
  jumlahOrang: number;
  ruangId: string | null;
}

type Person = { id: string; nama: string; unit: string | null };

/** §8 Admin Kerja (`kerja_admin`, D-2): rooms, creation from Directory units, quota and status. */
export function AdminPage() {
  const rooms = useLoad<{ items: AdminRoom[] }>(() => kerjaAdminFetch("/ruang"), "rooms");
  const units = useLoad<{ items: AdminUnit[]; directory: { stale: boolean } }>(() => kerjaAdminFetch("/unit"), "units");
  const [pending, setPending] = useState<{ title: string; body: string; confirm: string; run: (alasan: string) => Promise<unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  if (rooms.state.status === "error" && rooms.state.code === "kerja_admin_required") {
    return <StateCard kind="forbidden" title="Anda belum ditetapkan sebagai pengelola Kerja" />;
  }
  const refresh = async () => {
    await rooms.reload();
    await units.reload();
  };

  return (
    <>
      <PageHeader title="Pengelola Kerja">
        <p className="mt-1 text-sm text-muted-foreground">Buat ruang dan tunjuk penanggung jawabnya. Penanggung jawab ruang yang kemudian menambahkan anggota.</p>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Panel>
          <h2 className="mb-2 font-display text-base font-bold text-brand-heading">Ruang</h2>
          {rooms.state.status === "loading" ? <p className="text-sm text-muted-foreground">Memuat…</p> : null}
          {rooms.state.status === "ready" && rooms.state.data.items.length === 0 ? <p className="text-sm text-muted-foreground">Belum ada ruang. Mulai dengan membuat ruang unit dari daftar di samping.</p> : null}
          <ul className="divide-y divide-border">
            {rooms.state.status === "ready" ? rooms.state.data.items.map((room) => (
              <li key={room.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{room.nama} <span className="text-xs font-normal text-muted-foreground">· {room.jenis === "tetap" ? "unit" : "panitia"}{room.status === "arsip" ? " · diarsipkan" : ""}</span></p>
                    <p className="text-xs text-muted-foreground">PJ: {room.pj.map((person) => person.nama).join(", ") || "belum ada"} · {room.anggota} anggota · lampiran {ukuranBerkas(room.kuota.terpakai)} dari {ukuranBerkas(room.kuota.batas)}{room.berakhirPada ? ` · berakhir ${formatTanggal(`${room.berakhirPada}T00:00:00+07:00`, false)}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <QuotaButton room={room} onAsk={setPending} />
                    <PjButton room={room} onAsk={setPending} />
                    <button type="button" className={secondaryButton} onClick={() => setPending({
                      title: room.status === "aktif" ? `Arsipkan ${room.nama}` : `Aktifkan ${room.nama}`,
                      body: room.status === "aktif" ? "Isinya tetap terbaca; kartu tidak bisa ditambah." : "Ruang panitia perlu tanggal berakhir yang belum lewat.",
                      confirm: room.status === "aktif" ? "Arsipkan" : "Aktifkan",
                      run: (alasan) => kerjaAdminFetch(`/ruang/${room.id}`, { method: "PATCH", body: { status: room.status === "aktif" ? "arsip" : "aktif", alasan } }),
                    })}>{room.status === "aktif" ? "Arsipkan" : "Aktifkan"}</button>
                  </div>
                </div>
              </li>
            )) : null}
          </ul>
        </Panel>
        <div className="flex flex-col gap-4">
          <CreatePermanent units={units.state.status === "ready" ? units.state.data : null} onAsk={setPending} />
          <CreateCommittee onAsk={setPending} />
        </div>
      </div>
      {pending ? (
        <ReasonDialog
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirm}
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

type Ask = (pending: { title: string; body: string; confirm: string; run: (alasan: string) => Promise<unknown> }) => void;

function PersonSearch({ value, onChange }: { value: Person | null; onChange: (person: Person | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
        <span className="flex-1 font-semibold">{value.nama}{value.unit ? <span className="font-normal text-muted-foreground"> · {value.unit}</span> : null}</span>
        <button type="button" className="text-xs font-bold text-brand-primary-deep" onClick={() => onChange(null)}>Ganti</button>
      </div>
    );
  }
  return (
    <div>
      <div className="flex gap-2">
        <input className="sq-admin-input" placeholder="Cari nama atau NIP" aria-label="Cari penanggung jawab" value={q} onChange={(event) => setQ(event.target.value)} />
        <button type="button" className={secondaryButton} onClick={() => void kerjaAdminFetch<{ items: Person[] }>(`/orang?q=${encodeURIComponent(q)}`).then((body) => { setResults(body.items); setError(null); }).catch((failure: unknown) => setError(errorMessage(failure)))}>Cari</button>
      </div>
      <ErrorNote message={error} />
      <ul className="mt-1 max-h-48 overflow-y-auto">
        {results.map((person) => (
          <li key={person.id}><button type="button" className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => onChange(person)}>{person.nama}{person.unit ? <span className="text-muted-foreground"> · {person.unit}</span> : null}</button></li>
        ))}
      </ul>
    </div>
  );
}

function CreatePermanent({ units, onAsk }: { units: { items: AdminUnit[]; directory: { stale: boolean } } | null; onAsk: Ask }) {
  const [unitId, setUnitId] = useState("");
  const [pj, setPj] = useState<Person | null>(null);
  const free = units?.items.filter((unit) => !unit.ruangId) ?? [];
  const unit = free.find((item) => item.id === unitId);
  return (
    <Panel>
      <h2 className="mb-2 font-display text-base font-bold text-brand-heading">Ruang unit baru</h2>
      {units?.directory.stale ? <p className="mb-2 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning-ink">Organization Directory belum diperbarui.</p> : null}
      <div className="space-y-3">
        <Field label="Unit dari Organization Directory">
          <select className="sq-admin-input" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
            <option value="">Pilih unit</option>
            {free.map((item) => <option key={item.id} value={item.id}>{item.nama}{item.induk ? ` (${item.induk})` : ""} · {item.jumlahOrang} orang</option>)}
          </select>
        </Field>
        <Field label="Penanggung jawab ruang"><PersonSearch value={pj} onChange={setPj} /></Field>
        <button type="button" className={primaryButton} disabled={!unit || !pj} onClick={() => unit && pj && onAsk({
          title: `Buat ruang ${unit.nama}`, body: `Penanggung jawab: ${pj.nama}. Papan pertama dibuat dengan tiga kolom.`, confirm: "Buat ruang",
          run: async (alasan) => { await kerjaAdminFetch("/ruang", { method: "POST", body: { jenis: "tetap", unit_id: unit.id, pj: pj.id, alasan } }); setUnitId(""); setPj(null); },
        })}>Buat ruang unit</button>
      </div>
    </Panel>
  );
}

function CreateCommittee({ onAsk }: { onAsk: Ask }) {
  const [nama, setNama] = useState("");
  const [berakhir, setBerakhir] = useState("");
  const [pj, setPj] = useState<Person | null>(null);
  return (
    <Panel>
      <h2 className="mb-2 font-display text-base font-bold text-brand-heading">Ruang panitia baru</h2>
      <div className="space-y-3">
        <Field label="Nama panitia"><input className="sq-admin-input" placeholder="Misalnya Panitia SPMB 2027" value={nama} maxLength={120} onChange={(event) => setNama(event.target.value)} /></Field>
        <Field label="Berakhir pada" helper="Wajib. Setelah tanggal ini ruang otomatis diarsipkan; bisa diperpanjang."><input type="date" className="sq-admin-input" value={berakhir} onChange={(event) => setBerakhir(event.target.value)} /></Field>
        <Field label="Penanggung jawab ruang"><PersonSearch value={pj} onChange={setPj} /></Field>
        <button type="button" className={primaryButton} disabled={!nama.trim() || !berakhir || !pj} onClick={() => pj && onAsk({
          title: `Buat ${nama.trim()}`, body: `Penanggung jawab: ${pj.nama}. Berakhir ${berakhir}.`, confirm: "Buat ruang",
          run: async (alasan) => { await kerjaAdminFetch("/ruang", { method: "POST", body: { jenis: "panitia", nama: nama.trim(), berakhir_pada: berakhir, pj: pj.id, alasan } }); setNama(""); setBerakhir(""); setPj(null); },
        })}>Buat ruang panitia</button>
      </div>
    </Panel>
  );
}

function QuotaButton({ room, onAsk }: { room: AdminRoom; onAsk: Ask }) {
  const [open, setOpen] = useState(false);
  const [mb, setMb] = useState(String(Math.round(room.kuota.batas / 1024 / 1024)));
  if (!open) return <button type="button" className={secondaryButton} onClick={() => setOpen(true)}>Kuota</button>;
  return (
    <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); setOpen(false); onAsk({ title: `Kuota ${room.nama}`, body: `Menjadi ${mb} MB.`, confirm: "Simpan", run: (alasan) => kerjaAdminFetch(`/ruang/${room.id}`, { method: "PATCH", body: { kuota_mb: Number(mb), alasan } }) }); }}>
      <input type="number" min={1} max={102400} className="sq-admin-input w-24" aria-label="Kuota dalam MB" value={mb} onChange={(event) => setMb(event.target.value)} />
      <span className="text-xs">MB</span>
      <button type="submit" className={secondaryButton}>OK</button>
    </form>
  );
}

function PjButton({ room, onAsk }: { room: AdminRoom; onAsk: Ask }) {
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  if (!open) return <button type="button" className={secondaryButton} onClick={() => setOpen(true)}>Tetapkan PJ</button>;
  return (
    <div className="w-full sm:w-72">
      <PersonSearch value={person} onChange={(value) => {
        setPerson(value);
        if (value) {
          setOpen(false);
          onAsk({ title: `Tetapkan ${value.nama} sebagai PJ ${room.nama}`, body: "Bila sudah anggota, perannya menjadi penanggung jawab.", confirm: "Tetapkan", run: (alasan) => kerjaAdminFetch(`/ruang/${room.id}/pj`, { method: "POST", body: { person_id: value.id, alasan } }) });
        }
      }} />
    </div>
  );
}
