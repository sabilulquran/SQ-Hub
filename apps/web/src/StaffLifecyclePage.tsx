import { KeyRound, Search, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";

import { AccountMenu } from "@/components/AccountMenu";
import { BrandLockup } from "@/components/BrandLockup";
import type { AdminStaff, WorkspaceSnapshot } from "@/types";

interface Props {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  onAuthorizationDenied?: (reason: "forbidden" | "reauth") => void;
}

type ProvisionForm = {
  staffType: "employee" | "staff_without_nip";
  employeeNumber: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  reason: string;
};

const emptyForm: ProvisionForm = {
  staffType: "employee", employeeNumber: "", username: "", firstName: "", lastName: "", email: "", reason: "",
};

const errors: Record<string, string> = {
  INVALID_REQUEST: "Data belum memenuhi kebijakan provisioning Staff.",
  DUPLICATE_USERNAME: "Username sudah digunakan.",
  DUPLICATE_EMAIL: "Email sudah digunakan.",
  STAFF_NOT_FOUND: "Identitas Staff tidak ditemukan.",
  ADMIN_SELF_OFFBOARD_FORBIDDEN: "Administrator tidak boleh menonaktifkan atau offboard identitasnya sendiri dari sesi ini.",
  IDENTITY_MANAGEMENT_UNAVAILABLE: "Integrasi lifecycle Akun SQ belum tersedia; tidak ada perubahan yang dijalankan.",
};

export function StaffLifecyclePage({ workspace, onLogout, onAuthorizationDenied }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState<AdminStaff[]>([]);
  const [selected, setSelected] = useState<AdminStaff | null>(null);
  const [reason, setReason] = useState("");
  const [disableIdentity, setDisableIdentity] = useState(false);
  const [preview, setPreview] = useState<{ activeApplications: Array<{ key: string; name: string }>; platformAdministrator: boolean; globalIdentityEnabled: boolean; hcisEmployeeStatus: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const adminFetch = async <T,>(url: string, init?: RequestInit): Promise<T> => {
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
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await task(); } catch (error) { setMessage(error instanceof Error ? errors[error.message] ?? "Tindakan gagal dengan aman." : "Tindakan gagal dengan aman."); }
    finally { setBusy(false); }
  };

  const loadPreview = async (entry: AdminStaff) => {
    setSelected(entry);
    const result = await adminFetch<{ preview: NonNullable<typeof preview> }>(`/api/admin/staff-lifecycle/${encodeURIComponent(entry.subject)}/offboarding-preview`);
    setPreview(result.preview);
  };

  const provision = () => run(async () => {
    const payload = {
      staffType: form.staffType,
      ...(form.staffType === "employee" ? { employeeNumber: form.employeeNumber.trim() } : {}),
      username: form.username.trim(), firstName: form.firstName.trim(), lastName: form.lastName.trim(),
      email: form.email.trim().toLowerCase(), emailVerified: true, enabled: true, reason: form.reason.trim(),
    };
    const result = await adminFetch<{ credentialInitialization: "sent" | "required_action_pending" }>("/api/admin/staff-lifecycle/provision", { method: "POST", body: JSON.stringify(payload) });
    setMessage(result.credentialInitialization === "sent" ? "Identitas Staff dibuat lengkap; Akun SQ mengirim instruksi pembuatan password." : "Identitas dibuat lengkap; required action password masih pending dan dapat dikirim ulang.");
    setForm(emptyForm);
  });

  const search = () => run(async () => {
    const result = await adminFetch<{ staff: AdminStaff[] }>(`/api/admin/staff?q=${encodeURIComponent(query.trim())}`);
    setStaff(result.staff); setSelected(null); setPreview(null);
  });

  const setEnabled = (enabled: boolean) => run(async () => {
    if (!selected || !reason.trim()) throw new Error("INVALID_REQUEST");
    if (!window.confirm(`${enabled ? "Aktifkan" : "Nonaktifkan"} identitas global ${selected.displayName}?`)) return;
    await adminFetch("/api/admin/staff-lifecycle/status", { method: "POST", body: JSON.stringify({ subject: selected.subject, enabled, reason: reason.trim(), confirm: true }) });
    const next = { ...selected, enabled }; setSelected(next); await loadPreview(next);
    setMessage(enabled ? "Identitas global diaktifkan." : "Identitas global dinonaktifkan.");
  });

  const initializePassword = () => run(async () => {
    if (!selected || !reason.trim()) throw new Error("INVALID_REQUEST");
    if (!window.confirm(`Kirim instruksi membuat ulang password kepada ${selected.displayName}?`)) return;
    await adminFetch("/api/admin/staff-lifecycle/password-initialization", { method: "POST", body: JSON.stringify({ subject: selected.subject, reason: reason.trim(), confirm: true }) });
    setMessage("Akun SQ menerima required action UPDATE_PASSWORD. Tidak ada password yang ditampilkan di sini.");
  });

  const offboard = () => run(async () => {
    if (!selected || !reason.trim()) throw new Error("INVALID_REQUEST");
    if (!window.confirm(`Jalankan platform offboarding ${selected.displayName}? Status pegawai HCIS tidak akan diubah.`)) return;
    const result = await adminFetch<{ outcome: "succeeded" | "partial_failure" | "failed" }>("/api/admin/staff-lifecycle/offboard", { method: "POST", body: JSON.stringify({ subject: selected.subject, reason: reason.trim(), disableIdentity, confirm: true }) });
    setMessage(result.outcome === "succeeded" ? "Platform offboarding selesai; HCIS tidak disentuh." : "Offboarding selesai dengan kegagalan parsial; aman untuk dicoba ulang.");
    await loadPreview(selected);
  });

  return <div className="min-h-screen bg-background">
    <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-sidebar px-4 py-5 lg:block"><BrandLockup /><a href="/admin" className="mt-8 block rounded-xl px-3 py-2 text-sm font-bold text-brand-primary-deep">← Administrasi SQ</a><div className="absolute bottom-5 left-4 right-4"><AccountMenu user={workspace.user} variant="sidebar" onLogout={onLogout} /></div></aside>
    <main className="mx-auto max-w-6xl px-4 py-7 lg:pl-72">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Administrasi SQ · Go 5C proposal</p><h1 className="mt-1 font-display text-2xl font-bold text-brand-heading">Provisioning & Offboarding Staff</h1>
      <div className="mt-5 rounded-2xl border border-brand-primary/15 bg-brand-primary-pale/50 p-4 text-sm leading-6 text-brand-primary-deep"><strong>Boundary:</strong> Status pegawai, terminasi, reporting line, serta hak bisnis HCIS tidak dibaca, disimpulkan, atau diubah. Halaman ini hanya mengelola identitas global dan akses platform.</div>
      {message ? <div className="mt-4 rounded-xl border border-border bg-white p-3 text-sm">{message}</div> : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><UserPlus className="h-5 w-5" /> Provision Staff</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold">Jenis Staff<select className={input} value={form.staffType} onChange={(e) => setForm({ ...form, staffType: e.target.value as ProvisionForm["staffType"], employeeNumber: "", username: "" })}><option value="employee">Employee (punya NIP)</option><option value="staff_without_nip">Staff tanpa NIP</option></select></label>
          {form.staffType === "employee" ? <label className="text-xs font-bold">NIP / employee number<input className={input} value={form.employeeNumber} onChange={(e) => setForm({ ...form, employeeNumber: e.target.value, username: e.target.value })} /></label> : null}
          <label className="text-xs font-bold">Username<input className={input} value={form.username} readOnly={form.staffType === "employee"} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label className="text-xs font-bold">Email terverifikasi<input className={input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value, ...(form.staffType === "staff_without_nip" ? { username: e.target.value } : {}) })} /></label>
          <label className="text-xs font-bold">Nama depan<input className={input} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label><label className="text-xs font-bold">Nama belakang<input className={input} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
          <label className="text-xs font-bold sm:col-span-2">Alasan<textarea className={input} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        </div><button disabled={busy} className={primary} onClick={provision}><UserPlus className="h-4 w-4" /> Buat identitas Staff</button><p className="mt-3 text-xs leading-5 text-muted-foreground">NIK bukan username. Browser tidak menerima password, hash, TOTP seed, recovery code, token, atau client secret.</p></section>
        <section className="rounded-2xl border border-border bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 font-display text-lg font-bold"><UserMinus className="h-5 w-5" /> Status & Offboarding</h2><div className="mt-4 flex gap-2"><input className={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari username, email, atau nama" /><button className={secondary} disabled={busy} onClick={search}><Search className="h-4 w-4" /> Cari</button></div>
          <div className="mt-3 space-y-2">{staff.map((entry) => <button key={entry.subject} className="w-full rounded-xl border border-border p-3 text-left text-sm" onClick={() => run(() => loadPreview(entry))}><strong>{entry.displayName}</strong><span className="block text-xs text-muted-foreground">{entry.username} · {entry.enabled ? "aktif" : "nonaktif"}</span></button>)}</div>
          {selected ? <div className="mt-4 rounded-xl bg-muted/25 p-4"><strong>{selected.displayName}</strong>{preview ? <p className="mt-2 text-xs leading-5 text-muted-foreground">Application Access aktif: {preview.activeApplications.length} · Platform Administrator: {preview.platformAdministrator ? "aktif" : "tidak aktif"} · Status pegawai HCIS: tidak dibaca / tidak diinfer.</p> : null}<textarea className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan tindakan (wajib)" /><div className="mt-3 flex flex-wrap gap-2"><button className={secondary} onClick={() => setEnabled(!selected.enabled)}>{selected.enabled ? "Nonaktifkan global" : "Aktifkan global"}</button><button className={secondary} onClick={initializePassword}><KeyRound className="h-4 w-4" /> Instruksi password</button></div><label className="mt-3 flex gap-2 rounded-lg bg-white p-3 text-xs"><input type="checkbox" checked={disableIdentity} onChange={(e) => setDisableIdentity(e.target.checked)} /><span><strong>Juga nonaktifkan identitas global</strong><br />Opsional dan eksplisit; resigned/terminated HCIS tidak otomatis sama dengan pilihan ini.</span></label><button className={primary} onClick={offboard}><UserMinus className="h-4 w-4" /> Jalankan platform offboarding</button></div> : null}
        </section>
      </div>
    </main>
  </div>;
}

const input = "mt-1.5 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-primary/50";
const primary = "mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary = "inline-flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2.5 text-sm font-bold disabled:opacity-50";
