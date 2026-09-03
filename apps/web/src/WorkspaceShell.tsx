import { AppWindow, Grid2X2, Home, ShieldEllipsis } from "lucide-react";

import { AccountMenu } from "@/components/AccountMenu";
import { ApplicationCard } from "@/components/ApplicationCard";
import { BrandLockup } from "@/components/BrandLockup";
import type { WorkspaceSnapshot } from "@/types";

interface WorkspaceShellProps {
  workspace: WorkspaceSnapshot;
  preview?: boolean;
  onLogout?: () => void | Promise<void>;
}

function DesktopNavigationLink({ href, label, icon: Icon, active = false }: { href: string; label: string; icon: typeof Home; active?: boolean }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-brand-primary-pale text-brand-primary-deep shadow-[var(--shadow-soft)]" : "text-muted-foreground hover:bg-white hover:text-foreground",
      ].join(" ")}
    >
      <span className={[
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
        active ? "bg-white text-brand-primary shadow-[var(--shadow-soft)]" : "bg-muted/70 text-muted-foreground group-hover:bg-brand-primary-pale",
      ].join(" ")}>
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">{label}</span>
    </a>
  );
}

function MobileNavigationLink({ href, label, icon: Icon, active = false }: { href: string; label: string; icon: typeof Home; active?: boolean }) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-brand-primary-pale text-brand-primary-deep" : "text-muted-foreground",
      ].join(" ")}
    >
      <Icon className="h-[19px] w-[19px]" aria-hidden="true" />
      <span>{label}</span>
    </a>
  );
}

export function WorkspaceShell({ workspace, preview = false, onLogout }: WorkspaceShellProps) {
  const { user, applications, capabilities } = workspace;

  return (
    <div className="min-h-screen bg-surface text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-border/80 bg-sidebar/95 px-5 py-6 lg:flex lg:flex-col">
        <BrandLockup />
        <nav className="mt-8 flex-1 space-y-1.5" aria-label="Navigasi SQ Hub">
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">Ruang kerja</p>
          <DesktopNavigationLink href="#home" label="Beranda" icon={Home} active />
          <DesktopNavigationLink href="#apps" label="Aplikasi Saya" icon={Grid2X2} />
          {capabilities.platformAdministration ? (
            <div className="pt-6">
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">Platform</p>
              <DesktopNavigationLink href="/admin" label="Administrasi SQ" icon={ShieldEllipsis} />
            </div>
          ) : null}
        </nav>
        <AccountMenu user={user} variant="sidebar" onLogout={onLogout} />
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-border/70 bg-surface/92 px-4 py-3 backdrop-blur-sm sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="lg:hidden"><BrandLockup compact /></div>
            <p className="hidden text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground lg:block">Ruang kerja internal</p>
            <div className="flex items-center gap-2">
              {preview ? <span className="hidden rounded-full bg-brand-yellow/18 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-foreground/70 sm:inline-flex">Preview desain</span> : null}
              <AccountMenu user={user} variant="header" onLogout={onLogout} />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-10">
          <section id="home" className="scroll-mt-20" aria-labelledby="workspace-heading">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-primary-deep">SQ Hub</p>
            <div className="mt-1.5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-2xl">
                <h1 id="workspace-heading" className="font-display text-3xl font-bold tracking-[-0.03em] text-brand-heading sm:text-[2.2rem]">Aplikasi Saya</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-[0.95rem]">Assalamu&apos;alaikum, {user.displayName}. Buka aplikasi kerja yang tersedia untuk Akun SQ Anda.</p>
              </div>
              <div className="inline-flex items-center gap-2 self-start rounded-2xl border border-border/70 bg-white px-3.5 py-2.5 text-xs font-semibold text-muted-foreground shadow-[var(--shadow-soft)] sm:self-auto">
                <AppWindow className="h-4 w-4 text-brand-primary-deep" aria-hidden="true" />
                {applications.length} aplikasi tersedia
              </div>
            </div>
          </section>

          <section id="apps" className="scroll-mt-20 pt-6 sm:pt-7" aria-label="Daftar aplikasi saya">
            {applications.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {applications.map((application) => <ApplicationCard key={application.key} application={application} />)}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-border/80 bg-white px-6 py-10 text-center shadow-[var(--shadow-soft)]">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground"><Grid2X2 className="h-5 w-5" aria-hidden="true" /></div>
                <h2 className="mt-3 font-display text-lg font-bold text-brand-heading">Belum ada aplikasi</h2>
                <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">Belum ada akses aplikasi aktif untuk akun ini. Hubungi administrator SQ bila Anda memerlukan akses.</p>
              </div>
            )}
          </section>

          <section className="mt-7 rounded-3xl border border-border/70 bg-white px-5 py-4 shadow-[var(--shadow-soft)]" aria-label="Batas akses aplikasi">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-brand-heading">Akun SQ untuk masuk, aplikasi untuk kewenangan kerja</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">SQ Hub membuka pintu aplikasi sesuai Application Access. Role dan permission bisnis tetap dikelola oleh aplikasi masing-masing.</p>
              </div>
              {capabilities.platformAdministration ? <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-brand-primary-pale px-3 py-1.5 text-xs font-bold text-brand-primary-deep sm:self-auto"><ShieldEllipsis className="h-4 w-4" aria-hidden="true" />Platform Administrator</span> : null}
            </div>
          </section>
        </main>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-40 flex rounded-[1.75rem] border border-border/80 bg-white/96 p-1.5 shadow-[var(--shadow-raised)] backdrop-blur lg:hidden" aria-label="Navigasi mobile SQ Hub">
        <MobileNavigationLink href="#home" label="Beranda" icon={Home} active />
        <MobileNavigationLink href="#apps" label="Aplikasi" icon={Grid2X2} />
        {capabilities.platformAdministration ? <MobileNavigationLink href="/admin" label="Admin" icon={ShieldEllipsis} /> : null}
      </nav>
    </div>
  );
}
