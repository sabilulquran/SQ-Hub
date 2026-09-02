import {
  AppWindow,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldEllipsis,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AccountMenu } from "@/components/AccountMenu";
import { BrandLockup } from "@/components/BrandLockup";
import type {
  AdminApplication,
  AdminAuditRecord,
  AdminStaff,
  AdminStaffAccess,
  WorkspaceSnapshot,
} from "@/types";

interface AdminCenterPageProps {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  previewApplications?: AdminApplication[];
  onAuthorizationDenied?: (reason: "forbidden" | "reauth") => void;
}

type AdminState =
  | { status: "loading" }
  | { status: "ready"; applications: AdminApplication[] }
  | { status: "forbidden" }
  | { status: "reauth" }
  | { status: "error" };

type Section = "applications" | "access" | "audit";

const emptyApplication = {
  key: "",
  name: "",
  canonicalUrl: "",
  status: "active" as const,
};

export function AdminCenterPage({
  workspace,
  onLogout,
  previewApplications,
  onAuthorizationDenied,
}: AdminCenterPageProps) {
  const [state, setState] = useState<AdminState>(() =>
    previewApplications
      ? { status: "ready", applications: previewApplications }
      : { status: "loading" },
  );
  const [section, setSection] = useState<Section>("applications");
  const [applicationForm, setApplicationForm] = useState(emptyApplication);
  const [applicationSaving, setApplicationSaving] = useState(false);
  const [applicationMessage, setApplicationMessage] = useState<string | null>(null);
  const [staffQuery, setStaffQuery] = useState("");
  const [staffSearching, setStaffSearching] = useState(false);
  const [staffResults, setStaffResults] = useState<AdminStaff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<AdminStaff | null>(null);
  const [staffAccess, setStaffAccess] = useState<AdminStaffAccess[]>([]);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessReason, setAccessReason] = useState("");
  const [accessMessage, setAccessMessage] = useState<string | null>(null);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const [audit, setAudit] = useState<AdminAuditRecord[]>([]);

  const applications = state.status === "ready" ? state.applications : [];
  const editingExisting = useMemo(
    () => applications.some((application) => application.key === applicationForm.key),
    [applications, applicationForm.key],
  );

  const handleDenied = useCallback(
    (reason: "forbidden" | "reauth") => {
      onAuthorizationDenied?.(reason);
      setState({ status: reason });
    },
    [onAuthorizationDenied],
  );

  const adminFetch = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(url, {
        credentials: "same-origin",
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(init?.headers ?? {}),
        },
      });
      if (response.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        throw new Error("redirecting to login");
      }
      if (response.status === 403) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        const reason = body.error === "ADMIN_REAUTH_REQUIRED" ? "reauth" : "forbidden";
        handleDenied(reason);
        throw new Error(reason);
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `request failed (${response.status})`);
      }
      return (await response.json()) as T;
    },
    [handleDenied],
  );

  const loadAdmin = useCallback(async () => {
    if (previewApplications) {
      setState({ status: "ready", applications: previewApplications });
      return;
    }

    setState({ status: "loading" });
    try {
      await adminFetch("/api/admin/context");
      const body = await adminFetch<{ applications: AdminApplication[] }>("/api/admin/applications");
      setState({ status: "ready", applications: body.applications });
    } catch (error) {
      if (state.status !== "forbidden" && state.status !== "reauth" && !(error instanceof Error && ["forbidden", "reauth", "redirecting to login"].includes(error.message))) {
        setState({ status: "error" });
      }
    }
  }, [adminFetch, previewApplications, state.status]);

  useEffect(() => {
    if (previewApplications) return;
    void loadAdmin();
    // loadAdmin intentionally owns the complete initial authorization/data request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewApplications]);

  const saveApplication = async () => {
    const key = applicationForm.key.trim();
    if (!key || !applicationForm.name.trim() || !applicationForm.canonicalUrl.trim()) {
      setApplicationMessage("Kunci aplikasi, nama, dan URL wajib diisi.");
      return;
    }
    setApplicationSaving(true);
    setApplicationMessage(null);
    try {
      const body = await adminFetch<{ application: AdminApplication }>(
        `/api/admin/applications/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            name: applicationForm.name,
            canonicalUrl: applicationForm.canonicalUrl,
            status: applicationForm.status,
          }),
        },
      );
      setState((current) => {
        if (current.status !== "ready") return current;
        const exists = current.applications.some((application) => application.key === body.application.key);
        return {
          status: "ready",
          applications: exists
            ? current.applications.map((application) =>
                application.key === body.application.key ? body.application : application,
              )
            : [...current.applications, body.application].sort((a, b) => a.name.localeCompare(b.name)),
        };
      });
      setApplicationForm({ ...body.application });
      setApplicationMessage("Application Registry berhasil diperbarui.");
    } catch (error) {
      setApplicationMessage(error instanceof Error ? error.message : "Aplikasi gagal disimpan.");
    } finally {
      setApplicationSaving(false);
    }
  };

  const searchStaff = async () => {
    const query = staffQuery.trim();
    if (query.length < 2) {
      setAccessMessage("Masukkan minimal 2 karakter untuk mencari Staff.");
      return;
    }
    setStaffSearching(true);
    setAccessMessage(null);
    setSelectedStaff(null);
    setStaffAccess([]);
    try {
      const body = await adminFetch<{ staff: AdminStaff[] }>(
        `/api/admin/staff?q=${encodeURIComponent(query)}`,
      );
      setStaffResults(body.staff);
      if (body.staff.length === 0) setAccessMessage("Staff tidak ditemukan.");
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Pencarian Staff gagal.");
    } finally {
      setStaffSearching(false);
    }
  };

  const selectStaff = async (staff: AdminStaff) => {
    setSelectedStaff(staff);
    setAccessLoading(true);
    setAccessMessage(null);
    try {
      const body = await adminFetch<{ staff: AdminStaff; access: AdminStaffAccess[] }>(
        `/api/admin/staff/${encodeURIComponent(staff.subject)}/access`,
      );
      setSelectedStaff(body.staff);
      setStaffAccess(body.access);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Status akses gagal dimuat.");
    } finally {
      setAccessLoading(false);
    }
  };

  const mutateAccess = async (applicationKey: string, action: "grant" | "revoke") => {
    if (!selectedStaff || !accessReason.trim()) {
      setAccessMessage("Alasan perubahan akses wajib diisi.");
      return;
    }
    if (action === "revoke" && !window.confirm(`Cabut akses ${selectedStaff.displayName} ke ${applicationKey}?`)) {
      return;
    }
    setAccessLoading(true);
    setAccessMessage(null);
    try {
      await adminFetch(`/api/admin/application-access/${action}`, {
        method: "POST",
        body: JSON.stringify({
          subject: selectedStaff.subject,
          applicationKey,
          reason: accessReason,
        }),
      });
      setAccessReason("");
      setAccessMessage(action === "grant" ? "Akses aplikasi diberikan." : "Akses aplikasi dicabut.");
      await selectStaff(selectedStaff);
    } catch (error) {
      setAccessMessage(error instanceof Error ? error.message : "Perubahan akses gagal.");
      setAccessLoading(false);
    }
  };

  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const body = await adminFetch<{ audit: AdminAuditRecord[] }>(
        `/api/admin/audit?q=${encodeURIComponent(auditQuery.trim())}&limit=100`,
      );
      setAudit(body.audit);
    } catch {
      setAudit([]);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (section === "audit" && state.status === "ready" && !previewApplications) void loadAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-border/65 bg-sidebar/95 px-5 py-6 backdrop-blur-xl lg:flex lg:flex-col">
        <BrandLockup />

        <nav className="mt-9 space-y-1.5" aria-label="Navigasi Administrasi SQ">
          <a
            href="/"
            className="flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
            Kembali ke SQ Hub
          </a>
          <div
            className="flex items-center gap-3 rounded-2xl bg-brand-primary-pale px-3.5 py-3 text-sm font-bold text-brand-primary-deep ring-1 ring-brand-primary/10"
            aria-current="page"
          >
            <ShieldEllipsis className="h-[18px] w-[18px]" aria-hidden="true" />
            Administrasi SQ
          </div>
        </nav>

        <div className="mt-auto pt-6">
          <div className="mb-3 rounded-2xl bg-brand-primary-pale/65 px-3.5 py-3 text-[11px] leading-5 text-brand-primary-deep">
            <span className="flex items-center gap-2 font-bold">
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              Area terbatas
            </span>
            <span className="mt-1 block text-brand-primary-deep/75">
              Akses aplikasi hanya membuka pintu aplikasi. Hak bisnis tetap dikelola aplikasi domain.
            </span>
          </div>
          <AccountMenu user={workspace.user} variant="sidebar" onLogout={onLogout} />
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-border/55 bg-background/88 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="lg:hidden"><BrandLockup compact /></div>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Platform</p>
              <h1 className="truncate font-display text-xl font-bold tracking-[-0.02em] text-brand-heading">Administrasi SQ</h1>
            </div>
            <AccountMenu user={workspace.user} variant="header" onLogout={onLogout} />
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
          <div className="mb-6 lg:hidden">
            <a href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-primary-deep">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> SQ Hub
            </a>
          </div>

          <section className="rounded-[2rem] border border-brand-primary/15 bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-3xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-primary-deep">SQ Admin Center · Go 5B</p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.03em] text-brand-heading sm:text-4xl">Administrasi SQ</h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  Kelola registry dan pintu masuk aplikasi lintas platform. Hak payroll, kepegawaian, keuangan, penerimaan, dan kewenangan bisnis tetap berada di aplikasi masing-masing.
                </p>
              </div>
              <span className="inline-flex self-start items-center gap-2 rounded-2xl bg-brand-primary-pale px-3.5 py-2.5 text-xs font-bold text-brand-primary-deep">
                <ShieldEllipsis className="h-4 w-4" aria-hidden="true" /> Platform Administrator
              </span>
            </div>
          </section>

          {state.status === "loading" ? <LoadingCard label="Memeriksa kewenangan administrasi..." /> : null}
          {state.status === "forbidden" ? <AdminMessage title="Administrasi SQ tidak tersedia" body="Sesi Anda tidak memiliki kewenangan Platform Administrator untuk membuka area ini." /> : null}
          {state.status === "reauth" ? <AdminMessage title="Masuk ulang diperlukan" body="Kewenangan administrator diberikan setelah sesi ini dibuat. Keluar lalu masuk kembali melalui SQ Identity." action={onLogout ? { label: "Keluar dan masuk kembali", onClick: onLogout } : undefined} /> : null}
          {state.status === "error" ? <AdminMessage title="Administrasi SQ belum dapat dimuat" body="Verifikasi kewenangan platform sedang tidak tersedia. Tidak ada data administrasi yang ditampilkan." action={{ label: "Coba lagi", onClick: loadAdmin }} /> : null}

          {state.status === "ready" ? (
            <>
              <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Bagian Administrasi SQ">
                <SectionButton active={section === "applications"} onClick={() => setSection("applications")} icon={AppWindow}>Aplikasi</SectionButton>
                <SectionButton active={section === "access"} onClick={() => setSection("access")} icon={KeyRound}>Akses Aplikasi</SectionButton>
                <SectionButton active={section === "audit"} onClick={() => setSection("audit")} icon={ShieldCheck}>Audit Platform</SectionButton>
              </div>

              {section === "applications" ? (
                <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
                  <div>
                    <SectionHeading eyebrow="Application Registry" title="Aplikasi platform" description="Kunci aplikasi stabil dan tidak dapat diganti setelah dibuat. Status nonaktif menutup akses baru tanpa memindahkan hak domain ke SQ Hub." />
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {applications.map((application) => (
                        <button key={application.key} type="button" onClick={() => setApplicationForm({ ...application })} className="rounded-3xl border border-border/70 bg-white p-5 text-left shadow-[var(--shadow-soft)] transition hover:-translate-y-0.5 hover:border-brand-primary/35">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0"><h3 className="truncate font-display text-lg font-bold text-brand-heading">{application.name}</h3><p className="mt-1 font-mono text-[11px] text-muted-foreground">{application.key}</p></div>
                            <StatusPill active={application.status === "active"} activeLabel="Aktif" inactiveLabel="Nonaktif" />
                          </div>
                          <p className="mt-4 break-all text-xs leading-5 text-muted-foreground">{application.canonicalUrl}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-border/70 bg-white p-5 shadow-[var(--shadow-soft)]">
                    <div className="flex items-center justify-between gap-3"><h3 className="font-display text-xl font-bold text-brand-heading">{editingExisting ? "Ubah aplikasi" : "Daftarkan aplikasi"}</h3><button type="button" onClick={() => { setApplicationForm(emptyApplication); setApplicationMessage(null); }} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-brand-primary-deep"><Plus className="h-3.5 w-3.5" /> Baru</button></div>
                    <div className="mt-5 space-y-4">
                      <Field label="Kunci aplikasi"><input value={applicationForm.key} disabled={editingExisting} onChange={(event) => setApplicationForm((current) => ({ ...current, key: event.target.value }))} placeholder="contoh: spmb" className="sq-admin-input" /></Field>
                      <Field label="Nama"><input value={applicationForm.name} onChange={(event) => setApplicationForm((current) => ({ ...current, name: event.target.value }))} placeholder="Nama aplikasi" className="sq-admin-input" /></Field>
                      <Field label="URL kanonis"><input value={applicationForm.canonicalUrl} onChange={(event) => setApplicationForm((current) => ({ ...current, canonicalUrl: event.target.value }))} placeholder="https://..." className="sq-admin-input" /></Field>
                      <Field label="Status"><select value={applicationForm.status} onChange={(event) => setApplicationForm((current) => ({ ...current, status: event.target.value as "active" | "inactive" }))} className="sq-admin-input"><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></Field>
                    </div>
                    {applicationMessage ? <InlineMessage>{applicationMessage}</InlineMessage> : null}
                    <button type="button" disabled={applicationSaving || Boolean(previewApplications)} onClick={() => void saveApplication()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-primary px-4 py-3 text-sm font-bold text-white shadow-[var(--shadow-button)] disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-4 w-4" /> {applicationSaving ? "Menyimpan..." : "Simpan registry"}</button>
                  </div>
                </section>
              ) : null}

              {section === "access" ? (
                <section className="mt-6">
                  <SectionHeading eyebrow="Application Access" title="Akses aplikasi Staff" description="Cari Staff, periksa kesiapan MFA, lalu berikan atau cabut pintu masuk aplikasi. Ini tidak mengubah role atau permission di aplikasi domain." />
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row"><input value={staffQuery} onChange={(event) => setStaffQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchStaff(); }} placeholder="Cari NIP, email, atau nama Staff" className="sq-admin-input flex-1" /><button type="button" disabled={staffSearching || Boolean(previewApplications)} onClick={() => void searchStaff()} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-primary px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{staffSearching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Cari Staff</button></div>
                  {accessMessage ? <InlineMessage>{accessMessage}</InlineMessage> : null}

                  <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(17rem,0.7fr)_minmax(0,1.3fr)]">
                    <div className="space-y-3">
                      {staffResults.map((staff) => <StaffResult key={staff.subject} staff={staff} selected={selectedStaff?.subject === staff.subject} onClick={() => void selectStaff(staff)} />)}
                    </div>
                    <div className="rounded-3xl border border-border/70 bg-white p-5 shadow-[var(--shadow-soft)]">
                      {!selectedStaff ? <EmptyState icon={UserRound} title="Pilih Staff" body="Hasil pencarian akan menampilkan identitas manusia tanpa menampilkan subject OIDC mentah." /> : (
                        <>
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-display text-xl font-bold text-brand-heading">{selectedStaff.displayName}</p><p className="mt-1 text-xs text-muted-foreground">{selectedStaff.username}{selectedStaff.email ? ` · ${selectedStaff.email}` : ""}</p></div><div className="flex flex-wrap gap-2"><SecurityPill ok={selectedStaff.security.totpConfigured} label="TOTP" /><SecurityPill ok={selectedStaff.security.recoveryCodesConfigured} label="Kode pemulihan" /></div></div>
                          <div className="mt-5"><Field label="Alasan perubahan akses"><input value={accessReason} onChange={(event) => setAccessReason(event.target.value)} placeholder="Wajib untuk grant/revoke" className="sq-admin-input" /></Field></div>
                          {accessLoading ? <div className="mt-5"><LoadingCard label="Memuat status akses..." compact /></div> : (
                            <div className="mt-5 space-y-3">{staffAccess.map((item) => <div key={item.application.key} className="flex flex-col gap-4 rounded-2xl border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><p className="font-bold text-brand-heading">{item.application.name}</p><StatusPill active={item.status === "active"} activeLabel="Akses aktif" inactiveLabel={item.status === "revoked" ? "Dicabut" : "Belum diberi"} /></div><p className="mt-1 text-xs text-muted-foreground">{item.reason ?? "Belum ada alasan perubahan akses."}</p></div><div className="flex gap-2"><button type="button" disabled={item.status === "active" || !accessReason.trim()} onClick={() => void mutateAccess(item.application.key, "grant")} className="rounded-xl bg-brand-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Berikan akses</button><button type="button" disabled={item.status !== "active" || !accessReason.trim()} onClick={() => void mutateAccess(item.application.key, "revoke")} className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs font-bold text-destructive disabled:opacity-40">Cabut</button></div></div>)}</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}

              {section === "audit" ? (
                <section className="mt-6">
                  <SectionHeading eyebrow="Platform Audit" title="Jejak administrasi" description="Cari perubahan registry, Application Access, dan administrasi platform. Subject OIDC mentah dan material credential tidak ditampilkan." />
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row"><input value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadAudit(); }} placeholder="Cari action, aplikasi, alasan, outcome..." className="sq-admin-input flex-1" /><button type="button" disabled={auditLoading || Boolean(previewApplications)} onClick={() => void loadAudit()} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border bg-white px-5 py-3 text-sm font-bold text-brand-primary-deep">{auditLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Cari audit</button></div>
                  <div className="mt-5 overflow-hidden rounded-3xl border border-border/70 bg-white shadow-[var(--shadow-soft)]"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-muted/45 text-xs text-muted-foreground"><tr><th className="px-4 py-3">Waktu</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3">Keterangan</th></tr></thead><tbody className="divide-y divide-border/60">{audit.map((record) => <tr key={record.id}><td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatDate(record.occurredAt)}</td><td className="px-4 py-3 font-mono text-xs">{record.action}</td><td className="px-4 py-3 text-xs">{record.targetType}</td><td className="px-4 py-3"><StatusPill active={record.outcome === "succeeded"} activeLabel="Berhasil" inactiveLabel={record.outcome} /></td><td className="max-w-sm px-4 py-3 text-xs text-muted-foreground">{auditDescription(record)}</td></tr>)}</tbody></table></div>{audit.length === 0 && !auditLoading ? <div className="p-7"><EmptyState icon={ShieldCheck} title="Belum ada hasil" body="Gunakan pencarian untuk memfilter jejak administrasi terbaru." /></div> : null}</div>
                </section>
              ) : null}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function SectionButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof AppWindow; children: string }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={active ? "inline-flex items-center gap-2 rounded-2xl bg-brand-primary-pale px-4 py-2.5 text-sm font-bold text-brand-primary-deep ring-1 ring-brand-primary/10" : "inline-flex items-center gap-2 rounded-2xl border border-border/70 bg-white px-4 py-2.5 text-sm font-semibold text-muted-foreground"}><Icon className="h-4 w-4" />{children}</button>;
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-primary-deep">{eyebrow}</p><h2 className="mt-1 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading sm:text-3xl">{title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p></div>;
}

function StaffResult({ staff, selected, onClick }: { staff: AdminStaff; selected: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={selected ? "w-full rounded-2xl border border-brand-primary/40 bg-brand-primary-pale/55 p-4 text-left" : "w-full rounded-2xl border border-border/70 bg-white p-4 text-left shadow-[var(--shadow-soft)]"}><div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-primary-pale text-brand-primary-deep"><UserRound className="h-5 w-5" /></div><div className="min-w-0"><p className="truncate font-bold text-brand-heading">{staff.displayName}</p><p className="mt-1 truncate text-xs text-muted-foreground">{staff.username}{staff.email ? ` · ${staff.email}` : ""}</p><div className="mt-2 flex gap-1.5"><SecurityPill ok={staff.security.totpConfigured} label="TOTP" /><SecurityPill ok={staff.security.recoveryCodesConfigured} label="Recovery" /></div></div></div></button>;
}

function SecurityPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? "inline-flex items-center gap-1 rounded-full bg-brand-primary-pale px-2 py-1 text-[10px] font-bold text-brand-primary-deep" : "inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700"}>{ok ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}{label}</span>;
}

function StatusPill({ active, activeLabel, inactiveLabel }: { active: boolean; activeLabel: string; inactiveLabel: string }) {
  return <span className={active ? "inline-flex rounded-full bg-brand-primary-pale px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-primary-deep" : "inline-flex rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"}>{active ? activeLabel : inactiveLabel}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold text-brand-heading">{label}</span>{children}</label>;
}

function InlineMessage({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 rounded-2xl bg-muted/55 px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">{children}</p>;
}

function LoadingCard({ label, compact = false }: { label: string; compact?: boolean }) {
  return <section className={compact ? "rounded-2xl border border-border/70 bg-white p-5 text-center" : "mt-6 rounded-3xl border border-border/70 bg-white p-8 text-center shadow-[var(--shadow-soft)]"}><RefreshCw className="mx-auto h-5 w-5 animate-spin text-brand-primary-deep" aria-hidden="true" /><p className="mt-3 text-sm font-semibold text-muted-foreground">{label}</p></section>;
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof AppWindow; title: string; body: string }) {
  return <div className="py-6 text-center"><Icon className="mx-auto h-6 w-6 text-brand-primary-deep" /><p className="mt-3 font-bold text-brand-heading">{title}</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">{body}</p></div>;
}

function auditDescription(record: AdminAuditRecord) {
  const applicationKey = typeof record.payload.applicationKey === "string" ? record.payload.applicationKey : null;
  const reason = typeof record.payload.reason === "string" ? record.payload.reason : null;
  return [applicationKey, reason].filter(Boolean).join(" · ") || "Tidak ada payload sensitif yang ditampilkan.";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function AdminMessage({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void | Promise<void> } }) {
  return <section className="mt-6 rounded-3xl border border-border/70 bg-white p-7 text-center shadow-[var(--shadow-soft)] sm:p-9"><ShieldEllipsis className="mx-auto h-6 w-6 text-brand-primary-deep" aria-hidden="true" /><h2 className="mt-4 font-display text-2xl font-bold text-brand-heading">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{body}</p>{action ? <button type="button" onClick={() => void action.onClick()} className="mt-5 rounded-2xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)]">{action.label}</button> : <a href="/" className="mt-5 inline-flex rounded-2xl border border-border px-4 py-2.5 text-sm font-bold text-brand-primary-deep">Kembali ke SQ Hub</a>}</section>;
}
