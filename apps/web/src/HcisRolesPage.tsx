import { KeyRound, RefreshCw, Search, UserMinus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import type { AdminStaff, HcisAccountLookup, HcisRoleCatalogEntry, WorkspaceSnapshot } from "@/types";

interface Props {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  onAuthorizationDenied?: (reason: "forbidden" | "reauth") => void;
}

type CatalogState =
  | { status: "loading" }
  | { status: "ready"; roles: HcisRoleCatalogEntry[] }
  | { status: "inactive" }
  | { status: "not_configured" }
  | { status: "error"; message: string };

type PersonState =
  | { status: "idle" }
  | { status: "loading"; staff: AdminStaff }
  | { status: "ready"; staff: AdminStaff; lookup: HcisAccountLookup }
  | { status: "no_account"; staff: AdminStaff };

// HUB-IMPL-023 §2: HCIS answers, said in words an operator can act on.
const errors: Record<string, string> = {
  INVALID_REQUEST: "Periksa kembali isian.",
  STAFF_NOT_FOUND: "Orang ini tidak ditemukan di Akun SQ.",
  ROLE_ADMIN_SELF_FORBIDDEN: "Anda tidak dapat memberi atau mencabut peran untuk diri sendiri. Minta Admin Platform lain.",
  ROLE_ADMIN_ACCOUNT_NOT_FOUND: "Orang ini belum punya akun HCIS.",
  ROLE_ADMIN_ASSIGNMENT_NOT_FOUND: "Penugasan ini sudah tidak ada pada orang tersebut. Muat ulang daftarnya.",
  ROLE_ADMIN_ASSIGNMENT_NOT_REVOCABLE: "Penugasan ini tidak dapat dicabut lewat SQ Hub.",
  ROLE_ADMIN_INVALID_REQUEST: "HCIS menolak isian ini. Periksa peran, cakupan, unit, dan tanggal.",
  ROLE_DELEGATION_FORBIDDEN: "HCIS menolak pemberian ini.",
  ROLE_IDENTITY_PERMISSION_FORBIDDEN: "Peran ini membawa kewenangan identitas dan tidak pernah dapat diberikan dari HCIS.",
  ROLE_GRANT_ACTOR_INVALID: "Akun HCIS Anda tidak aktif sebagai pegawai, jadi HCIS menolak Anda sebagai pemberi peran.",
  ROLE_ADMIN_ACTOR_UNRESOLVED: "HCIS belum mengenali akun Anda. Ini masalah konfigurasi penautan Akun SQ, bukan kesalahan Anda.",
  HCIS_ACCESS_DENIED: "Akses aplikasi HCIS Anda sedang dicabut di SQ Hub.",
  ROLE_ADMIN_REQUEST_REPLAYED: "Permintaan ini sudah pernah dikirim. Tidak ada penugasan ganda yang dibuat.",
  ROLE_ADMIN_ACTOR_ASSERTION_SPENT: "Bukti tindakan sudah terpakai. Kirim ulang untuk mencoba dengan bukti baru.",
  ROLE_ADMIN_ACTOR_EXCHANGE_FAILED: "Akun SQ tidak menerbitkan bukti tindakan Anda. Tidak ada yang dikirim ke HCIS.",
  ROLE_ADMIN_CHANNEL_DISABLED: "Kanal pemberian peran di HCIS belum diaktifkan.",
  ROLE_ADMIN_CHANNEL_NOT_CONFIGURED: "Kanal pemberian peran HCIS belum dipasang di SQ Hub.",
  APPLICATION_ACCESS_UNAVAILABLE: "HCIS tidak dapat memeriksa akses aplikasi ke SQ Hub. Coba lagi beberapa saat.",
  ROLE_ADMIN_CHANNEL_UNAVAILABLE: "HCIS tidak dapat dihubungi. Tidak ada perubahan yang terjadi.",
  ROLE_ADMIN_OUTCOME_UNKNOWN: "HCIS tidak menjawab tepat waktu, jadi hasilnya belum pasti. Kirim ulang formulir yang sama: bila sudah tercatat, HCIS menolaknya sebagai permintaan berulang, tanpa penugasan ganda.",
  ROLE_ADMIN_CHANNEL_ERROR: "HCIS menjawab di luar kontrak. Tidak ada perubahan yang dapat dipastikan; hubungi pengelola teknis.",
  IDENTITY_DIRECTORY_UNAVAILABLE: "Direktori Akun SQ sedang tidak tersedia.",
  ACCOUNT_REAUTH_REQUIRED: "Masuk ulang ke SQ Hub diperlukan sebelum memberi peran.",
};

const scopeLabels: Record<string, string> = { organization: "Seluruh organisasi", unit: "Satu unit", own: "Diri sendiri" };

class RequestError extends Error {
  constructor(public readonly code: string, public readonly detail?: string) {
    super(code);
  }
}

export function HcisRolesPage({ workspace, onLogout, onAuthorizationDenied }: Props) {
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminStaff[]>([]);
  const [person, setPerson] = useState<PersonState>({ status: "idle" });
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState("organization");
  const [unitId, setUnitId] = useState("");
  const [reason, setReason] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  // One requestId per action: kept while the same form is resent, renewed once it changes or succeeds.
  const [grantRequestId, setGrantRequestId] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const adminFetch = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: init?.body ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
    });
    const body = (response.status === 204 ? {} : await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (response.status === 401) {
      window.location.assign("/api/auth/oidc/start");
      throw new RequestError("REDIRECTING");
    }
    if (response.status === 403 && (body.error === "ADMIN_FORBIDDEN" || body.error === "ADMIN_REAUTH_REQUIRED")) {
      onAuthorizationDenied?.(body.error === "ADMIN_REAUTH_REQUIRED" ? "reauth" : "forbidden");
    }
    if (!response.ok) throw new RequestError(body.error ?? `HTTP_${response.status}`, body.message);
    return body;
  }, [onAuthorizationDenied]);

  const loadCatalog = useCallback(async () => {
    setCatalog({ status: "loading" });
    try {
      const body = await adminFetch<{ roles: HcisRoleCatalogEntry[] }>("/api/admin/hcis-roles/catalog");
      setCatalog({ status: "ready", roles: body.roles });
    } catch (error) {
      const code = error instanceof RequestError ? error.code : "";
      if (code === "ROLE_ADMIN_CHANNEL_DISABLED") setCatalog({ status: "inactive" });
      else if (code === "ROLE_ADMIN_CHANNEL_NOT_CONFIGURED") setCatalog({ status: "not_configured" });
      else setCatalog({ status: "error", message: errors[code] ?? "Katalog peran HCIS gagal dimuat." });
    }
  }, [adminFetch]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const roles = catalog.status === "ready" ? catalog.roles : [];
  const role = roles.find((entry) => entry.roleId === roleId) ?? null;
  const changeGrant = (apply: () => void) => { apply(); setGrantRequestId(crypto.randomUUID()); };

  const run = async (task: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await task(); } catch (error) {
      if (error instanceof RequestError) {
        if (error.code === "REDIRECTING") return;
        // HCIS's own refusals arrive with HCIS's fixed explanation; show it even for a code the Hub has no words for.
        setMessage([errors[error.code] ?? (error.detail ? "HCIS menolak:" : "Tindakan gagal dengan aman."), error.detail].filter(Boolean).join(" "));
      } else setMessage("Tindakan gagal dengan aman.");
    } finally { setBusy(false); }
  };

  const loadPerson = async (staff: AdminStaff) => {
    setPerson({ status: "loading", staff });
    try {
      const lookup = await adminFetch<HcisAccountLookup>(`/api/admin/hcis-roles/staff/${encodeURIComponent(staff.subject)}`);
      setPerson({ status: "ready", staff, lookup });
    } catch (error) {
      if (error instanceof RequestError && error.code === "ROLE_ADMIN_ACCOUNT_NOT_FOUND") { setPerson({ status: "no_account", staff }); return; }
      setPerson({ status: "idle" });
      throw error;
    }
  };

  const search = () => run(async () => {
    const body = await adminFetch<{ staff: AdminStaff[] }>(`/api/admin/staff?q=${encodeURIComponent(query.trim())}`);
    setResults(body.staff);
    setPerson({ status: "idle" });
    if (body.staff.length === 0) setMessage("Staff tidak ditemukan di Akun SQ.");
  });

  const grant = () => run(async () => {
    if (person.status !== "ready" || !role) return;
    if (role.mandateRequired && !reason.trim()) { setMessage("Peran ini menuntut mandat. Tulis dasar penugasannya, misalnya nomor SK."); return; }
    if (!window.confirm(`Berikan peran ${role.name} kepada ${person.staff.displayName}?`)) return;
    await adminFetch(`/api/admin/hcis-roles/staff/${encodeURIComponent(person.staff.subject)}/assignments`, {
      method: "POST",
      body: JSON.stringify({
        requestId: grantRequestId,
        roleId: role.roleId,
        scopeType,
        organizationalUnitId: scopeType === "unit" ? unitId.trim() || null : null,
        reason: reason.trim() || null,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
      }),
    });
    setGrantRequestId(crypto.randomUUID());
    await loadPerson(person.staff);
    setMessage(`Peran ${role.name} diberikan kepada ${person.staff.displayName}. HCIS mencatatnya atas nama Anda.`);
  });

  const revoke = (assignment: HcisAccountLookup["assignments"]["items"][number]) => run(async () => {
    if (person.status !== "ready") return;
    if (!window.confirm(`Cabut peran ${assignment.roleName} dari ${person.staff.displayName}?`)) return;
    await adminFetch(`/api/admin/hcis-roles/staff/${encodeURIComponent(person.staff.subject)}/assignments/${encodeURIComponent(assignment.assignmentId)}`, {
      method: "DELETE",
      body: JSON.stringify({ requestId: crypto.randomUUID() }),
    });
    await loadPerson(person.staff);
    setMessage(`Peran ${assignment.roleName} dicabut dari ${person.staff.displayName}.`);
  });

  const account = person.status === "ready" ? person.lookup.account : null;
  const accountWarning = account && !account.grantable
    ? account.notGrantableReason === "employee_inactive"
      ? "HCIS akan menolak pemberian peran: orang ini bukan pegawai aktif."
      : "HCIS akan menolak pemberian peran: akun HCIS orang ini tidak aktif."
    : null;

  return <AppShell workspace={workspace} space="admin" active="admin-hcis-roles" breadcrumb={["Administrasi", "Peran HCIS"]} onLogout={onLogout}>
    <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-brand-heading sm:text-3xl">Peran HCIS</h1>
    <div className="mt-5 rounded-2xl border border-brand-primary/15 bg-brand-primary-pale/50 p-4 text-sm leading-6 text-brand-primary-deep">
      Anda memberi peran memakai akun pegawai Anda sendiri. Daftar peran, aturannya, dan catatan auditnya tetap milik HCIS; SQ Hub hanya menyampaikan perintah.
    </div>
    {message ? <div className="mt-4 rounded-xl border border-border bg-surface-raised p-3 text-sm" role="status">{message}</div> : null}

    {catalog.status === "loading" ? <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Memuat katalog peran dari HCIS...</p> : null}
    {catalog.status === "inactive" ? <Notice title="Belum aktif" body="Kanal pemberian peran di HCIS belum dinyalakan. Ini keadaan yang direncanakan, bukan kerusakan. Sampai dinyalakan, peran HCIS masih diberikan lewat jalur break-glass HCIS." /> : null}
    {catalog.status === "not_configured" ? <Notice title="Belum dipasang" body="SQ Hub belum memegang akun mesin kanal pemberian peran HCIS. Tidak ada permintaan yang dikirim ke HCIS." /> : null}
    {catalog.status === "error" ? <Notice title="Katalog belum dapat dimuat" body={catalog.message} action={{ label: "Coba lagi", onClick: loadCatalog }} /> : null}

    {catalog.status === "ready" ? <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)]">
      <section className="rounded-2xl border border-border bg-surface-raised p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold"><Search className="h-5 w-5" /> Pilih pegawai</h2>
        <div className="mt-4 flex gap-2"><input className={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder="Cari NIP, email, atau nama" /><button className={secondary} disabled={busy || query.trim().length < 2} onClick={() => void search()}><Search className="h-4 w-4" /> Cari</button></div>
        <div className="mt-3 space-y-2">{results.map((entry) => <button key={entry.subject} className={person.status !== "idle" && person.staff.subject === entry.subject ? "w-full rounded-xl border border-brand-primary/40 bg-brand-primary-pale/55 p-3 text-left text-sm" : "w-full rounded-xl border border-border p-3 text-left text-sm"} onClick={() => void run(() => loadPerson(entry))}><strong>{entry.displayName}</strong><span className="block text-xs text-muted-foreground">{entry.username}{entry.email ? ` · ${entry.email}` : ""}</span></button>)}</div>
      </section>

      <section className="rounded-2xl border border-border bg-surface-raised p-5 shadow-sm">
        {person.status === "idle" ? <p className="text-sm text-muted-foreground">Pilih pegawai untuk melihat peran HCIS-nya.</p> : null}
        {person.status === "loading" ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Membaca akun HCIS {person.staff.displayName}...</p> : null}
        {person.status === "no_account" ? <p className="text-sm"><strong>{person.staff.displayName}</strong> belum punya akun HCIS, jadi belum dapat diberi peran.</p> : null}
        {person.status === "ready" ? <>
          <h2 className="font-display text-lg font-bold">{person.staff.displayName}</h2>
          {accountWarning ? <p className="mt-2 rounded-xl bg-warning-soft p-3 text-xs text-warning-ink">{accountWarning}</p> : null}
          <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">Peran saat ini ({person.lookup.assignments.pagination.total})</h3>
          {person.lookup.assignments.items.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Belum ada peran HCIS.</p> : <ul className="mt-2 divide-y divide-border/60 rounded-xl border border-border/70">
            {person.lookup.assignments.items.map((assignment) => <li key={assignment.assignmentId} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span><strong>{assignment.roleName}</strong><span className="block text-xs text-muted-foreground">{scopeLabels[assignment.scopeType] ?? assignment.scopeType}{assignment.organizationalUnitName ? ` · ${assignment.organizationalUnitName}` : ""}{assignment.endsOn ? ` · sampai ${assignment.endsOn}` : ""}</span></span>
              {assignment.revocableViaHub
                ? <button className={secondary} disabled={busy} onClick={() => void revoke(assignment)}><UserMinus className="h-4 w-4" /> Cabut</button>
                : <span className="text-xs text-muted-foreground">Tidak dapat dicabut lewat SQ Hub</span>}
            </li>)}
          </ul>}
          {person.lookup.assignments.pagination.total > person.lookup.assignments.items.length ? <p className="mt-2 text-xs text-muted-foreground">Menampilkan {person.lookup.assignments.items.length} dari {person.lookup.assignments.pagination.total} peran.</p> : null}

          <h3 className="mt-6 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground"><KeyRound className="h-4 w-4" /> Beri peran</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-bold sm:col-span-2">Peran<select className={input} value={roleId} onChange={(e) => changeGrant(() => { setRoleId(e.target.value); const next = roles.find((entry) => entry.roleId === e.target.value); setScopeType(next?.allowedScopes[0] ?? "organization"); })}>
              <option value="">Pilih peran</option>
              {roles.map((entry) => <option key={entry.roleId} value={entry.roleId}>{entry.name}</option>)}
            </select></label>
            {role ? <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">{role.description ?? "HCIS tidak menyertakan keterangan."} {role.permissions.length} izin.{role.mandateRequired ? " Menuntut mandat." : ""}</p> : null}
            <label className="text-xs font-bold">Cakupan<select className={input} value={scopeType} onChange={(e) => changeGrant(() => setScopeType(e.target.value))} disabled={!role}>
              {(role?.allowedScopes ?? ["organization"]).map((scope) => <option key={scope} value={scope}>{scopeLabels[scope] ?? scope}</option>)}
            </select></label>
            {scopeType === "unit" ? <label className="text-xs font-bold">ID unit organisasi<input className={input} value={unitId} onChange={(e) => changeGrant(() => setUnitId(e.target.value))} /></label> : null}
            <label className="text-xs font-bold">Mulai (opsional)<input type="date" className={input} value={startsOn} onChange={(e) => changeGrant(() => setStartsOn(e.target.value))} /></label>
            <label className="text-xs font-bold">Berakhir (opsional)<input type="date" className={input} value={endsOn} onChange={(e) => changeGrant(() => setEndsOn(e.target.value))} /></label>
            <label className="text-xs font-bold sm:col-span-2">Mandat / alasan<textarea className={input} value={reason} onChange={(e) => changeGrant(() => setReason(e.target.value))} placeholder="Contoh: SK Ketua Pengurus No. 12/2026" /></label>
          </div>
          <button className={primary} disabled={busy || !role || !person.lookup.account.grantable} onClick={() => void grant()}><KeyRound className="h-4 w-4" /> Berikan peran</button>
        </> : null}
      </section>
    </div> : null}
  </AppShell>;
}

function Notice({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void | Promise<void> } }) {
  return <section className="mt-6 rounded-2xl border border-border bg-surface-raised p-5 text-sm shadow-sm">
    <h2 className="font-display text-lg font-bold text-brand-heading">{title}</h2>
    <p className="mt-2 leading-6 text-muted-foreground">{body}</p>
    {action ? <button className={`mt-3 ${secondary}`} onClick={() => void action.onClick()}><RefreshCw className="h-4 w-4" /> {action.label}</button> : null}
  </section>;
}

const input = "mt-1.5 w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm outline-none focus:border-brand-primary/50";
const primary = "mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-brand-foreground disabled:opacity-50";
const secondary = "inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs font-bold disabled:opacity-50";
