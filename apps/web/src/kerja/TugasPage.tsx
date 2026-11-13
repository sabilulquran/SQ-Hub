import { CheckSquare, MessageSquare, Paperclip, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { CardDialog, CardLink } from "@/kerja/CardDialog";
import { kerjaFetch, type RuangRingkas, type TugasSaya } from "@/kerja/api";
import { formatTanggal, JENIS_SELESAI, PERAN, relatifTenggat } from "@/kerja/format";
import { AvatarStack, DateTile, LabelChip, Link, PageHeader, StateCard, useLoad } from "@/kerja/ui";

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
  const items = data?.items ?? [];
  const now = Date.now();
  const lewat = items.filter((item) => item.lewatTenggat);
  const pekanIni = items.filter((item) => !item.lewatTenggat && item.tenggatEfektif && Date.parse(item.tenggatEfektif) - now < 7 * 86_400_000);
  const nanti = items.filter((item) => !item.lewatTenggat && item.tenggatEfektif && Date.parse(item.tenggatEfektif) - now >= 7 * 86_400_000);
  const tanpa = items.filter((item) => !item.lewatTenggat && !item.tenggatEfektif);
  const groups: Array<{ id: string; title: string; items: TugasSaya[]; danger?: boolean }> = [
    { id: "lewat", title: "Lewat tenggat", items: lewat, danger: true },
    { id: "pekan", title: "Tujuh hari ke depan", items: pekanIni },
    { id: "nanti", title: "Sesudahnya", items: nanti },
    { id: "tanpa", title: "Tanpa tenggat", items: tanpa },
  ];

  return (
    <>
      <PageHeader
        title="Tugas saya"
        actions={(
          <>
            <div className="w-full sm:w-56">
              <select aria-label="Saring ruang" className="sq-admin-input" value={ruang} onChange={(event) => setRuang(event.target.value)}>
                <option value="">Semua ruang</option>
                {rooms.map((room) => <option key={room.id} value={room.id}>{room.nama}</option>)}
              </select>
            </div>
            <div className="w-full sm:w-44">
              <select aria-label="Saring status" className="sq-admin-input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="terbuka">Belum selesai</option>
                <option value="selesai">Sudah selesai</option>
                <option value="semua">Semua</option>
              </select>
            </div>
          </>
        )}
      >
        <p className="mt-1 text-sm text-muted-foreground">Kartu dan butir ceklis yang ditugaskan kepada Anda, dari semua ruang</p>
      </PageHeader>
      {data && items.length > 0 && status === "terbuka" ? (
        <dl className="mb-8 grid grid-cols-3 gap-3 sm:max-w-xl">
          {[["Lewat tenggat", lewat.length, true], ["Tujuh hari ke depan", pekanIni.length, false], ["Tanpa tenggat", tanpa.length, false]].map(([label, count, danger]) => (
            <div key={String(label)} className="rounded-2xl border border-border/70 bg-surface-raised px-4 py-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className={`mt-1 text-2xl font-semibold tabular-nums ${danger && Number(count) > 0 ? "text-danger-ink" : "text-foreground"}`}>{count}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {state.status === "loading" ? <StateCard kind="loading" title="Memuat tugas" /> : null}
      {state.status === "error" ? <StateCard kind="error" title="Tugas belum dapat dimuat" body={state.message} /> : null}
      {data && items.length === 0 ? (
        <StateCard
          kind="empty"
          title={status === "terbuka" ? "Tidak ada tugas yang menunggu Anda" : "Belum ada tugas di sini"}
          body="Buka salah satu ruang Anda lalu buat kartu pertama, atau minta penanggung jawab ruang menugaskan kartu kepada Anda."
          action={<Link href="/ruang" className="inline-flex min-h-10 items-center rounded-xl border border-border px-3 text-sm font-semibold text-brand-primary-deep">Lihat ruang saya</Link>}
        />
      ) : null}
      {status === "terbuka"
        ? groups.filter((group) => group.items.length > 0).map((group) => (
          <section key={group.id} className="mb-8" aria-labelledby={`tugas-${group.id}`}>
            <h2 id={`tugas-${group.id}`} className={`mb-3 flex items-baseline gap-2 text-sm font-semibold ${group.danger ? "text-danger-ink" : "text-brand-heading"}`}>
              {group.title}<span className="text-xs font-normal tabular-nums text-muted-foreground">{group.items.length}</span>
            </h2>
            <TaskList items={group.items} />
          </section>
        ))
        : items.length > 0 ? <TaskList items={items} /> : null}
      <CardDialog />
    </>
  );
}

function TaskList({ items }: { items: TugasSaya[] }) {
  return (
    <ul className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-surface-raised">
      {items.map((item) => {
        const due = relatifTenggat(item.tenggatEfektif);
        return (
          <li key={item.id}>
            <CardLink kartuId={item.id} className="flex gap-4 px-4 py-4 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
              <DateTile iso={item.tenggatEfektif} nada={item.selesaiJenis ? "selesai" : due?.nada ?? "biasa"} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug text-foreground">{item.judul}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.ruangNama} · {item.papanNama} · {item.kolomNama}</p>
                  </div>
                  <AvatarStack people={item.orang} />
                </div>
                {item.butirSaya.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {item.butirSaya.map((butir) => (
                      <li key={butir.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckSquare className={`h-4 w-4 shrink-0 ${butir.selesai ? "text-success-ink" : ""}`} aria-hidden="true" />
                        <span className={butir.selesai ? "line-through" : "text-foreground"}>{butir.nama}</span>
                        {butir.tenggatPada ? <span className="text-xs tabular-nums">{formatTanggal(butir.tenggatPada)}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.label.length > 0 || item.selesaiJenis || item.ceklis.total + item.komentar + item.lampiran > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {item.selesaiJenis ? <span className="inline-flex items-center gap-1 font-medium text-success-ink"><CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />{JENIS_SELESAI[item.selesaiJenis]}</span> : null}
                    {item.label.map((label) => <LabelChip key={label.id} label={label} />)}
                    <CardCounters ceklis={item.ceklis} komentar={item.komentar} lampiran={item.lampiran} />
                  </div>
                ) : null}
              </div>
            </CardLink>
          </li>
        );
      })}
    </ul>
  );
}

export function CardCounters({ ceklis, komentar, lampiran }: { ceklis: { selesai: number; total: number }; komentar: number; lampiran: number }) {
  return (
    <span className="inline-flex items-center gap-3 tabular-nums text-muted-foreground">
      {ceklis.total > 0 ? <span className={`inline-flex items-center gap-1 ${ceklis.selesai === ceklis.total ? "text-success-ink" : ""}`}><CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />{ceklis.selesai}/{ceklis.total}</span> : null}
      {komentar > 0 ? <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{komentar}</span> : null}
      {lampiran > 0 ? <span className="inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" aria-hidden="true" />{lampiran}</span> : null}
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
          <h2 className="mb-3 text-sm font-semibold text-brand-heading">{group.title}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((room) => (
              <li key={room.id}>
                <Link href={`/ruang/${room.id}`} className="flex h-full flex-col rounded-2xl border border-border/70 bg-surface-raised p-5 transition-colors hover:border-brand-primary/40">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-foreground">{room.nama}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" aria-hidden="true" />{PERAN[room.peran]}</span>
                  </span>
                  <span className="mt-4 flex items-baseline gap-4 tabular-nums">
                    <span><span className="text-2xl font-semibold text-foreground">{room.kartuTerbuka}</span> <span className="text-xs text-muted-foreground">terbuka</span></span>
                    {room.kartuLewatTenggat > 0 ? <span><span className="text-2xl font-semibold text-danger-ink">{room.kartuLewatTenggat}</span> <span className="text-xs text-muted-foreground">lewat tenggat</span></span> : null}
                  </span>
                  {room.berakhirPada ? (
                    <span className={`mt-3 text-xs ${room.akanBerakhir ? "text-warning-ink" : "text-muted-foreground"}`}>
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
