import { CalendarClock, FolderOpen, Plus, Search, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { errorMessage, KerjaRequestError, kerjaFetch, type JenisSelesai, type KartuRingkas, type Papan } from "@/kerja/api";
import { JENIS_SELESAI, relatifTenggat } from "@/kerja/format";
import { KartuPanel } from "@/kerja/KartuPanel";
import { navigate } from "@/kerja/routes";
import { CardCounters } from "@/kerja/TugasPage";
import { AvatarStack, ErrorNote, LabelChip, Link, primaryButton, secondaryButton, StateCard, useLoad } from "@/kerja/ui";

interface DragState {
  kartuId: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  judul: string;
  width: number;
  target: { kolomId: string; indeks: number } | null;
}

/**
 * §8 Papan: columns and cards. Cards move by dragging (mouse at once, touch after a short press
 * so the page still scrolls), or from the card panel's "Pindahkan". Positions are fractional on
 * the server (§6.1), so a move writes one row; the board updates first and reloads on failure.
 */
export function PapanPage({ papanId, preview }: { papanId: string; preview?: Papan }) {
  const { state, reload, setData } = useLoad<Papan>(() => (preview ? Promise.resolve(preview) : kerjaFetch<Papan>(`/papan/${papanId}`)), papanId, preview);
  const [openCard, setOpenCard] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("kartu")));
  const [labelFilter, setLabelFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [mobileColumn, setMobileColumn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [askKind, setAskKind] = useState<{ kartuId: string; kolomId: string; indeks: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pressTimer = useRef<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setOpenCard(new URLSearchParams(window.location.search).get("kartu"));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const board = state.status === "ready" ? state.data : null;
  const canWork = Boolean(board && board.ruang.peranSaya !== "peninjau" && board.ruang.status === "aktif");

  const openPanel = (kartuId: string | null) => {
    const url = kartuId ? `/papan/${papanId}?kartu=${kartuId}` : `/papan/${papanId}`;
    window.history.pushState({}, "", url);
    setOpenCard(kartuId);
  };

  const visible = useCallback((card: KartuRingkas) => {
    if (labelFilter && !card.label.some((label) => label.id === labelFilter)) return false;
    if (personFilter && !card.orang.some((person) => person.id === personFilter)) return false;
    return true;
  }, [labelFilter, personFilter]);

  const move = useCallback(async (kartuId: string, kolomId: string, indeks: number, jenis?: JenisSelesai) => {
    if (!board) return;
    const source = board.kolom.find((column) => column.kartu.some((card) => card.id === kartuId));
    const card = source?.kartu.find((item) => item.id === kartuId);
    const target = board.kolom.find((column) => column.id === kolomId);
    if (!source || !card || !target) return;
    if (target.menandaiSelesai && !card.selesaiJenis && !jenis) {
      setAskKind({ kartuId, kolomId, indeks });
      return;
    }
    // Optimistic: the card shows in its new place at once.
    const next: Papan = {
      ...board,
      kolom: board.kolom.map((column) => {
        const without = column.kartu.filter((item) => item.id !== kartuId);
        if (column.id !== kolomId) return { ...column, kartu: without };
        const moved = { ...card, kolomId, ...(jenis ? { selesaiJenis: jenis } : {}) };
        return { ...column, kartu: [...without.slice(0, indeks), moved, ...without.slice(indeks)] };
      }),
    };
    setData(next);
    setError(null);
    try {
      await kerjaFetch(`/kartu/${kartuId}/pindah`, { method: "POST", body: { kolom_id: kolomId, indeks, ...(jenis ? { selesai_jenis: jenis } : {}) } });
      if (jenis || card.selesaiJenis) await reload();
    } catch (failure) {
      setError(errorMessage(failure, "Kartu belum bisa dipindah."));
      await reload();
    }
  }, [board, reload, setData]);

  // ---- pointer drag ----

  const targetAt = (x: number, y: number, kartuId: string): DragState["target"] => {
    const elements = document.elementsFromPoint(x, y);
    const tab = elements.find((element) => element instanceof HTMLElement && element.dataset.kolomTab) as HTMLElement | undefined;
    if (tab && board) {
      const column = board.kolom.find((item) => item.id === tab.dataset.kolomTab);
      return column ? { kolomId: column.id, indeks: column.kartu.filter((card) => card.id !== kartuId).length } : null;
    }
    const columnElement = elements.find((element) => element instanceof HTMLElement && element.dataset.kolomId) as HTMLElement | undefined;
    if (!columnElement) return null;
    const cards = [...columnElement.querySelectorAll<HTMLElement>("[data-kartu-id]")].filter((element) => element.dataset.kartuId !== kartuId);
    let indeks = cards.length;
    for (const [index, element] of cards.entries()) {
      const box = element.getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        indeks = index;
        break;
      }
    }
    return { kolomId: columnElement.dataset.kolomId!, indeks };
  };

  const preventTouchScroll = useCallback((event: TouchEvent) => {
    if (dragRef.current?.active) event.preventDefault();
  }, []);

  const endDrag = useCallback(() => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    document.removeEventListener("touchmove", preventTouchScroll);
    dragRef.current = null;
    setDrag(null);
  }, [preventTouchScroll]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, card: KartuRingkas) => {
    if (!canWork || event.button !== 0) return;
    const element = event.currentTarget;
    const state: DragState = {
      kartuId: card.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      active: false, judul: card.judul, width: element.getBoundingClientRect().width, target: null,
    };
    dragRef.current = state;
    if (event.pointerType !== "mouse") {
      // Touch: a 250 ms press starts the drag; moving earlier scrolls the page as usual.
      pressTimer.current = window.setTimeout(() => {
        const current = dragRef.current;
        if (!current || current.kartuId !== card.id) return;
        current.active = true;
        element.setPointerCapture?.(event.pointerId);
        document.addEventListener("touchmove", preventTouchScroll, { passive: false });
        navigator.vibrate?.(15);
        setDrag({ ...current });
      }, 250);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
    if (!current.active) {
      if (event.pointerType === "mouse" && distance > 6) {
        current.active = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } else {
        if (distance > 10) endDrag();
        return;
      }
    }
    current.x = event.clientX;
    current.y = event.clientY;
    current.target = targetAt(event.clientX, event.clientY, current.kartuId);
    // Keep the board scrolling sideways while dragging near its edges.
    const scroller = boardRef.current;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      if (event.clientX > box.right - 40) scroller.scrollBy({ left: 16 });
      if (event.clientX < box.left + 40) scroller.scrollBy({ left: -16 });
    }
    setDrag({ ...current });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>, card: KartuRingkas) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const wasActive = current.active;
    const target = current.target;
    endDrag();
    if (!wasActive) {
      openPanel(card.id);
      return;
    }
    if (target) void move(current.kartuId, target.kolomId, target.indeks);
  };

  useEffect(() => () => document.removeEventListener("touchmove", preventTouchScroll), [preventTouchScroll]);

  const columns = useMemo(() => board?.kolom ?? [], [board]);

  if (state.status === "loading") return <StateCard kind="loading" title="Memuat papan" />;
  if (state.status === "error") {
    return <StateCard kind="error" title={state.code === "tidak_ditemukan" ? "Papan tidak ditemukan" : "Papan belum dapat dimuat"} body={state.code === "tidak_ditemukan" ? "Papan ini tidak ada atau berada di ruang yang tidak Anda ikuti." : state.message} />;
  }
  const data = state.data;
  const totalCards = data.kolom.reduce((sum, column) => sum + column.kartu.length, 0);

  return (
    <div className={openCard ? "lg:grid lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-5" : ""}>
      <div className={openCard ? "hidden lg:block lg:min-w-0" : "min-w-0"}>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Link href={`/ruang/${data.ruang.id}`} className="text-xs font-semibold text-muted-foreground hover:underline">{data.ruang.nama}{data.ruang.status === "arsip" ? " · diarsipkan" : ""}</Link>
            <h1 className="font-display text-2xl font-bold text-brand-heading">{data.nama}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/ruang/${data.ruang.id}/cari`} className={secondaryButton}><Search className="h-4 w-4" aria-hidden="true" />Cari</Link>
            <Link href={`/ruang/${data.ruang.id}/berkas`} className={secondaryButton}><FolderOpen className="h-4 w-4" aria-hidden="true" />Berkas</Link>
            {data.ruang.peranSaya === "pj" ? <Link href={`/ruang/${data.ruang.id}/pengaturan`} className={secondaryButton}><Settings2 className="h-4 w-4" aria-hidden="true" />Pengaturan</Link> : null}
          </div>
        </div>
        {data.papanRuang.length > 1 ? (
          <nav aria-label="Papan di ruang ini" className="mb-3 flex gap-1 overflow-x-auto">
            {data.papanRuang.map((item) => (
              <Link key={item.id} href={`/papan/${item.id}`} ariaCurrent={item.id === data.id} className={`shrink-0 rounded-xl px-3 py-1.5 text-sm ${item.id === data.id ? "bg-brand-primary-pale font-bold text-brand-primary-deep" : "font-semibold text-muted-foreground hover:bg-muted"}`}>{item.nama}</Link>
            ))}
          </nav>
        ) : null}
        <div className="mb-3 grid grid-cols-2 gap-2 sm:flex">
          <select aria-label="Saring label" className="sq-admin-input sm:w-48" value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}>
            <option value="">Semua label</option>
            {data.label.map((label) => <option key={label.id} value={label.id}>{label.nama}</option>)}
          </select>
          <select aria-label="Saring penanggung jawab" className="sq-admin-input sm:w-56" value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}>
            <option value="">Semua orang</option>
            {data.anggota.filter((member) => member.peran !== "peninjau").map((member) => <option key={member.id} value={member.id}>{member.nama}</option>)}
          </select>
        </div>
        <ErrorNote message={error} />
        {totalCards === 0 && canWork ? <p className="mb-3 rounded-xl bg-info-soft px-3 py-2 text-sm text-info-ink">Papan ini masih kosong. Buat kartu pertama di kolom paling kiri, lalu tugaskan kepada anggota ruang.</p> : null}

        {/* Phones: one column at a time; the tabs are also drop targets. */}
        <div className="mb-2 flex gap-1 overflow-x-auto sm:hidden" role="tablist" aria-label="Kolom">
          {columns.map((column, index) => (
            <button
              key={column.id}
              type="button"
              role="tab"
              aria-selected={index === mobileColumn}
              data-kolom-tab={column.id}
              onClick={() => setMobileColumn(index)}
              className={`shrink-0 rounded-xl px-3 py-2 text-sm ${index === mobileColumn ? "bg-brand-primary-pale font-bold text-brand-primary-deep" : "font-semibold text-muted-foreground"} ${drag?.active && drag.target?.kolomId === column.id ? "ring-2 ring-brand-primary" : ""}`}
            >
              {column.nama} <span className="text-xs">({column.kartu.filter(visible).length})</span>
            </button>
          ))}
        </div>

        <div ref={boardRef} className="flex gap-3 overflow-x-auto pb-4 sm:snap-none" aria-label={`Papan ${data.nama}`}>
          {columns.map((column, index) => {
            const cards = column.kartu.filter(visible);
            const isTarget = drag?.active && drag.target?.kolomId === column.id;
            return (
              <section
                key={column.id}
                data-kolom-id={column.id}
                aria-label={`Kolom ${column.nama}`}
                className={`w-full shrink-0 rounded-2xl bg-muted/60 p-2 sm:w-72 ${index === mobileColumn ? "block" : "hidden sm:block"} ${isTarget ? "ring-2 ring-brand-primary" : ""}`}
              >
                <h2 className="flex items-center justify-between px-1.5 pb-2 pt-1 text-sm font-bold text-brand-heading">
                  <span className="truncate">{column.nama}</span>
                  <span className="text-xs font-semibold text-muted-foreground">{cards.length}</span>
                </h2>
                <ul className="flex min-h-12 flex-col gap-2">
                  {cards.map((card, cardIndex) => (
                    <li key={card.id}>
                      {isTarget && drag.target?.indeks === cardIndex && drag.kartuId !== card.id ? <div className="mb-2 h-1 rounded-full bg-brand-primary" /> : null}
                      <CardTile
                        card={card}
                        dragging={drag?.active === true && drag.kartuId === card.id}
                        selected={openCard === card.id}
                        draggable={canWork}
                        onPointerDown={(event) => onPointerDown(event, card)}
                        onPointerMove={onPointerMove}
                        onPointerUp={(event) => onPointerUp(event, card)}
                        onPointerCancel={endDrag}
                        onOpen={() => openPanel(card.id)}
                      />
                    </li>
                  ))}
                  {isTarget && drag.target && drag.target.indeks >= cards.filter((card) => card.id !== drag.kartuId).length ? <li className="h-1 rounded-full bg-brand-primary" /> : null}
                </ul>
                {canWork && !column.menandaiSelesai ? <AddCard kolomId={column.id} onAdded={(id) => { void reload(); openPanel(id); }} /> : null}
              </section>
            );
          })}
        </div>
      </div>

      {drag?.active ? (
        <div className="pointer-events-none fixed z-50 rounded-xl border border-brand-primary bg-surface-raised px-3 py-2 text-sm font-semibold shadow-[var(--shadow-raised)]" style={{ left: drag.x - 20, top: drag.y - 18, width: Math.min(drag.width, 280) }}>
          {drag.judul}
        </div>
      ) : null}

      {openCard ? (
        <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:rounded-2xl lg:border lg:border-border lg:bg-surface-raised lg:p-5 lg:shadow-[var(--shadow-soft)]" aria-label="Kartu">
          <KartuPanel key={openCard} kartuId={openCard} papan={data} onClose={() => openPanel(null)} onChanged={() => void reload()} />
        </aside>
      ) : null}

      {askKind ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="Pilih jenis selesai">
          <div className="w-full max-w-sm rounded-t-2xl bg-surface-raised p-5 shadow-[var(--shadow-raised)] sm:rounded-2xl">
            <h2 className="font-display text-lg font-bold text-brand-heading">Kartu ini selesai sebagai apa?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Kolom tujuan menandai kartu selesai. Jenisnya dipakai untuk laporan.</p>
            <div className="mt-4 grid gap-2">
              {(Object.keys(JENIS_SELESAI) as JenisSelesai[]).map((jenis) => (
                <button key={jenis} type="button" className={jenis === "tuntas" ? primaryButton : secondaryButton} onClick={() => { const pending = askKind; setAskKind(null); void move(pending.kartuId, pending.kolomId, pending.indeks, jenis); }}>
                  {JENIS_SELESAI[jenis]}
                </button>
              ))}
              <button type="button" className="min-h-10 text-sm font-bold text-muted-foreground hover:underline" onClick={() => setAskKind(null)}>Jangan pindahkan</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CardTile({
  card, dragging, selected, draggable, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onOpen,
}: {
  card: KartuRingkas;
  dragging: boolean;
  selected: boolean;
  draggable: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onOpen: () => void;
}) {
  const due = relatifTenggat(card.tenggatPada);
  return (
    <div
      role="button"
      tabIndex={0}
      data-kartu-id={card.id}
      aria-label={card.judul}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => draggable && event.preventDefault()}
      className={`cursor-pointer select-none rounded-xl border bg-surface-raised p-2.5 shadow-[var(--shadow-soft)] outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-brand-primary" : "border-border/70"} ${dragging ? "opacity-40" : ""}`}
      style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
    >
      {card.label.length > 0 ? <div className="mb-1.5 flex flex-wrap gap-1">{card.label.map((label) => <LabelChip key={label.id} label={label} />)}</div> : null}
      <p className={`text-sm font-semibold leading-snug ${card.selesaiJenis ? "text-muted-foreground" : "text-foreground"}`}>{card.judul}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {card.selesaiJenis ? <span className="rounded-md bg-success-soft px-1.5 py-0.5 font-bold text-success-ink">{JENIS_SELESAI[card.selesaiJenis]}</span> : null}
        {due && !card.selesaiJenis ? (
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold ${due.nada === "lewat" ? "bg-danger-soft text-danger-ink" : due.nada === "dekat" ? "bg-warning-soft text-warning-ink" : "bg-muted text-muted-foreground"}`}>
            <CalendarClock className="h-3 w-3" aria-hidden="true" />{due.teks.replace(/^Tenggat /, "")}
          </span>
        ) : null}
        <CardCounters ceklis={card.ceklis} komentar={card.komentar} lampiran={card.lampiran} />
        <span className="ml-auto"><AvatarStack people={card.orang} /></span>
      </div>
    </div>
  );
}

function AddCard({ kolomId, onAdded }: { kolomId: string; onAdded: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [judul, setJudul] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 flex w-full items-center gap-1.5 rounded-xl px-2 py-2 text-sm font-semibold text-muted-foreground hover:bg-surface-raised">
        <Plus className="h-4 w-4" aria-hidden="true" /> Tambah kartu
      </button>
    );
  }
  return (
    <form
      className="mt-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!judul.trim()) return;
        void kerjaFetch<{ id: string }>(`/kolom/${kolomId}/kartu`, { method: "POST", body: { judul: judul.trim() } })
          .then((created) => { setJudul(""); setOpen(false); onAdded(created.id); })
          .catch((failure: unknown) => setError(failure instanceof KerjaRequestError ? failure.message : "Kartu belum bisa dibuat."));
      }}
    >
      <textarea className="sq-admin-input" rows={2} autoFocus aria-label="Judul kartu baru" placeholder="Judul kartu" maxLength={200} value={judul} onChange={(event) => setJudul(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } if (event.key === "Escape") setOpen(false); }} />
      <ErrorNote message={error} />
      <div className="mt-2 flex gap-2">
        <button type="submit" className={primaryButton} disabled={!judul.trim()}>Tambah</button>
        <button type="button" className={secondaryButton} onClick={() => setOpen(false)}>Batal</button>
      </div>
    </form>
  );
}

/** A room opens on its first board. */
export function RuangRedirect({ ruangId }: { ruangId: string }) {
  const { state } = useLoad<{ papan: Array<{ id: string }> }>(() => kerjaFetch(`/ruang/${ruangId}`), ruangId);
  useEffect(() => {
    if (state.status === "ready" && state.data.papan[0]) navigate(`/papan/${state.data.papan[0].id}`, true);
  }, [state]);
  if (state.status === "error") return <StateCard kind="error" title={state.code === "tidak_ditemukan" ? "Ruang tidak ditemukan" : "Ruang belum dapat dimuat"} body={state.code === "tidak_ditemukan" ? "Ruang ini tidak ada atau Anda bukan anggotanya." : state.message} />;
  if (state.status === "ready" && !state.data.papan[0]) return <StateCard kind="empty" title="Ruang ini belum punya papan" body="Penanggung jawab ruang bisa menambah papan di Pengaturan." />;
  return <StateCard kind="loading" title="Membuka ruang" />;
}
