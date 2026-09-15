import { Network, Plus, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AccountMenu } from "@/components/AccountMenu";
import { BrandLockup } from "@/components/BrandLockup";
import type { WorkspaceSnapshot } from "@/types";

interface Props { workspace: WorkspaceSnapshot; onLogout?: () => void | Promise<void>; onAuthorizationDenied?: (reason: "forbidden" | "reauth") => void; }
interface Unit { id: string; unitKey: string; name: string; parentId: string | null; active: boolean; }
interface Preview { valid: boolean; fingerprint: string; creates: unknown[]; updates: unknown[]; unchanged: unknown[]; issues: Array<{ code: string; message: string }>; implicitDeletions: 0; ownershipState: "PRE_CUTOVER"; }

export function OrganizationalUnitsPage({ workspace, onLogout, onAuthorizationDenied }: Props) {
  const [units, setUnits] = useState<Unit[]>([]); const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ unitKey: "", name: "", parentId: "", reason: "" });
  const [snapshotText, setSnapshotText] = useState('[{"sourceRef":"HCIS-REF-1","sourceCode":"UNIT-001","name":"Contoh Unit","parentSourceRef":null,"active":true}]');
  const [mappingText, setMappingText] = useState('[{"sourceRef":"HCIS-REF-1","unitKey":"contoh-unit"}]'); const [preview, setPreview] = useState<Preview | null>(null);

  const request = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { credentials: "same-origin", ...init, headers: init?.body ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" } });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (response.status === 401) { window.location.assign("/api/auth/oidc/start"); throw new Error("redirecting"); }
    if (response.status === 403) onAuthorizationDenied?.(body.error === "ADMIN_REAUTH_REQUIRED" ? "reauth" : "forbidden");
    if (!response.ok) throw new Error(body.error ?? `HTTP_${response.status}`); return body;
  }, [onAuthorizationDenied]);
  const run = useCallback(async (task: () => Promise<void>) => { setBusy(true); setMessage(null); try { await task(); } catch { setMessage("Tindakan gagal dengan aman. Tidak ada cutover atau penghapusan implisit yang dijalankan."); } finally { setBusy(false); } }, []);
  const load = useCallback(async () => { const result = await request<{ units: Unit[] }>("/api/admin/organizational-units"); setUnits(result.units); }, [request]);
  useEffect(() => { void run(load); }, [load, run]);

  const create = () => run(async () => {
    await request("/api/admin/organizational-units", { method: "POST", body: JSON.stringify({ unitKey: form.unitKey.trim(), name: form.name.trim(), parentId: form.parentId || null, active: true, reason: form.reason.trim() }) });
    setForm({ unitKey: "", name: "", parentId: "", reason: "" }); await load(); setMessage("Unit dibuat pada foundation SQ Hub pre-cutover.");
  });
  const setActive = (unit: Unit) => run(async () => {
    const reason = window.prompt(`Alasan ${unit.active ? "menonaktifkan" : "mengaktifkan"} ${unit.name}?`); if (!reason?.trim()) return;
    await request(`/api/admin/organizational-units/${unit.id}/status`, { method: "POST", body: JSON.stringify({ active: !unit.active, reason: reason.trim(), confirm: true }) }); await load();
  });
  const previewImport = () => run(async () => {
    const rows = JSON.parse(snapshotText) as unknown[]; const mappings = JSON.parse(mappingText) as unknown[];
    const result = await request<{ preview: Preview }>("/api/admin/organizational-units/import/preview", { method: "POST", body: JSON.stringify({ sourceSystem: "hcis", rows, mappings }) }); setPreview(result.preview);
  });

  return <div className="min-h-screen bg-background"><aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-sidebar px-4 py-5 lg:block"><BrandLockup /><a href="/admin" className="mt-8 block rounded-xl px-3 py-2 text-sm font-bold text-brand-primary-deep">← Administrasi SQ</a><div className="absolute bottom-5 left-4 right-4"><AccountMenu user={workspace.user} variant="sidebar" onLogout={onLogout} /></div></aside>
    <main className="mx-auto max-w-6xl px-4 py-7 lg:pl-72"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Administrasi SQ · HUB-IMPL-014 proposal</p><h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold text-brand-heading"><Network className="h-6 w-6" /> Organizational Unit Master</h1>
      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><strong>PRE-CUTOVER FOUNDATION:</strong> SQ Hub target model is under review. HCIS remains authoritative for its current HR/runtime organization behavior until an explicit cutover is separately accepted. This page never writes HCIS tables.</div>{message ? <div className="mt-4 rounded-xl border border-border bg-white p-3 text-sm">{message}</div> : null}
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><section className="rounded-2xl border border-border bg-white p-5"><div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold">Unit foundation</h2><button disabled={busy} className={secondary} onClick={() => run(load)}><RefreshCcw className="h-4 w-4" /> Refresh</button></div><div className="mt-4 space-y-2">{units.map((unit) => <div key={unit.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div><strong className="text-sm">{unit.name}</strong><span className="block font-mono text-xs text-muted-foreground">{unit.unitKey}</span></div><button className={secondary} onClick={() => setActive(unit)}>{unit.active ? "Aktif" : "Nonaktif"}</button></div>)}</div></section>
        <section className="rounded-2xl border border-border bg-white p-5"><h2 className="font-display text-lg font-bold">Tambah unit</h2><p className="mt-1 text-xs text-muted-foreground">Unit key stabil dan immutable setelah dibuat.</p><input className={input} placeholder="unit-key" value={form.unitKey} onChange={(e) => setForm({ ...form, unitKey: e.target.value })} /><input className={input} placeholder="Nama unit" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><select className={input} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}><option value="">Tanpa parent</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><textarea className={input} placeholder="Alasan (wajib)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /><button disabled={busy} className={primary} onClick={create}><Plus className="h-4 w-4" /> Buat unit</button></section></div>
      <section className="mt-6 rounded-2xl border border-border bg-white p-5"><h2 className="font-display text-lg font-bold">HCIS mapping/import preview</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Preview membutuhkan mapping eksplisit <code>sourceRef → unitKey</code>. HCIS database ID hanya source reference; bukan identitas lintas sistem. Preview selalu melaporkan <strong>implicitDeletions = 0</strong>.</p><div className="mt-4 grid gap-4 lg:grid-cols-2"><label className="text-xs font-bold">Sanitized source snapshot<textarea className={`${input} min-h-36 font-mono`} value={snapshotText} onChange={(e) => setSnapshotText(e.target.value)} /></label><label className="text-xs font-bold">Explicit mappings<textarea className={`${input} min-h-36 font-mono`} value={mappingText} onChange={(e) => setMappingText(e.target.value)} /></label></div><button disabled={busy} className={primary} onClick={previewImport}>Preview mapping</button>{preview ? <div className="mt-4 rounded-xl bg-muted/30 p-4 text-xs leading-5"><strong>{preview.valid ? "VALID" : "INVALID"}</strong> · creates {preview.creates.length} · updates {preview.updates.length} · unchanged {preview.unchanged.length} · implicit deletions {preview.implicitDeletions}<br /><span className="font-mono">{preview.fingerprint}</span>{preview.issues.map((issue) => <p key={`${issue.code}-${issue.message}`} className="mt-1 text-destructive">{issue.code}: {issue.message}</p>)}</div> : null}</section>
    </main></div>;
}

const input = "mt-2 w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-primary/50";
const primary = "mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const secondary = "inline-flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-xs font-bold disabled:opacity-50";
