import {
  AppWindow,
  Grid2X2,
  Home,
  LockKeyhole,
  ShieldEllipsis,
  Sparkles,
} from "lucide-react";

import { AccountMenu } from "@/components/AccountMenu";
import { ApplicationCard } from "@/components/ApplicationCard";
import { BrandLockup } from "@/components/BrandLockup";
import type { WorkspaceSnapshot } from "@/types";

interface WorkspaceShellProps {
  workspace: WorkspaceSnapshot;
  preview?: boolean;
  onLogout?: () => void | Promise<void>;
}

function AdminNavItem({ mobile = false }: { mobile?: boolean }) {
  if (mobile) {
    return (
      <a
        href="/admin"
        className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-semibold text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Administrasi SQ"
      >
        <ShieldEllipsis className="h-5 w-5" aria-hidden="true" />
        <span>Admin</span>
      </a>
    );
  }

  return (
    <a
      href="/admin"
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground transition hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ShieldEllipsis className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="min-w-0 flex-1">Administrasi SQ</span>
    </a>
  );
}

export function WorkspaceShell({ workspace, preview = false, onLogout }: WorkspaceShellProps) {
  const { user, applications, capabilities } = workspace;

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border/65 bg-sidebar/95 px-4 py-5 backdrop-blur-xl lg:flex lg:flex-col">
        <BrandLockup />

        <nav className="mt-7 space-y-1" aria-label="Navigasi SQ Hub">
          <a
            href="#home"
            className="flex items-center gap-3 rounded-xl bg-brand-primary-pale px-3 py-2.5 text-sm font-bold text-brand-primary-deep ring-1 ring-brand-primary/10"
            aria-current="page"
          >
            <Home className="h-[18px] w-[18px]" aria-hidden="true" />
            Beranda
          </a>
          <a
            href="#apps"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground transition hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Grid2X2 className="h-[18px] w-[18px]" aria-hidden="true" />
            Aplikasi Saya
          </a>
        </nav>

        {capabilities.platformAdministration ? (
          <div className="mt-6">
            <p className="px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Platform</p>
            <div className="mt-1.5">
              <AdminNavItem />
            </div>
          </div>
        ) : null}

        <div className="mt-auto pt-5">
          <div className="mb-3 rounded-xl border border-brand-primary/10 bg-brand-primary-pale/55 px-3 py-3 text-[11px] leading-5 text-brand-primary-deep">
            <span className="flex items-center gap-2 font-bold">
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              Akun SQ
            </span>
            <span className="mt-1 block text-brand-primary-deep/75">
              Login dan keamanan akun dikelola terpusat.
            </span>
          </div>
          <AccountMenu user={user} variant="sidebar" onLogout={onLogout} />
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-border/55 bg-background/90 px-4 py-2.5 backdrop-blur-xl sm:px-6 lg:px-7">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="lg:hidden">
              <BrandLockup compact />
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Ruang kerja internal</p>
              <h1 className="truncate font-display text-lg font-bold tracking-[-0.02em] text-brand-heading">SQ Hub</h1>
            </div>

            <div className="flex items-center gap-2">
              {preview ? (
                <span className="hidden rounded-full bg-brand-yellow/25 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-foreground/70 sm:inline-flex">
                  Preview desain
                </span>
              ) : null}
              <AccountMenu user={user} variant="header" onLogout={onLogout} />
            </div>
          </div>
        </header>

        <main id="home" className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 sm:pt-6 lg:px-7 lg:pb-10">
          <section className="relative overflow-hidden rounded-3xl border border-brand-primary/15 bg-brand-primary px-6 py-7 text-white shadow-[var(--shadow-soft)] sm:px-8 sm:py-8">
            <div className="pointer-events-none absolute -right-20 -top-28 h-64 w-64 rounded-full bg-brand-cyan/25 blur-3xl" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-brand-yellow/15 blur-3xl" aria-hidden="true" />

            <div className="relative max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/90">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Ruang kerja SQ
              </span>
              <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-[-0.03em] sm:text-4xl">
                Assalamu&apos;alaikum, {user.displayName}.
              </h2>
              <p className="mt-2.5 max-w-2xl text-sm leading-6 text-white/80 sm:text-base">
                Buka aplikasi kerja Sabilul Qur&apos;an dari satu tempat. Daftar di bawah mengikuti akses yang diberikan kepada akun Anda.
              </p>
            </div>
          </section>

          <section id="apps" className="scroll-mt-20 pt-7 sm:pt-8" aria-labelledby="applications-heading">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-brand-primary-deep">Workspace</p>
                <h2 id="applications-heading" className="mt-1 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading sm:text-[1.75rem]">
                  Aplikasi Saya
                </h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Hak di dalam setiap aplikasi tetap mengikuti aturan aplikasi tersebut.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 self-start rounded-xl border border-border/70 bg-white px-3 py-2 text-xs font-semibold text-muted-foreground shadow-[var(--shadow-soft)] sm:self-auto">
                <AppWindow className="h-4 w-4 text-brand-primary-deep" aria-hidden="true" />
                {applications.length} aplikasi tersedia
              </div>
            </div>

            {applications.length > 0 ? (
              <div className="mt-5 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {applications.map((application) => (
                  <ApplicationCard key={application.key} application={application} />
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-border bg-white/70 px-6 py-10 text-center shadow-[var(--shadow-soft)]">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Grid2X2 className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mt-3 font-display text-lg font-bold text-brand-heading">Belum ada aplikasi</h3>
                <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
                  Belum ada akses aplikasi aktif untuk akun ini. Hubungi administrator SQ bila Anda memerlukan akses.
                </p>
              </div>
            )}
          </section>

          <section className="mt-7 rounded-2xl border border-border/70 bg-white px-5 py-4 shadow-[var(--shadow-soft)]" aria-label="Informasi akun dan akses">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
                  <LockKeyhole className="h-[17px] w-[17px]" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-display text-base font-bold text-brand-heading">Akun SQ untuk login, SQ Hub untuk akses aplikasi</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Akun SQ menangani autentikasi. Izin kerja spesifik tetap dimiliki oleh masing-masing aplikasi.
                  </p>
                </div>
              </div>
              {capabilities.platformAdministration ? (
                <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-brand-primary-pale px-3 py-1.5 text-xs font-bold text-brand-primary-deep">
                  <ShieldEllipsis className="h-4 w-4" aria-hidden="true" />
                  Platform Administrator
                </span>
              ) : null}
            </div>
          </section>
        </main>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-30 flex items-center gap-1 rounded-2xl border border-border/75 bg-white/95 p-1.5 shadow-[var(--shadow-raised)] backdrop-blur-xl lg:hidden" aria-label="Navigasi mobile SQ Hub">
        <a
          href="#home"
          className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl bg-brand-primary-pale px-2 py-2 text-[10px] font-bold text-brand-primary-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-current="page"
        >
          <Home className="h-5 w-5" aria-hidden="true" />
          <span>Beranda</span>
        </a>
        <a
          href="#apps"
          className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Grid2X2 className="h-5 w-5" aria-hidden="true" />
          <span>Aplikasi</span>
        </a>
        {capabilities.platformAdministration ? <AdminNavItem mobile /> : null}
      </nav>
    </div>
  );
}
