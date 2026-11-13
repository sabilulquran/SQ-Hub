import { Check, RefreshCw, Search, ShieldCheck, UserMinus, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useStaffDialog } from "@/admin-staff-dialog";
import { AppShell } from "@/components/AppShell";
import { DetailDialog } from "@/components/DetailDialog";
import type {
  AdminStaff,
  PlatformAdministratorAuditEntry,
  PlatformAdministratorOverview,
  PlatformAdministratorPerson,
  WorkspaceSnapshot,
} from "@/types";

interface Props {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  onAuthorizationDenied?: (reason: "forbidden" | "reauth") => void;
}

const errors: Record<string, string> = {
  INVALID_REQUEST: "Isian belum lengkap. Alasan wajib diisi.",
  STAFF_NOT_FOUND: "Staff tidak ditemukan di Akun SQ.",
  SELF_PROPOSAL_FORBIDDEN: "Anda tidak dapat mengusulkan diri sendiri.",
  ALREADY_ACTIVE: "Orang ini sudah Admin Platform aktif.",
  PROPOSAL_PENDING: "Sudah ada usulan yang menunggu untuk orang ini.",
  PROPOSAL_NOT_FOUND: "Usulan tidak ditemukan.",
  PROPOSAL_NOT_PENDING: "Usulan ini sudah diputuskan.",
  PROPOSAL_EXPIRED: "Usulan sudah kedaluwarsa. Buat usulan baru.",
  SAME_ADMIN_FORBIDDEN: "Pengusul tidak dapat mengonfirmasi usulannya sendiri. Admin Platform lain yang harus mengonfirmasi.",
  SELF_CONFIRM_FORBIDDEN: "Anda tidak dapat mengonfirmasi pengangkatan diri sendiri.",
  PROPOSER_NOT_ACTIVE: "Pengusul sudah bukan Admin Platform, jadi usulannya tidak berlaku lagi.",
  CONFIRMER_NOT_ACTIVE: "Anda sudah bukan Admin Platform aktif.",
  IDENTITY_DIRECTORY_UNAVAILABLE: "Direktori Akun SQ sedang tidak tersedia.",
};

const actionLabels: Record<string, string> = {
  "platform_admin.propose": "Mengusulkan",
  "platform_admin.grant": "Mengangkat",
  "platform_admin.revoke": "Mencabut",
  "platform_admin.proposal_cancel": "Membatalkan usulan",
};

class RequestError extends Error {}

