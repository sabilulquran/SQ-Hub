import { CalendarClock, Landmark, RefreshCw, Search, UserMinus, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AppShell } from "@/components/AppShell";
import { organLabel } from "@/organ";
import type {
  AdminStaff,
  OrganMembershipDetail,
  OrganMembershipEndPreview,
  OrganMembershipOverview,
  OrganMembershipView,
  OrganOperationResult,
  OrganOperationStep,
  Organ,
  WorkspaceSnapshot,
} from "@/types";

interface Props {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  onAuthorizationDenied?: (reason: "forbidden" | "reauth") => void;
  previewOverview?: OrganMembershipOverview;
}

const errors: Record<string, string> = {
  INVALID_REQUEST: "Periksa kembali isian. Alasan wajib diisi dan tanggal berakhir harus setelah tanggal mulai.",
  ORGAN_SELF_MUTATION_FORBIDDEN: "Administrator tidak dapat memberi atau mengakhiri keanggotaan organnya sendiri.",
  ORGAN_MEMBERSHIP_EXISTS: "Orang ini sudah memiliki keanggotaan organ aktif.",
  ORGAN_MEMBERSHIP_NOT_FOUND: "Keanggotaan organ tidak ditemukan.",
  ORGAN_MEMBERSHIP_ENDED: "Keanggotaan ini sudah berakhir dan tidak dapat diubah.",
  STAFF_NOT_FOUND: "Akun SQ tidak ditemukan.",
  EMAIL_IN_USE_USE_EXISTING_STAFF: "E-mail ini sudah dipakai Akun SQ staf. Gunakan jalur \"Sudah punya Akun SQ\" dan cari orangnya.",
  ORGAN_IDENTITY_DISABLED: "Akun SQ organ untuk e-mail ini nonaktif. Aktifkan kembali di Pegawai masuk & keluar, lalu gunakan jalur \"Sudah punya Akun SQ\".",
  ORGAN_PROVISIONING_UNAVAILABLE: "Pembuatan atau penonaktifan Akun SQ belum diaktifkan di lingkungan ini. Tidak ada perubahan.",
  NOT_GOVERNANCE_APPLICATION: "Aplikasi yang dipilih tidak menerbitkan ringkasan tata kelola.",
  ORGAN_PATH_B_ONLY: "Kirim ulang aktivasi hanya untuk Akun SQ yang dibuat untuk organ.",
  IDENTITY_DIRECTORY_UNAVAILABLE: "Direktori Akun SQ sedang tidak tersedia. Coba lagi beberapa saat.",
  IDENTITY_MANAGEMENT_UNAVAILABLE: "Akun SQ sedang tidak dapat diubah. Tidak ada perubahan; coba lagi.",
  LIFECYCLE_OPERATION_BUSY: "Operasi untuk orang ini sedang berjalan. Coba lagi setelah selesai.",
};

type AddPath = "existing_staff" | "organ_identity";

interface TermForm {
  organ: Organ;
  positionLabel: string;
  termStart: string;
  termEnd: string;
  reason: string;
}

const emptyTerms: TermForm = { organ: "pengurus", positionLabel: "", termStart: "", termEnd: "", reason: "" };

