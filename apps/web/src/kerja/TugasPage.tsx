import { AlertTriangle, CalendarClock, CheckSquare, MessageSquare, Paperclip, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { kerjaFetch, type RuangRingkas, type TugasSaya } from "@/kerja/api";
import { formatTanggal, JENIS_SELESAI, PERAN, relatifTenggat } from "@/kerja/format";
import { AvatarStack, LabelChip, Link, PageHeader, StateCard, useLoad } from "@/kerja/ui";

export type TugasData = { items: TugasSaya[]; ruang: Array<{ id: string; nama: string }> };

/** §8 Tugas Saya: the first page after sign-in — everything assigned to me, overdue first. */
export function TugasPage({ preview }: { preview?: TugasData }) {
  const [ruang, setRuang] = useState("");
  const [status, setStatus] = useState<"terbuka" | "selesai" | "semua">("terbuka");
  const query = new URLSearchParams({ status, ...(ruang ? { ruang } : {}) }).toString();
  const { state } = useLoad<TugasData>(() => (preview ? Promise.resolve(preview) : kerjaFetch<TugasData>(`/tugas-saya?${query}`)), query, preview);
  const data = state.status === "ready" ? state.data : null;
  const [rooms, setRooms] = useState<TugasData["ruang"]>(preview?.ruang ?? []);
  useEffect(() => {
    if (data) setRooms(data.ruang);
  }, [data]);
  const lewat = data?.items.filter((item) => item.lewatTenggat) ?? [];
  const lain = data?.items.filter((item) => !item.lewatTenggat) ?? [];

  return (
    <>
      <PageHeader title="Tugas saya">
        <p className="mt-1 text-sm text-muted-foreground">Kartu dan butir ceklis yang ditugaskan kepada Anda dari semua ruang.</p>
      </PageHeader>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <select aria-label="Saring ruang" className="sq-admin-input sm:w-56" value={ruang} onChange={(event) => setRuang(event.target.value)}>
          <option value="">Semua ruang</option>
          {rooms.map((room) => <option key={room.id} value={room.id}>{room.nama}</option>)}
        </select>
        <select aria-label="Saring status" className="sq-admin-input sm:w-44" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="terbuka">Belum selesai</option>
          <option value="selesai">Sudah selesai</option>
          <option value="semua">Semua</option>
        </select>
      </div>
      {state.status === "loading" ? <StateCard kind="loading" title="Memuat tugas" /> : null}
      {state.status === "error" ? <StateCard kind="error" title="Tugas belum dapat dimuat" body={state.message} /> : null}
      {data && data.items.length === 0 ? (
        <StateCard
          kind="empty"
          title={status === "terbuka" ? "Tidak ada tugas yang menunggu Anda" : "Belum ada tugas di sini"}
          body="Buka salah satu ruang Anda lalu buat kartu pertama, atau minta penanggung jawab ruang menugaskan kartu kepada Anda."
          action={<Link href="/ruang" className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-sm font-bold text-brand-primary-deep">Lihat ruang saya</Link>}
        />
      ) : null}
      {lewat.length > 0 ? (
        <section className="mb-6" aria-labelledby="tugas-lewat">
          <h2 id="tugas-lewat" className="mb-2 flex items-center gap-1.5 text-sm font-bold text-danger-ink">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Lewat tenggat ({lewat.length})
          </h2>
          <TaskList items={lewat} />
        </section>
      ) : null}
      {lain.length > 0 ? (
        <section aria-label="Tugas lain">
          {lewat.length > 0 ? <h2 className="mb-2 text-sm font-bold text-brand-heading">Berikutnya</h2> : null}
          <TaskList items={lain} />
        </section>
      ) : null}
    </>
  );
}

function TaskList({ items }: { items: TugasSaya[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const due = relatifTenggat(item.tenggatEfektif);
        return (
          <li key={item.id}>
            <Link href={`/kartu/${item.id}`} className="block rounded-2xl border border-border/70 bg-surface-raised p-3 shadow-[var(--shadow-soft)] hover:border-brand-primary/50 sm:p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-muted-foreground">{item.ruangNama} · {item.papanNama} · {item.kolomNama}</p>
                  <p className="mt-0.5 font-bold text-foreground">{item.judul}</p>
                </div>
                <AvatarStack people={item.orang} />
              </div>
              {item.butirSaya.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {item.butirSaya.map((butir) => (
                    <li key={butir.id} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CheckSquare className={`h-3.5 w-3.5 shrink-0 ${butir.selesai ? "text-success-ink" : ""}`} aria-hidden="true" />
                      <span className={butir.selesai ? "line-through" : ""}>{butir.nama}</span>
                      {butir.tenggatPada ? <span className="text-xs">· {formatTanggal(butir.tenggatPada)}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                {item.selesaiJenis ? <span className="rounded-md bg-success-soft px-1.5 py-0.5 font-bold text-success-ink">{JENIS_SELESAI[item.selesaiJenis]}</span> : null}
                {due && !item.selesaiJenis ? (
                  <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold ${due.nada === "lewat" ? "bg-danger-soft text-danger-ink" : due.nada === "dekat" ? "bg-warning-soft text-warning-ink" : "bg-muted text-muted-foreground"}`}>
                    <CalendarClock className="h-3 w-3" aria-hidden="true" />{due.teks}
                  </span>
                ) : null}
                {item.label.map((label) => <LabelChip key={label.id} label={label} />)}
                <CardCounters ceklis={item.ceklis} komentar={item.komentar} lampiran={item.lampiran} />
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function CardCounters({ ceklis, komentar, lampiran }: { ceklis: { selesai: number; total: number }; komentar: number; lampiran: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground">
      {ceklis.total > 0 ? <span className={`inline-flex items-center gap-0.5 ${ceklis.selesai === ceklis.total ? "text-success-ink" : ""}`}><CheckSquare className="h-3 w-3" aria-hidden="true" />{ceklis.selesai}/{ceklis.total}</span> : null}
      {komentar > 0 ? <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" aria-hidden="true" />{komentar}</span> : null}
      {lampiran > 0 ? <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" aria-hidden="true" />{lampiran}</span> : null}
    </span>
  );
}

export type RuangData = { items: RuangRingkas[] };

/** §8 Daftar ruang: permanent and committee rooms apart; rooms ending within 30 days marked. */
export function RuangListPage({ preview }: { preview?: RuangData }) {
  const { state } = useLoad<RuangData>(() => (preview ? Promise.resolve(preview) : kerjaFetch<RuangData>("/ruang")), "ruang", preview);
  if (state.status === "loading") return <StateCard kind="loading" title="Memuat ruang" />;
  if (state.status === "error") return <StateCard kind="error" title="Ruang belum dapat dimuat" body={state.message} />;
  const active = state.data.items.filter((room) => room.status === "aktif");
  const groups = [
    { title: "Ruang unit", items: active.filter((room) => room.jenis === "tetap") },
    { title: "Ruang panitia", items: active.filter((room) => room.jenis === "panitia") },
    { title: "Diarsipkan", items: state.data.items.filter((room) => room.status === "arsip") },
  ];
  return (
    <>
      <PageHeader title="Ruang" />
      {state.data.items.length === 0 ? (
        <StateCard kind="empty" title="Anda belum menjadi anggota ruang mana pun" body="Ruang unit dibuat oleh Kepala HCM, lalu penanggung jawab ruang menambahkan anggotanya. Hubungi kepala unit Anda bila seharusnya Anda sudah ada di sebuah ruang." />
      ) : null}
      {groups.filter((group) => group.items.length > 0).map((group) => (
        <section key={group.title} className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-brand-heading">{group.title}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((room) => (
              <li key={room.id}>
                <Link href={`/ruang/${room.id}`} className="flex h-full flex-col rounded-2xl border border-border/70 bg-surface-raised p-4 shadow-[var(--shadow-soft)] hover:border-brand-primary/50">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-bold text-foreground">{room.nama}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground"><Users className="h-3 w-3" aria-hidden="true" />{PERAN[room.peran]}</span>
                  </span>
                  <span className="mt-2 text-sm text-muted-foreground">
                    {room.kartuTerbuka} kartu terbuka{room.kartuLewatTenggat > 0 ? <span className="font-bold text-danger-ink"> · {room.kartuLewatTenggat} lewat tenggat</span> : null}
                  </span>
                  {room.berakhirPada ? (
                    <span className={`mt-2 self-start rounded-md px-1.5 py-0.5 text-xs font-bold ${room.akanBerakhir ? "bg-warning-soft text-warning-ink" : "bg-muted text-muted-foreground"}`}>
                      Berakhir {formatTanggal(`${room.berakhirPada}T00:00:00+07:00`, false)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
