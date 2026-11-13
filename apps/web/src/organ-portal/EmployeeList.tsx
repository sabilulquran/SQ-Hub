import { ChevronLeft, ChevronRight, LoaderCircle, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { formatDay } from "@/organ-portal/format";

export interface OrganEmployee {
  fullName: string;
  employeeNumber: string;
  unitName: string | null;
  position: string | null;
  employmentStatus: string | null;
  startedOn: string | null;
}

export interface OrganEmployeePage {
  items: OrganEmployee[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  units: Array<{ id: string; name: string }>;
}

export type EmployeeListState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error" }
  | { status: "ready"; page: OrganEmployeePage };

interface Filters {
  page: number;
  q: string;
  unitId: string;
}

/** Loads one page of HCIS ORG-014 through the portal (`/api/organ/applications/:key/employees`). */
export function EmployeeList({ applicationKey }: { applicationKey: string }) {
  const [filters, setFilters] = useState<Filters>({ page: 1, q: "", unitId: "" });
  const [state, setState] = useState<EmployeeListState>({ status: "loading" });
  const latest = useRef(0);

  const load = useCallback(async (next: Filters) => {
    // Only the newest request may update the list, so a slow older reply cannot overwrite it.
    const request = ++latest.current;
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    const params = new URLSearchParams({ page: String(next.page), pageSize: "25" });
    if (next.q.trim().length >= 2) params.set("q", next.q.trim());
    if (next.unitId) params.set("unitId", next.unitId);
    try {
      const response = await fetch(`/api/organ/applications/${encodeURIComponent(applicationKey)}/employees?${params}`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (request !== latest.current) return;
      if (response.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (response.status === 404 || response.status === 403) {
        setState({ status: "unavailable" });
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as OrganEmployeePage;
      if (request === latest.current) setState({ status: "ready", page: body });
    } catch {
      if (request === latest.current) setState({ status: "error" });
    }
  }, [applicationKey]);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  if (state.status === "unavailable") return null;
  return (
    <EmployeeListView
      state={state}
      filters={filters}
      onSearch={(q) => setFilters((current) => ({ ...current, q, page: 1 }))}
      onUnit={(unitId) => setFilters((current) => ({ ...current, unitId, page: 1 }))}
      onPage={(page) => setFilters((current) => ({ ...current, page }))}
      onRetry={() => void load(filters)}
    />
  );
}

export function EmployeeListView({
  state,
  filters,
  onSearch,
  onUnit,
  onPage,
  onRetry,
}: {
  state: EmployeeListState;
  filters: Filters;
  onSearch?: (q: string) => void;
  onUnit?: (unitId: string) => void;
  onPage?: (page: number) => void;
  onRetry?: () => void;
}) {
  const [draft, setDraft] = useState(filters.q);
  const page = state.status === "ready" ? state.page : null;
  const first = page && page.pagination.total > 0 ? (page.pagination.page - 1) * page.pagination.pageSize + 1 : 0;
  const last = page ? Math.min(page.pagination.page * page.pagination.pageSize, page.pagination.total) : 0;

  // The API searches from two characters; one character keeps the current list and says why.
  const tooShort = draft.trim().length === 1;
  const search = () => {
    if (!tooShort && draft.trim() !== filters.q.trim()) onSearch?.(draft.trim());
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    search();
  };

  return (
    <section className="mt-12" aria-labelledby="daftar-pegawai">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="daftar-pegawai" className="text-xl font-semibold text-brand-heading">Daftar pegawai</h2>
        <p className="text-sm text-muted-foreground">Pegawai aktif. Hanya nama dan data kepegawaian yang ditampilkan</p>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <form onSubmit={submit} className="relative flex-1" role="search">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          <label htmlFor="cari-pegawai" className="sr-only">Cari nama atau NIP</label>
          <input
            id="cari-pegawai"
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={search}
            aria-describedby={tooShort ? "cari-pegawai-hint" : undefined}
            placeholder="Cari nama atau NIP"
            minLength={2}
            maxLength={80}
            className="h-10 w-full rounded-lg border border-border bg-surface-raised pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {tooShort ? <p id="cari-pegawai-hint" className="mt-1 text-xs text-muted-foreground">Ketik minimal 2 huruf</p> : null}
        </form>
        <label className="sr-only" htmlFor="unit-pegawai">Unit</label>
        <select
          id="unit-pegawai"
          value={filters.unitId}
          onChange={(event) => onUnit?.(event.target.value)}
          className="h-10 rounded-lg border border-border bg-surface-raised px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
        >
          <option value="">Semua unit</option>
          {(page?.units ?? []).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
        </select>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface-raised">
        {state.status === "loading" ? (
          <p className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" /> Memuat daftar pegawai
          </p>
        ) : null}
        {state.status === "error" ? (
          <p className="flex flex-wrap items-center gap-3 px-5 py-8 text-sm text-muted-foreground">
            Daftar pegawai belum dapat dimuat
            {onRetry ? <button type="button" onClick={onRetry} className="font-medium text-brand-primary-deep underline-offset-4 hover:underline">Coba lagi</button> : null}
          </p>
        ) : null}
        {page && page.items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">Tidak ada pegawai yang cocok dengan pencarian ini</p>
        ) : null}
        {page && page.items.length > 0 ? (
          <>
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-border bg-muted/60 text-[13px] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-3 font-normal">Nama</th>
                  <th scope="col" className="px-4 py-3 font-normal">NIP</th>
                  <th scope="col" className="px-4 py-3 font-normal">Unit</th>
                  <th scope="col" className="px-4 py-3 font-normal">Jabatan</th>
                  <th scope="col" className="px-4 py-3 font-normal">Status</th>
                  <th scope="col" className="px-5 py-3 text-right font-normal">Mulai bekerja</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {page.items.map((employee) => (
                  <tr key={employee.employeeNumber} className="transition-colors hover:bg-muted/40">
                    <td className="px-5 py-3 font-medium text-brand-heading">{employee.fullName}</td>
                    <td className="px-4 py-3 font-mono text-[13px] tabular-nums text-muted-foreground">{employee.employeeNumber}</td>
                    <td className="px-4 py-3 text-foreground">{employee.unitName ?? "—"}</td>
                    <td className="px-4 py-3 text-foreground">{employee.position ?? "—"}</td>
                    <td className="px-4 py-3 text-foreground">{employee.employmentStatus ?? "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{formatDay(employee.startedOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-border md:hidden">
              {page.items.map((employee) => (
                <li key={employee.employeeNumber} className="px-4 py-3">
                  <p className="font-medium text-brand-heading">{employee.fullName}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {[employee.position, employee.unitName].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                    {employee.employeeNumber}{employee.employmentStatus ? ` · ${employee.employmentStatus}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {page && page.pagination.total > 0 ? (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="tabular-nums">{first}–{last} dari {page.pagination.total} pegawai</span>
          <span className="flex gap-2">
            <button
              type="button"
              disabled={page.pagination.page <= 1}
              onClick={() => onPage?.(page.pagination.page - 1)}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-brand-heading transition-colors hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" /> Sebelumnya
            </button>
            <button
              type="button"
              disabled={page.pagination.page >= page.pagination.pageCount}
              onClick={() => onPage?.(page.pagination.page + 1)}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-brand-heading transition-colors hover:bg-muted disabled:opacity-40"
            >
              Berikutnya <ChevronRight className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : null}
    </section>
  );
}