export function OrganMembershipPage({ workspace, onLogout, onAuthorizationDenied, previewOverview }: Props) {
  const [overview, setOverview] = useState<OrganMembershipOverview | null>(previewOverview ?? null);
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<AddPath | null>(null);
  const [terms, setTerms] = useState<TermForm>(emptyTerms);
  const [person, setPerson] = useState({ firstName: "", lastName: "", email: "" });
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState<AdminStaff[]>([]);
  const [chosen, setChosen] = useState<AdminStaff | null>(null);
  const [selectedApps, setSelectedApps] = useState<string[] | null>(null);
  const [result, setResult] = useState<OrganOperationResult | null>(null);
  const [detail, setDetail] = useState<OrganMembershipDetail | null>(null);

  const adminFetch = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: init?.body ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (response.status === 401) {
      window.location.assign("/api/auth/oidc/start");
      throw new Error("redirecting");
    }
    if (response.status === 403) onAuthorizationDenied?.(body.error === "ADMIN_REAUTH_REQUIRED" ? "reauth" : "forbidden");
    if (!response.ok) throw new Error(body.error ?? `HTTP_${response.status}`);
    return body;
  }, [onAuthorizationDenied]);

  const load = useCallback(async () => {
    if (previewOverview) return;
    setLoadError(false);
    try {
      setOverview(await adminFetch<OrganMembershipOverview>("/api/admin/organ-memberships"));
    } catch {
      setLoadError(true);
    }
  }, [adminFetch, previewOverview]);

  useEffect(() => {
    void load();
  }, [load]);

  const governanceApps = overview?.governanceApplications ?? [];
  const appsToGrant = selectedApps ?? governanceApps.map((app) => app.key);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(errors[code] ?? "Tindakan gagal dengan aman. Tidak ada perubahan yang dianggap selesai.");
    } finally {
      setBusy(false);
    }
  };

  const termPayload = () => ({
    organ: terms.organ,
    ...(terms.positionLabel.trim() ? { positionLabel: terms.positionLabel.trim() } : {}),
    termStart: terms.termStart,
    termEnd: terms.termEnd || null,
    reason: terms.reason.trim(),
  });

  const searchStaff = () => run(async () => {
    const body = await adminFetch<{ staff: AdminStaff[] }>(`/api/admin/staff?q=${encodeURIComponent(query.trim())}`);
    setStaff(body.staff);
    setChosen(null);
    if (body.staff.length === 0) setMessage("Akun SQ tidak ditemukan. Jika orang ini belum staf, pilih \"Belum punya Akun SQ\".");
  });

  const submit = () => run(async () => {
    if (!terms.reason.trim() || !terms.termStart) throw new Error("INVALID_REQUEST");
    const common = { ...termPayload(), applicationKeys: appsToGrant };
    const response = path === "existing_staff"
      ? await adminFetch<OrganOperationResult>("/api/admin/organ-memberships/existing-staff", {
          method: "POST",
          body: JSON.stringify({ subject: chosen?.subject, ...common }),
        })
      : await adminFetch<OrganOperationResult>("/api/admin/organ-memberships/new-identity", {
          method: "POST",
          body: JSON.stringify({ ...person, email: person.email.trim().toLowerCase(), ...common }),
        });
    setResult(response);
    await load();
  });

  const openDetail = (membership: OrganMembershipView) => run(async () => {
    setDetail(await adminFetch<OrganMembershipDetail>(`/api/admin/organ-memberships/${membership.id}`));
  });

  return (
    <AppShell workspace={workspace} space="admin" active="admin-organ" breadcrumb={["Administrasi", "Organ Yayasan"]} onLogout={onLogout}>
      <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-brand-heading sm:text-3xl">Organ Yayasan</h1>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
        Catat Pembina, Pengurus, dan Pengawas beserta masa jabatannya. Keanggotaan hanya membuka Ringkasan Yayasan di SQ Hub; peran tata kelola tetap diberikan oleh masing-masing aplikasi.
      </p>
      {message ? <p className="sq-admin-message mt-4" role="status">{message}</p> : null}
      {loadError ? (
        <Panel className="mt-5 text-center">
          <p className="text-sm text-muted-foreground">Daftar Organ Yayasan belum dapat dimuat.</p>
          <button type="button" className={secondary} onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Coba lagi</button>
        </Panel>
      ) : null}

      {overview ? (
        <>
          {overview.endingSoon.length > 0 ? (
            <Panel className="mt-5 border-warning-ink/20 bg-warning-soft/60">
              <h2 className="flex items-center gap-2 font-display text-base font-bold text-warning-ink"><CalendarClock className="h-4 w-4" /> Masa jabatan berakhir dalam 30 hari</h2>
              <ul className="mt-3 space-y-2">
                {overview.endingSoon.map((membership) => (
                  <li key={membership.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span><strong>{membership.displayName ?? "Akun SQ"}</strong> · {organLabel(membership.organ)} · berakhir {formatDate(membership.termEnd)}</span>
                    <button type="button" className={secondary} onClick={() => openDetail(membership)}>Perpanjang atau akhiri</button>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <Panel>
              <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-heading"><Landmark className="h-5 w-5" /> Anggota aktif</h2>
              {overview.active.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Belum ada anggota organ yang tercatat.</p> : (
                <ul className="mt-3 divide-y divide-border/70">
                  {overview.active.map((membership) => (
                    <li key={membership.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-brand-heading">{membership.displayName ?? "Akun SQ tidak dapat dimuat"}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {organLabel(membership.organ)}{membership.positionLabel ? ` · ${membership.positionLabel}` : ""} · {formatTerm(membership)}
                        </p>
                        <PathBadge path={membership.provisioningPath} />
                      </div>
                      <button type="button" className={secondary} onClick={() => openDetail(membership)}>Kelola</button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel>
              <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-heading"><UserPlus className="h-5 w-5" /> Tambah anggota</h2>
              <fieldset className="mt-3">
                <legend className="text-sm font-bold text-foreground">Apakah orang ini sudah memiliki Akun SQ sebagai staf?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Choice checked={path === "existing_staff"} onSelect={() => { setPath("existing_staff"); setResult(null); }} title="Sudah punya Akun SQ" body="Misalnya Pengurus bergaji yang tercatat sebagai pegawai." />
                  <Choice checked={path === "organ_identity"} onSelect={() => { setPath("organ_identity"); setResult(null); }} title="Belum punya Akun SQ" body="Misalnya Pembina. SQ Hub membuat Akun SQ dengan e-mail sebagai nama pengguna." disabled={!overview.capabilities.addNewIdentity} />
                </div>
                {!overview.capabilities.addNewIdentity ? <p className="sq-admin-helper">Pembuatan Akun SQ baru belum diaktifkan di lingkungan ini.</p> : null}
              </fieldset>

              {path === "existing_staff" ? (
                <div className="mt-4">
                  <div className="flex gap-2">
                    <input className="sq-admin-input" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchStaff(); }} placeholder="Cari NIP, e-mail, atau nama" />
                    <button type="button" className={secondary} disabled={busy || query.trim().length < 2} onClick={() => void searchStaff()}><Search className="h-4 w-4" /> Cari</button>
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {staff.map((entry) => (
                      <button key={entry.subject} type="button" onClick={() => setChosen(entry)} className={chosen?.subject === entry.subject ? "w-full rounded-xl border border-brand-primary/40 bg-brand-primary-pale/55 p-3 text-left text-sm" : "w-full rounded-xl border border-border p-3 text-left text-sm"}>
                        <strong>{entry.displayName}</strong>
                        <span className="block text-xs text-muted-foreground">{entry.username}{entry.email ? ` · ${entry.email}` : ""} · {entry.security.totpConfigured ? "verifikasi dua langkah aktif" : "verifikasi dua langkah akan diwajibkan"}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {path === "organ_identity" ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Nama depan"><input className="sq-admin-input" value={person.firstName} onChange={(event) => setPerson({ ...person, firstName: event.target.value })} /></Field>
                  <Field label="Nama belakang"><input className="sq-admin-input" value={person.lastName} onChange={(event) => setPerson({ ...person, lastName: event.target.value })} /></Field>
                  <div className="sm:col-span-2">
                    <Field label="E-mail" helper="Menjadi nama pengguna Akun SQ. Akun SQ mengirim tautan verifikasi e-mail dan pembuatan kata sandi (12 jam); verifikasi dua langkah wajib saat masuk pertama. Tidak ada NIP.">
                      <input className="sq-admin-input" type="email" value={person.email} onChange={(event) => setPerson({ ...person, email: event.target.value })} />
                    </Field>
                  </div>
                </div>
              ) : null}

              {path ? (
                <>
                  <TermFields terms={terms} onChange={setTerms} />
                  {governanceApps.length > 0 ? (
                    <fieldset className="mt-4">
                      <legend className="text-xs font-bold text-brand-heading">Akses aplikasi yang diberikan sekaligus</legend>
                      <div className="mt-2 space-y-1.5">
                        {governanceApps.map((app) => (
                          <label key={app.key} className="flex min-h-11 items-center gap-2.5 rounded-xl border border-border px-3 text-sm">
                            <input type="checkbox" checked={appsToGrant.includes(app.key)} onChange={(event) => setSelectedApps(event.target.checked ? [...appsToGrant, app.key] : appsToGrant.filter((key) => key !== app.key))} />
                            {app.name}
                          </label>
                        ))}
                      </div>
                      <p className="sq-admin-helper">Akses aplikasi hanya pintu masuk. Peran tata kelola tetap diberikan oleh aplikasi itu sendiri.</p>
                    </fieldset>
                  ) : null}
                  <button type="button" className={primary} disabled={busy || (path === "existing_staff" && !chosen)} onClick={() => void submit()}>
                    <UserPlus className="h-4 w-4" /> Simpan keanggotaan
                  </button>
                </>
              ) : null}

              {result ? <OperationResult result={result} /> : null}
            </Panel>
          </div>

          {detail ? (
            <MembershipDetail
              key={detail.membership.id}
              detail={detail}
              busy={busy}
              run={run}
              adminFetch={adminFetch}
              onChanged={async (next) => { setDetail(next); await load(); }}
              canEndNewIdentity={overview.capabilities.endNewIdentity}
            />
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}

function MembershipDetail({
  detail,
  busy,
  run,
  adminFetch,
  onChanged,
  canEndNewIdentity,
}: {
  detail: OrganMembershipDetail;
  busy: boolean;
  run: (task: () => Promise<void>) => Promise<void>;
  adminFetch: <T>(url: string, init?: RequestInit) => Promise<T>;
  onChanged: (next: OrganMembershipDetail) => Promise<void>;
  canEndNewIdentity: boolean;
}) {
  const membership = detail.membership;
  const [terms, setTerms] = useState<TermForm>({
    organ: membership.organ,
    positionLabel: membership.positionLabel ?? "",
    termStart: membership.termStart,
    termEnd: membership.termEnd ?? "",
    reason: "",
  });
  const [preview, setPreview] = useState<OrganMembershipEndPreview | null>(null);
  const [endReason, setEndReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [steps, setSteps] = useState<OrganOperationStep[]>([]);
  const active = membership.status === "active";
  const refresh = async () => onChanged(await adminFetch<OrganMembershipDetail>(`/api/admin/organ-memberships/${membership.id}`));

  const change = () => run(async () => {
    if (!terms.reason.trim()) throw new Error("INVALID_REQUEST");
    await adminFetch(`/api/admin/organ-memberships/${membership.id}/change`, {
      method: "POST",
      body: JSON.stringify({
        organ: terms.organ,
        ...(terms.positionLabel.trim() ? { positionLabel: terms.positionLabel.trim() } : {}),
        termStart: terms.termStart,
        termEnd: terms.termEnd || null,
        reason: terms.reason.trim(),
      }),
    });
    await refresh();
  });

  const loadPreview = () => run(async () => {
    setPreview(await adminFetch<OrganMembershipEndPreview>(`/api/admin/organ-memberships/${membership.id}/end-preview`));
  });

  const end = () => run(async () => {
    if (!endReason.trim() || !confirmed) throw new Error("INVALID_REQUEST");
    const outcome = await adminFetch<{ steps: OrganOperationStep[] }>(`/api/admin/organ-memberships/${membership.id}/end`, {
      method: "POST",
      body: JSON.stringify({ reason: endReason.trim(), confirm: true }),
    });
    setSteps(outcome.steps);
    await refresh();
  });

  const resend = () => run(async () => {
    const reason = endReason.trim() || terms.reason.trim();
    if (!reason) throw new Error("INVALID_REQUEST");
    const outcome = await adminFetch<{ step: OrganOperationStep }>(`/api/admin/organ-memberships/${membership.id}/resend-activation`, {
      method: "POST",
      body: JSON.stringify({ reason, confirm: true }),
    });
    setSteps([outcome.step]);
  });

  return (
    <Panel className="mt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-brand-heading">{membership.displayName ?? "Akun SQ"}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{membership.username ?? ""}{membership.email ? ` · ${membership.email}` : ""}</p>
          <p className="mt-1 text-sm">{organLabel(membership.organ)}{membership.positionLabel ? ` · ${membership.positionLabel}` : ""} · {formatTerm(membership)}</p>
          <PathBadge path={membership.provisioningPath} />
        </div>
        <span className={detail.security.totpConfigured ? "rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-bold text-success-ink" : "rounded-full bg-warning-soft px-2.5 py-1 text-[11px] font-bold text-warning-ink"}>
          {detail.security.totpConfigured ? "Verifikasi dua langkah aktif" : "Verifikasi dua langkah belum aktif"}
        </span>
      </div>

      <h3 className="mt-5 text-sm font-bold text-brand-heading">Aplikasi dengan ringkasan tata kelola</h3>
      <ul className="mt-2 divide-y divide-border/70 rounded-xl border border-border">
        {detail.governanceApplications.map((app) => (
          <li key={app.key} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span className="font-semibold">{app.name}</span>
            <span className="text-xs text-muted-foreground">
              Akses aplikasi: {app.access === "active" ? "aktif" : app.access === "revoked" ? "dicabut" : "belum diberi"}
              {app.summary ? ` · Ringkasan: ${summaryLabel(app.summary.outcome)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="sq-admin-helper">Kartu sebuah aplikasi baru tampil setelah aplikasi itu memberi peran tata kelola, misalnya peran Yayasan di HCIS. SQ Hub tidak membuat atau mengubah peran tersebut.</p>

      {active ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-bold text-brand-heading">Ubah organ atau masa jabatan</h3>
            <TermFields terms={terms} onChange={setTerms} />
            <button type="button" className={primary} disabled={busy} onClick={() => void change()}>Simpan perubahan</button>
            {membership.provisioningPath === "organ_identity" ? (
              <button type="button" className={`${secondary} mt-3`} disabled={busy} onClick={() => void resend()}>Kirim ulang e-mail aktivasi</button>
            ) : null}
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-brand-heading"><UserMinus className="h-4 w-4" /> Akhiri keanggotaan</h3>
            {!preview ? (
              <button type="button" className={`${secondary} mt-3`} disabled={busy} onClick={() => void loadPreview()}>Lihat langkah yang akan dijalankan</button>
            ) : (
              <EndPreview preview={preview} disabled={preview.path === "organ_identity" && !canEndNewIdentity} />
            )}
            {preview ? (
              <>
                <Field label="Alasan"><textarea className="sq-admin-input mt-3" value={endReason} onChange={(event) => setEndReason(event.target.value)} /></Field>
                <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Saya sudah memeriksa langkah di atas.</label>
                <button type="button" className={danger} disabled={busy || !confirmed || !endReason.trim() || (preview.path === "organ_identity" && !canEndNewIdentity)} onClick={() => void end()}>Akhiri keanggotaan</button>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">Keanggotaan ini sudah berakhir{membership.endedAt ? ` pada ${formatDate(membership.endedAt.slice(0, 10))}` : ""}.</p>
      )}
      {steps.length > 0 ? <StepList steps={steps} /> : null}
    </Panel>
  );
}

function EndPreview({ preview, disabled }: { preview: OrganMembershipEndPreview; disabled: boolean }) {
  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3 text-sm leading-6">
      {preview.path === "existing_staff" ? (
        <p>Keanggotaan organ diakhiri. Akun SQ dan akses aplikasinya tetap, karena orang ini masih staf.</p>
      ) : (
        <ol className="list-decimal pl-5">
          <li>Akhiri keanggotaan organ.</li>
          <li>Cabut akses aplikasi: {preview.offboarding?.activeApplications.map((app) => app.name).join(", ") || "tidak ada yang aktif"}.</li>
          {preview.offboarding?.platformAdministrator ? <li>Cabut keanggotaan Platform Administrator.</li> : null}
          <li>Nonaktifkan Akun SQ{preview.offboarding?.globalIdentityEnabled === false ? " (sudah nonaktif)" : ""}.</li>
        </ol>
      )}
      {preview.domainRoleReminders.length > 0 ? (
        <p className="mt-2 text-warning-ink">Minta aplikasi berikut mencabut peran tata kelolanya: {preview.domainRoleReminders.map((app) => app.name).join(", ")}.</p>
      ) : null}
      {disabled ? <p className="mt-2 text-warning-ink">Penonaktifan Akun SQ belum diaktifkan di lingkungan ini.</p> : null}
    </div>
  );
}

function OperationResult({ result }: { result: OrganOperationResult }) {
  return (
    <div className="mt-4">
      <p className="text-sm font-bold text-brand-heading">
        {result.outcome === "succeeded" ? "Selesai." : result.outcome === "failed" ? "Belum ada yang dibuat." : "Sebagian langkah gagal. Periksa lalu simpan lagi; langkah yang sudah selesai tidak diulang."}
      </p>
      <StepList steps={result.steps} />
      {result.domainRoleReminders.length > 0 ? (
        <p className="sq-admin-message mt-3">
          Orang ini masih perlu peran tata kelola di: {result.domainRoleReminders.map((app) => app.name).join(", ")}. Kartu aplikasi tersebut baru tampil setelah peran diberikan di aplikasinya.
        </p>
      ) : null}
    </div>
  );
}

function StepList({ steps }: { steps: OrganOperationStep[] }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {steps.map((step, index) => (
        <li key={`${step.step}-${step.target}-${index}`} className="flex items-start gap-2 text-sm">
          <span className={step.status === "failed" ? "mt-0.5 rounded-full bg-danger-soft px-2 py-0.5 text-[10px] font-bold text-danger-ink" : step.status === "succeeded" ? "mt-0.5 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-bold text-success-ink" : "mt-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground"}>
            {step.status === "failed" ? "Gagal" : step.status === "succeeded" ? "Berhasil" : "Tetap"}
          </span>
          <span>{step.message}{step.step === "application_access" ? ` (${step.target})` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function TermFields({ terms, onChange }: { terms: TermForm; onChange: (next: TermForm) => void }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <Field label="Organ">
        <select className="sq-admin-input" value={terms.organ} onChange={(event) => onChange({ ...terms, organ: event.target.value as Organ })}>
          <option value="pembina">Pembina</option>
          <option value="pengurus">Pengurus</option>
          <option value="pengawas">Pengawas</option>
        </select>
      </Field>
      <Field label="Jabatan (opsional)"><input className="sq-admin-input" value={terms.positionLabel} onChange={(event) => onChange({ ...terms, positionLabel: event.target.value })} placeholder="Contoh: Ketua Pengurus" /></Field>
      <Field label="Mulai menjabat"><input className="sq-admin-input" type="date" value={terms.termStart} onChange={(event) => onChange({ ...terms, termStart: event.target.value })} /></Field>
      <Field label="Berakhir (kosongkan bila tidak ditentukan)"><input className="sq-admin-input" type="date" value={terms.termEnd} onChange={(event) => onChange({ ...terms, termEnd: event.target.value })} /></Field>
      <div className="sm:col-span-2">
        <Field label="Alasan" helper="Wajib diisi, misalnya nomor SK. Tercatat di audit platform."><textarea className="sq-admin-input" value={terms.reason} onChange={(event) => onChange({ ...terms, reason: event.target.value })} /></Field>
      </div>
    </div>
  );
}

function Choice({ checked, onSelect, title, body, disabled = false }: { checked: boolean; onSelect: () => void; title: string; body: string; disabled?: boolean }) {
  return (
    <label className={["flex cursor-pointer gap-2.5 rounded-xl border p-3 text-sm", checked ? "border-brand-primary/45 bg-brand-primary-pale/55" : "border-border", disabled ? "cursor-not-allowed opacity-50" : ""].join(" ")}>
      <input type="radio" name="organ-path" checked={checked} disabled={disabled} onChange={onSelect} className="mt-1" />
      <span><span className="block font-bold text-brand-heading">{title}</span><span className="block text-xs leading-5 text-muted-foreground">{body}</span></span>
    </label>
  );
}

function PathBadge({ path }: { path: OrganMembershipView["provisioningPath"] }) {
  return (
    <span className="mt-1.5 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
      {path === "existing_staff" ? "Staf dengan Akun SQ" : "Akun SQ khusus organ"}
    </span>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border/70 bg-surface-raised p-4 shadow-[var(--shadow-soft)] sm:p-5 ${className}`}>{children}</section>;
}

function Field({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold text-brand-heading">{label}</span>{children}{helper ? <span className="sq-admin-helper block">{helper}</span> : null}</label>;
}

function summaryLabel(outcome: "ready" | "hidden" | "failed") {
  return outcome === "ready" ? "tampil" : outcome === "hidden" ? "ditolak aplikasi (peran belum ada)" : "gagal dimuat";
}

function formatTerm(membership: Pick<OrganMembershipView, "termStart" | "termEnd">) {
  return membership.termEnd ? `${formatDate(membership.termStart)} – ${formatDate(membership.termEnd)}` : `sejak ${formatDate(membership.termStart)}`;
}

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date);
}

const primary = "mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-brand-foreground shadow-[var(--shadow-button)] disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm font-bold text-brand-primary-deep disabled:opacity-50";
const danger = "mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-destructive/30 bg-danger-soft px-4 py-2.5 text-sm font-bold text-destructive disabled:cursor-not-allowed disabled:opacity-50";
