import {
  AppWindow,
  ArrowLeft,
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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

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

const emptyApplication: AdminApplication = {
  key: "",
  name: "",
  canonicalUrl: "",
  status: "active",
};

const knownErrors: Record<string, string> = {
  INVALID_REQUEST: "Periksa kembali data yang diisi. Pastikan format setiap kolom sudah benar.",
  UNKNOWN_APPLICATION: "Aplikasi tidak ditemukan pada registry.",
  IDENTITY_DIRECTORY_UNAVAILABLE: "Direktori Staff sedang tidak tersedia. Coba lagi beberapa saat.",
  ADMIN_VERIFICATION_UNAVAILABLE: "Verifikasi administrasi sedang tidak tersedia. Coba lagi beberapa saat.",
};

function readableError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  return knownErrors[error.message] ?? fallback;
}

function validUrl(value: string) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.hostname);
  } catch {
    return false;
  }
}

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
  const [applicationForm, setApplicationForm] = useState<AdminApplication>(emptyApplication);
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
      if (
        !(error instanceof Error) ||
        !["forbidden", "reauth", "redirecting to login"].includes(error.message)
      ) {
        setState({ status: "error" });
      }
    }
  }, [adminFetch, previewApplications]);

  useEffect(() => {
    if (!previewApplications) void loadAdmin();
  }, [loadAdmin, previewApplications]);

  const saveApplication = async () => {
    const key = applicationForm.key.trim();
    const name = applicationForm.name.trim();
    const canonicalUrl = applicationForm.canonicalUrl.trim();
    if (!key || !name || !canonicalUrl) {
      setApplicationMessage("Kunci aplikasi, nama, dan URL kanonis wajib diisi.");
      return;
    }
    if (!validUrl(canonicalUrl)) {
      setApplicationMessage("URL kanonis harus berupa URL lengkap, misalnya https://app.sabilulquran.or.id.");
      return;
    }
    setApplicationSaving(true);
    setApplicationMessage(null);
    try {
      const body = await adminFetch<{ application: AdminApplication }>(
        `/api/admin/applications/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          body: JSON.stringify({ name, canonicalUrl, status: applicationForm.status }),
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
      setApplicationMessage("Registry aplikasi berhasil diperbarui.");
    } catch (error) {
      setApplicationMessage(readableError(error, "Aplikasi gagal disimpan. Periksa data lalu coba lagi."));
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
      if (body.staff.length === 0) setAccessMessage("Staff tidak ditemukan pada Akun SQ staging.");
    } catch (error) {
      setAccessMessage(readableError(error, "Pencarian Staff gagal. Coba lagi beberapa saat."));
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
      setAccessMessage(readableError(error, "Status akses Staff gagal dimuat."));
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
          reason: accessReason.trim(),
        }),
      });
      setAccessReason("");
      setAccessMessage(action === "grant" ? "Akses aplikasi diberikan." : "Akses aplikasi dicabut.");
      await selectStaff(selectedStaff);
    } catch (error) {
      setAccessMessage(readableError(error, "Perubahan akses gagal. Coba lagi."));
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
    // loadAudit intentionally follows the selected audit section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  return (
    <div className="min-h-screen bg-background">
      <GlobalHeader workspace={workspace} onLogout={onLogout} />

      <main className="mx-auto max-w-7xl px-4 pb-32 pt-7 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-brand-primary-deep">Administrasi platform</p>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Kelola registry, pintu masuk aplikasi, dan jejak administrasi tanpa mengambil alih kewenangan bisnis aplikasi domain.</p>
            </div>
            <span className="inline-flex self-start items-center gap-2 rounded-full bg-brand-primary-pale px-3 py-1.5 text-xs font-bold text-brand-primary-deep"><ShieldEllipsis className="h-4 w-4" /> Platform Administrator</span>
          </div>

          {state.status === "loading" ? <LoadingCard label="Memeriksa kewenangan administrasi..." /> : null}
          {state.status === "forbidden" ? <AdminMessage title="Administrasi SQ tidak tersedia" body="Sesi Anda tidak memiliki kewenangan Platform Administrator untuk membuka area ini." /> : null}
          {state.status === "reauth" ? <AdminMessage title="Masuk ulang diperlukan" body="Kewenangan administrator diberikan setelah sesi ini dibuat. Keluar lalu masuk kembali melalui Akun SQ." action={onLogout ? { label: "Keluar dan masuk kembali", onClick: onLogout } : undefined} /> : null}
          {state.status === "error" ? <AdminMessage title="Administrasi SQ belum dapat dimuat" body="Verifikasi kewenangan platform sedang tidak tersedia. Tidak ada data administrasi yang ditampilkan." action={{ label: "Coba lagi", onClick: loadAdmin }} /> : null}

          {state.status === "ready" ? (
            <>
              <div className="flex flex-wrap gap-2 border-b border-border/70 pb-3" role="tablist" aria-label="Bagian Administrasi SQ">
                <SectionButton active={section === "applications"} onClick={() => setSection("applications")} icon={AppWindow}>Aplikasi</SectionButton>
                <SectionButton active={section === "access"} onClick={() => setSection("access")} icon={KeyRound}>Akses Aplikasi</SectionButton>
                <SectionButton active={section === "audit"} onClick={() => setSection("audit")} icon={ShieldCheck}>Audit Platform</SectionButton>
              </div>

              {section === "applications" ? (
                <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.75fr)]">
                  <div>
                    <SectionHeading eyebrow="Application Registry" title="Aplikasi platform" description="Pilih aplikasi untuk mengubah metadata. Kunci aplikasi tetap stabil setelah dibuat." />
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {applications.map((application) => (
                        <button key={application.key} type="button" onClick={() => { setApplicationForm({ ...application }); setApplicationMessage(null); }} className="rounded-2xl border border-border/70 bg-white p-4 text-left shadow-[var(--shadow-soft)] transition hover:border-brand-primary/35">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0"><h3 className="truncate font-display text-base font-bold text-brand-heading">{application.name}</h3><p className="mt-1 font-mono text-[10px] text-muted-foreground">{application.key}</p></div>
                            <StatusPill active={application.status === "active"} activeLabel="Aktif" inactiveLabel="Nonaktif" />
                          </div>
                          <p className="mt-3 truncate text-xs text-muted-foreground">{application.canonicalUrl}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-white p-4 shadow-[var(--shadow-soft)]">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-display text-lg font-bold text-brand-heading">{editingExisting ? "Ubah aplikasi" : "Daftarkan aplikasi"}</h3>
                      <button type="button" onClick={() => { setApplicationForm(emptyApplication); setApplicationMessage(null); }} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-brand-primary-deep"><Plus className="h-3.5 w-3.5" /> Baru</button>
                    </div>
                    <div className="mt-4 space-y-3.5">
                      <Field label="Kunci aplikasi" helper={editingExisting ? "Kunci tidak dapat diubah setelah aplikasi dibuat." : "Gunakan kunci pendek dan stabil, misalnya spmb."}>
                        <input value={applicationForm.key} disabled={editingExisting} onChange={(event) => setApplicationForm((current) => ({ ...current, key: event.target.value }))} placeholder="contoh: spmb" className="sq-admin-input" />
                      </Field>
                      <Field label="Nama"><input value={applicationForm.name} onChange={(event) => setApplicationForm((current) => ({ ...current, name: event.target.value }))} placeholder="Nama aplikasi" className="sq-admin-input" /></Field>
                      <Field label="URL kanonis" helper="Gunakan URL lengkap, termasuk https://"><input value={applicationForm.canonicalUrl} onChange={(event) => setApplicationForm((current) => ({ ...current, canonicalUrl: event.target.value }))} placeholder="https://app.sabilulquran.or.id" className="sq-admin-input" inputMode="url" /></Field>
                      <Field label="Status"><select value={applicationForm.status} onChange={(event) => setApplicationForm((current) => ({ ...current, status: event.target.value as "active" | "inactive" }))} className="sq-admin-input"><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></Field>
                    </div>
                    {applicationMessage ? <InlineMessage>{applicationMessage}</InlineMessage> : null}
                    <button type="button" disabled={applicationSaving || Boolean(previewApplications)} onClick={() => void saveApplication()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)] disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-4 w-4" />{applicationSaving ? "Menyimpan..." : "Simpan registry"}</button>
                  </div>
                </section>
              ) : null}

              {section === "access" ? (
                <section className="mt-5">
                  <SectionHeading eyebrow="Application Access" title="Akses aplikasi Staff" description="Cari identitas di Akun SQ staging, lalu berikan atau cabut pintu masuk aplikasi. Role dan permission domain tidak berubah." />
                  <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                    <input value={staffQuery} onChange={(event) => setStaffQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchStaff(); }} placeholder="Cari NIP, email, atau nama Staff" className="sq-admin-input flex-1" />
                    <button type="button" disabled={staffSearching || Boolean(previewApplications)} onClick={() => void searchStaff()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{staffSearching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Cari Staff</button>
                  </div>
                  {accessMessage ? <InlineMessage>{accessMessage}</InlineMessage> : null}

                  <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(16rem,0.65fr)_minmax(0,1.35fr)]">
                    <div className="space-y-2.5">{staffResults.map((staff) => <StaffResult key={staff.subject} staff={staff} selected={selectedStaff?.subject === staff.subject} onClick={() => void selectStaff(staff)} />)}</div>
                    <div className="rounded-2xl border border-border/70 bg-white p-4 shadow-[var(--shadow-soft)]">
                      {!selectedStaff ? <EmptyState icon={UserRound} title="Pilih Staff" body="Hasil pencarian menampilkan identitas manusia tanpa menampilkan subject OIDC mentah." /> : (
                        <>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div><p className="font-display text-lg font-bold text-brand-heading">{selectedStaff.displayName}</p><p className="mt-1 text-xs text-muted-foreground">{selectedStaff.username}{selectedStaff.email ? ` · ${selectedStaff.email}` : ""}</p></div>
                            <div className="flex flex-wrap gap-1.5"><SecurityPill ok={selectedStaff.security.totpConfigured} label="TOTP" /><SecurityPill ok={selectedStaff.security.recoveryCodesConfigured} label="Kode pemulihan" /></div>
                          </div>
                          <div className="mt-4"><Field label="Alasan perubahan akses" helper="Wajib diisi untuk setiap grant atau revoke."><input value={accessReason} onChange={(event) => setAccessReason(event.target.value)} placeholder="Contoh: penugasan operasional" className="sq-admin-input" /></Field></div>
                          {accessLoading ? <div className="mt-4"><LoadingCard label="Memuat status akses..." compact /></div> : (
                            <div className="mt-4 divide-y divide-border/60 rounded-xl border border-border/70">
                              {staffAccess.map((item) => (
                                <div key={item.application.key} className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-brand-heading">{item.application.name}</p><StatusPill active={item.status === "active"} activeLabel="Akses aktif" inactiveLabel={item.status === "revoked" ? "Dicabut" : "Belum diberi"} /></div><p className="mt-1 max-w-2xl text-xs text-muted-foreground">{item.reason ?? "Belum ada alasan perubahan akses."}</p></div>
                                  <div className="flex shrink-0 gap-2"><button type="button" disabled={item.status === "active" || !accessReason.trim()} onClick={() => void mutateAccess(item.application.key, "grant")} className="rounded-xl bg-brand-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Berikan</button><button type="button" disabled={item.status !== "active" || !accessReason.trim()} onClick={() => void mutateAccess(item.application.key, "revoke")} className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs font-bold text-destructive disabled:opacity-40">Cabut</button></div>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}

              {section === "audit" ? (
                <section className="mt-5">
                  <SectionHeading eyebrow="Platform Audit" title="Jejak administrasi" description="Perubahan registry, Application Access, dan administrasi platform ditampilkan tanpa subject OIDC mentah atau material credential." />
                  <div className="mt-4 flex flex-col gap-2.5 sm:flex-row"><input value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadAudit(); }} placeholder="Cari action, aplikasi, alasan, outcome..." className="sq-admin-input flex-1" /><button type="button" disabled={auditLoading || Boolean(previewApplications)} onClick={() => void loadAudit()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-bold text-brand-primary-deep">{auditLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Cari audit</button></div>
                  <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-white shadow-[var(--shadow-soft)]">
                    <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/45 text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3.5 py-2.5">Waktu</th><th className="px-3.5 py-2.5">Action</th><th className="px-3.5 py-2.5">Target</th><th className="px-3.5 py-2.5">Outcome</th><th className="px-3.5 py-2.5">Keterangan</th></tr></thead><tbody className="divide-y divide-border/60">{audit.map((record) => <tr key={record.id}><td className="whitespace-nowrap px-3.5 py-2.5 text-xs text-muted-foreground">{formatDate(record.occurredAt)}</td><td className="px-3.5 py-2.5 font-mono text-xs">{record.action}</td><td className="px-3.5 py-2.5 text-xs">{record.targetType}</td><td className="px-3.5 py-2.5"><StatusPill active={record.outcome === "succeeded"} activeLabel="Berhasil" inactiveLabel={record.outcome} /></td><td className="max-w-sm px-3.5 py-2.5 text-xs text-muted-foreground">{auditDescription(record)}</td></tr>)}</tbody></table></div>
                    {audit.length === 0 && !auditLoading ? <div className="p-6"><EmptyState icon={ShieldCheck} title="Belum ada hasil" body="Jejak administrasi terbaru akan muncul di sini." /></div> : null}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
      </main>
      <MobileNavigation
        active="admin"
        platformAdministration={workspace.capabilities.platformAdministration}
      />
    </div>
  );
}

function SectionButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof AppWindow; children: string }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={active ? "inline-flex items-center gap-2 rounded-xl bg-brand-primary-pale px-3.5 py-2 text-sm font-bold text-brand-primary-deep ring-1 ring-brand-primary/10" : "inline-flex items-center gap-2 rounded-xl border border-border/70 bg-white px-3.5 py-2 text-sm font-semibold text-muted-foreground"}><Icon className="h-4 w-4" />{children}</button>;
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-brand-primary-deep">{eyebrow}</p><h2 className="mt-1 font-display text-xl font-bold tracking-[-0.02em] text-brand-heading sm:text-2xl">{title}</h2><p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p></div>;
}

function StaffResult({ staff, selected, onClick }: { staff: AdminStaff; selected: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={selected ? "w-full rounded-xl border border-brand-primary/40 bg-brand-primary-pale/55 p-3.5 text-left" : "w-full rounded-xl border border-border/70 bg-white p-3.5 text-left shadow-[var(--shadow-soft)]"}><div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep"><UserRound className="h-4.5 w-4.5" /></div><div className="min-w-0"><p className="truncate font-bold text-brand-heading">{staff.displayName}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{staff.username}{staff.email ? ` · ${staff.email}` : ""}</p><div className="mt-2 flex gap-1.5"><SecurityPill ok={staff.security.totpConfigured} label="TOTP" /><SecurityPill ok={staff.security.recoveryCodesConfigured} label="Recovery" /></div></div></div></button>;
}

function SecurityPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? "inline-flex items-center gap-1 rounded-full bg-brand-primary-pale px-2 py-1 text-[10px] font-bold text-brand-primary-deep" : "inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700"}>{ok ? <CheckCircle2 className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}{label}</span>;
}

function StatusPill({ active, activeLabel, inactiveLabel }: { active: boolean; activeLabel: string; inactiveLabel: string }) {
  return <span className={active ? "inline-flex rounded-full bg-brand-primary-pale px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-primary-deep" : "inline-flex rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"}>{active ? activeLabel : inactiveLabel}</span>;
}

function Field({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold text-brand-heading">{label}</span>{children}{helper ? <span className="sq-admin-helper block">{helper}</span> : null}</label>;
}

function InlineMessage({ children }: { children: ReactNode }) {
  return <p className="sq-admin-message mt-3">{children}</p>;
}

function LoadingCard({ label, compact = false }: { label: string; compact?: boolean }) {
  return <section className={compact ? "rounded-xl border border-border/70 bg-white p-4 text-center" : "mt-5 rounded-2xl border border-border/70 bg-white p-7 text-center shadow-[var(--shadow-soft)]"}><RefreshCw className="mx-auto h-5 w-5 animate-spin text-brand-primary-deep" /><p className="mt-2.5 text-sm font-semibold text-muted-foreground">{label}</p></section>;
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof AppWindow; title: string; body: string }) {
  return <div className="py-5 text-center"><Icon className="mx-auto h-5 w-5 text-brand-primary-deep" /><p className="mt-2.5 font-bold text-brand-heading">{title}</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">{body}</p></div>;
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
  return <section className="mt-5 rounded-2xl border border-border/70 bg-white p-6 text-center shadow-[var(--shadow-soft)]"><ShieldEllipsis className="mx-auto h-6 w-6 text-brand-primary-deep" /><h2 className="mt-3 font-display text-xl font-bold text-brand-heading">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{body}</p>{action ? <button type="button" onClick={() => void action.onClick()} className="mt-4 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)]">{action.label}</button> : <a href="/" className="mt-4 inline-flex rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-brand-primary-deep">Kembali ke SQ Hub</a>}</section>;
}