/** HUB-IMPL-023 H-9 and H-11: who the Platform Administrators are, with four-eyes appointment. */
export function PlatformAdministratorsPage({ workspace, onLogout, onAuthorizationDenied }: Props) {
  const [overview, setOverview] = useState<PlatformAdministratorOverview | null>(null);
  const [audit, setAudit] = useState<PlatformAdministratorAuditEntry[]>([]);
  const [query, setQuery] = useState("");
  const [staff, setStaff] = useState<AdminStaff[]>([]);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const adminFetch = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...init,
      headers: init?.body ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
    });
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (response.status === 401) {
      window.location.assign("/api/auth/oidc/start");
      throw new RequestError("REDIRECTING");
    }
    if (response.status === 403 && (body.error === "ADMIN_FORBIDDEN" || body.error === "ADMIN_REAUTH_REQUIRED")) {
      onAuthorizationDenied?.(body.error === "ADMIN_REAUTH_REQUIRED" ? "reauth" : "forbidden");
    }
    if (!response.ok) throw new RequestError(body.error ?? `HTTP_${response.status}`);
    return body;
  }, [onAuthorizationDenied]);

  const load = useCallback(async () => {
    const [next, log] = await Promise.all([
      adminFetch<PlatformAdministratorOverview>("/api/admin/platform-administrators"),
      adminFetch<{ audit: PlatformAdministratorAuditEntry[] }>("/api/admin/platform-administrators/audit?limit=100"),
    ]);
    setOverview(next);
    setAudit(log.audit);
  }, [adminFetch]);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true); setMessage(null);
    try { await task(); } catch (error) {
      if (error instanceof RequestError && error.message === "REDIRECTING") return;
      setMessage(error instanceof Error ? errors[error.message] ?? "Tindakan gagal dengan aman." : "Tindakan gagal dengan aman.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { void run(load); }, [run, load]);

  // The picked person opens a small pop-up for the reason, `?orang=<username>` (sq-core-app-shell.md
  // "Detail views open as a pop-up"); a link or Back to that address opens the same person.
  const staffDialog = useStaffDialog({ fetchJson: adminFetch, known: staff });
  const selected = staffDialog.staff;
  // The reason belongs to one person: it starts empty each time the pop-up's person changes or it closes.
  useEffect(() => { setReason(""); }, [selected?.subject]);

  const search = () => run(async () => {
    const result = await adminFetch<{ staff: AdminStaff[] }>(`/api/admin/staff?q=${encodeURIComponent(query.trim())}`);
    setStaff(result.staff);
  });

  const propose = () => run(async () => {
    const target = selected;
    if (!target || !reason.trim()) throw new RequestError("INVALID_REQUEST");
    try {
      await adminFetch("/api/admin/platform-administrators/proposals", { method: "POST", body: JSON.stringify({ subject: target.subject, reason: reason.trim() }) });
    } catch (error) {
      // A refusal for a person whose pop-up was closed or replaced is not shown under someone else.
      if (staffDialog.mayReport(target.username)) throw error;
      return;
    }
    // Close only this person's pop-up; one opened for someone else meanwhile stays as it is.
    if (staffDialog.isOpenFor(target.username)) { staffDialog.close(); setReason(""); setStaff([]); }
    await load();
    if (staffDialog.mayReport(target.username)) setMessage("Usulan dibuat. Admin Platform lain harus mengonfirmasinya dalam 7 hari.");
  });

  const decide = (proposalId: string, decision: "confirm" | "cancel") => run(async () => {
    if (decision === "confirm" && !window.confirm("Konfirmasi pengangkatan Admin Platform ini?")) return;
    await adminFetch(`/api/admin/platform-administrators/proposals/${encodeURIComponent(proposalId)}/${decision}`, { method: "POST" });
    await load();
    setMessage(decision === "confirm" ? "Admin Platform diangkat. Ia perlu masuk ulang ke SQ Hub sebelum kewenangannya berlaku." : "Usulan dibatalkan.");
  });

  const revoke = (person: PlatformAdministratorPerson) => run(async () => {
    const why = window.prompt(`Alasan mencabut ${person.displayName ?? person.subject} sebagai Admin Platform:`);
    if (!why?.trim()) return;
    await adminFetch("/api/admin/platform-administrators/revoke", { method: "POST", body: JSON.stringify({ subject: person.subject, reason: why.trim() }) });
    await load();
    setMessage("Kewenangan Admin Platform dicabut.");
  });

  const viewer = overview?.viewer.subject;
  const active = overview?.administrators.filter((entry) => entry.status === "active") ?? [];
  const pending = overview?.proposals.filter((entry) => entry.status === "pending") ?? [];

  return <AppShell workspace={workspace} space="admin" active="admin-platform-administrators" breadcrumb={["Administrasi", "Admin Platform"]} onLogout={onLogout}>
    <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-brand-heading sm:text-3xl">Admin Platform</h1>
    <div className="mt-5 rounded-2xl border border-brand-primary/15 bg-brand-primary-pale/50 p-4 text-sm leading-6 text-brand-primary-deep">
      Mengangkat Admin Platform butuh dua orang: satu mengusulkan, Admin Platform lain mengonfirmasi. Tidak ada yang dapat mengangkat dirinya sendiri. Mencabut cukup satu orang.
    </div>
    {message && !staffDialog.username ? <div className="mt-4 rounded-xl border border-border bg-surface-raised p-3 text-sm" role="status">{message}</div> : null}
    {!overview && busy ? <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Memuat daftar Admin Platform...</p> : null}

    {overview ? <div className="mt-6 grid gap-6 xl:grid-cols-2">
      <section className="rounded-2xl border border-border bg-surface-raised p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold"><ShieldCheck className="h-5 w-5" /> Admin Platform aktif ({active.length})</h2>
        <ul className="mt-3 divide-y divide-border/60">
          {active.map((entry) => <li key={entry.person.subject} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span><strong>{name(entry.person)}</strong>{entry.person.subject === viewer ? " (Anda)" : ""}<span className="block text-xs text-muted-foreground">Sejak {formatDate(entry.grantedAt)}{entry.reason ? ` · ${entry.reason}` : ""}</span></span>
            <button className={secondary} disabled={busy} onClick={() => void revoke(entry.person)}><UserMinus className="h-4 w-4" /> Cabut</button>
          </li>)}
        </ul>
      </section>

      <section className="rounded-2xl border border-border bg-surface-raised p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold"><UserPlus className="h-5 w-5" /> Usulkan Admin Platform</h2>
        <div className="mt-4 flex gap-2"><input className={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari NIP, email, atau nama" /><button className={secondary} disabled={busy || query.trim().length < 2} onClick={() => void search()}><Search className="h-4 w-4" /> Cari</button></div>
        <div className="mt-3 space-y-2">{staff.map((entry) => <button key={entry.subject} className={staffDialog.username === entry.username ? "w-full rounded-xl border border-brand-primary/40 bg-brand-primary-pale/55 p-3 text-left text-sm" : "w-full rounded-xl border border-border p-3 text-left text-sm"} onClick={() => { setMessage(null); staffDialog.open(entry); }}><strong>{entry.displayName}</strong><span className="block text-xs text-muted-foreground">{entry.username}</span></button>)}</div>
      </section>

      <section className="rounded-2xl border border-border bg-surface-raised p-5 shadow-sm xl:col-span-2">
        <h2 className="font-display text-lg font-bold">Usulan menunggu konfirmasi ({pending.length})</h2>
        {pending.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Tidak ada usulan yang menunggu.</p> : <ul className="mt-3 divide-y divide-border/60">
          {pending.map((proposal) => {
            const ownProposal = proposal.proposedBy.subject === viewer;
            const aboutViewer = proposal.person.subject === viewer;
            return <li key={proposal.id} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span><strong>{name(proposal.person)}</strong><span className="block text-xs text-muted-foreground">Diusulkan {name(proposal.proposedBy)} · {formatDate(proposal.createdAt)} · berlaku sampai {formatDate(proposal.expiresAt)} · {proposal.reason}</span></span>
              <span className="flex gap-2">
                <button className={secondary} disabled={busy || ownProposal || aboutViewer} title={ownProposal ? "Pengusul tidak dapat mengonfirmasi usulannya sendiri" : undefined} onClick={() => void decide(proposal.id, "confirm")}><Check className="h-4 w-4" /> Konfirmasi</button>
                <button className={secondary} disabled={busy} onClick={() => void decide(proposal.id, "cancel")}><X className="h-4 w-4" /> Batalkan</button>
              </span>
            </li>;
          })}
        </ul>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-sm xl:col-span-2">
        <h2 className="p-5 pb-0 font-display text-lg font-bold">Riwayat perubahan</h2>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-muted/45 text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3.5 py-2.5">Waktu</th><th className="px-3.5 py-2.5">Oleh</th><th className="px-3.5 py-2.5">Tindakan</th><th className="px-3.5 py-2.5">Untuk</th><th className="px-3.5 py-2.5">Keterangan</th></tr></thead>
          <tbody className="divide-y divide-border/60">{audit.map((entry) => <tr key={entry.id}>
            <td className="whitespace-nowrap px-3.5 py-2.5 text-xs text-muted-foreground">{formatDate(entry.occurredAt)}</td>
            <td className="px-3.5 py-2.5 text-xs">{"ref" in entry.actor ? entry.actor.ref : name(entry.actor)}</td>
            <td className="px-3.5 py-2.5 text-xs">{actionLabels[entry.action] ?? entry.action}{entry.outcome !== "succeeded" ? ` (${entry.outcome})` : ""}</td>
            <td className="px-3.5 py-2.5 text-xs">{entry.target ? name(entry.target) : "—"}</td>
            <td className="max-w-sm px-3.5 py-2.5 text-xs text-muted-foreground">{[entry.proposedBy ? `diusulkan ${name(entry.proposedBy)}` : null, entry.reason].filter(Boolean).join(" · ")}</td>
          </tr>)}</tbody></table></div>
      </section>
    </div> : null}

    {staffDialog.username ? <DetailDialog title="Usulkan Admin Platform" description={selected ? `${selected.displayName} (${selected.username})` : undefined} onClose={staffDialog.close}>
      {message ? <div className="mb-3 rounded-xl border border-border bg-surface-raised p-3 text-sm" role="status">{message}</div> : null}
      {staffDialog.status === "loading" ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Mencari orang di Akun SQ...</p> : null}
      {staffDialog.status === "missing" ? <p className="text-sm text-muted-foreground">Tidak ada Akun SQ dengan nama pengguna pada tautan ini. Tutup lalu cari ulang.</p> : null}
      {staffDialog.status === "error" ? <p className="text-sm text-muted-foreground">Data orang ini belum dapat dimuat. Tutup lalu coba lagi beberapa saat.</p> : null}
      {selected ? <><p className="text-sm leading-6 text-muted-foreground">Admin Platform lain harus mengonfirmasi usulan ini dalam 7 hari.</p><textarea className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Alasan pengangkatan (wajib), misalnya nomor SK" /><button className={primary} disabled={busy || !reason.trim()} onClick={() => void propose()}><UserPlus className="h-4 w-4" /> Usulkan {selected.displayName}</button></> : null}
    </DetailDialog> : null}
  </AppShell>;
}

function name(person: PlatformAdministratorPerson) {
  return person.displayName ? `${person.displayName}${person.username ? ` (${person.username})` : ""}` : person.subject;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const input = "mt-1.5 w-full rounded-xl border border-border bg-surface-raised px-3 py-2.5 text-sm outline-none focus:border-brand-primary/50";
const primary = "mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-brand-foreground disabled:opacity-50";
const secondary = "inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-2 text-xs font-bold disabled:opacity-50";
