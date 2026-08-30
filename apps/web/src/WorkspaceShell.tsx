import {
  AppWindow,
  Grid2X2,
  Home,
  LockKeyhole,
  ShieldEllipsis,
  Sparkles,
} from "lucide-react";

import { AccountMenu } from "@/components/AccountMenu";
import { AdminCenterPanel } from "@/components/AdminCenterPanel";
import { ApplicationCard } from "@/components/ApplicationCard";
import { BrandLockup } from "@/components/BrandLockup";
import type { AdminAccessState, WorkspaceSnapshot } from "@/types";

interface WorkspaceShellProps {
  workspace: WorkspaceSnapshot;
  preview?: boolean;
  view?: "workspace" | "admin";
  adminState?: AdminAccessState;
  onLogout?: () => void | Promise<void>;
}

function ReservedAdminItem({ mobile = false }: { mobile?: boolean }) {
  if (mobile) {
    return (
      <button
        type="button"
        disabled
        className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-semibold text-muted-foreground opacity-60"
        aria-label="Administrasi SQ, segera"
      >
        <ShieldEllipsis className="h-5 w-5" aria-hidden="true" />
        <span>Admin</span>
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold text-muted-foreground opacity-65"
      aria-label="Administrasi SQ, segera"
    >
      <ShieldEllipsis className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="min-w-0 flex-1">Administrasi SQ</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide">Segera</span>
    </div>
  );
}

function AdminNavItem({ mobile = false, current = false }: { mobile?: boolean; current?: boolean }) {
  if (mobile) {
    return (
      <a
        href="/admin"
        className={
          current
            ? "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl bg-brand-primary-pale px-2 py-2 text-[10px] font-bold text-brand-primary-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            : "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        }
        aria-current={current ? "page" : undefined}
      >
        <ShieldEllipsis className="h-5 w-5" aria-hidden="true" />
        <span>Admin</span>
      </a>
    );
  }

  return (
    <a
      href="/admin"
      className={
        current
          ? "flex items-center gap-3 rounded-2xl bg-brand-primary-pale px-3.5 py-3 text-sm font-bold text-brand-primary-deep ring-1 ring-brand-primary/10"
          : "flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
      aria-current={current ? "page" : undefined}
    >
      <ShieldEllipsis className="h-[18px] w-[18px]" aria-hidden="true" />
      <span>Administrasi SQ</span>
    </a>
  );
}

export function WorkspaceShell({
  workspace,
  preview = false,
  view = "workspace",
  adminState,
  onLogout,
}: WorkspaceShellProps) {
  const { user } = workspace;
  const isAdmin = view === "admin";
  const canAdmin = workspace.capabilities.platformAdministration;
  const homeHref = isAdmin ? "/" : "#home";
  const appsHref = isAdmin ? "/#apps" : "#apps";

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-border/65 bg-sidebar/95 px-5 py-6 backdrop-blur-xl lg:flex lg:flex-col">
        <BrandLockup />

        <nav className="mt-9 space-y-1.5" aria-label="Navigasi SQ Hub">
          <a
            href={homeHref}
            className={
              !isAdmin
                ? "flex items-center gap-3 rounded-2xl bg-brand-primary-pale px-3.5 py-3 text-sm font-bold text-brand-primary-deep ring-1 ring-brand-primary/10"
                : "flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            }
            aria-current={!isAdmin ? "page" : undefined}
          >
            <Home className="h-[18px] w-[18px]" aria-hidden="true" />
            Beranda
          </a>
          <a
            href={appsHref}
            className="flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Grid2X2 className="h-[18px] w-[18px]" aria-hidden="true" />
            Aplikasi Saya
          </a>
        </nav>

        {canAdmin || preview ? (
          <div className="mt-7">
            <p className="px-3.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Platform</p>
            <div className="mt-2">
              {canAdmin ? <AdminNavItem current={isAdmin} /> : <ReservedAdminItem />}
            </div>
          </div>
        ) : null}

        <div className="mt-auto pt-6">
          <div className="mb-3 rounded-2xl bg-brand-primary-pale/65 px-3.5 py-3 text-[11px] leading-5 text-brand-primary-deep">
            <span className="flex items-center gap-2 font-bold">
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              SQ Identity
            </span>
            <span className="mt-1 block text-brand-primary-deep/75">
              Login dan keamanan akun dikelola terpusat.
            </span>
          </div>
          <AccountMenu user={user} variant="sidebar" onLogout={onLogout} />
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-border/55 bg-background/88 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="lg:hidden">
              <BrandLockup compact />
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                {isAdmin ? "Administrasi platform" : "Ruang kerja internal"}
              </p>
              <h1 className="truncate font-display text-xl font-bold tracking-[-0.02em] text-brand-heading">
                {isAdmin ? "Administrasi SQ" : "Beranda"}
              </h1>
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

        <main id={isAdmin ? "admin" : "home"} className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
          {isAdmin && adminState ? (
            <AdminCenterPanel state={adminState} onReauthenticate={onLogout} />
          ) : (
            <WorkspaceHome workspace={workspace} />
          )}
        </main>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-30 flex items-center gap-1 rounded-3xl border border-border/75 bg-white/95 p-1.5 shadow-[var(--shadow-raised)] backdrop-blur-xl lg:hidden" aria-label="Navigasi mobile SQ Hub">
        <a
          href={homeHref}
          className={
            !isAdmin
              ? "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl bg-brand-primary-pale px-2 py-2 text-[10px] font-bold text-brand-primary-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              : "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          }
          aria-current={!isAdmin ? "page" : undefined}
        >
          <Home className="h-5 w-5" aria-hidden="true" />
          <span>Beranda</span>
        </a>
        <a
          href={appsHref}
          className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Grid2X2 className="h-5 w-5" aria-hidden="true" />
          <span>Aplikasi</span>
        </a>
        {canAdmin ? <AdminNavItem mobile current={isAdmin} /> : preview ? <ReservedAdminItem mobile /> : null}
      </nav>
    </div>
  );
}

function WorkspaceHome({ workspace }: { workspace: WorkspaceSnapshot }) {
  const { user, applications } = workspace;

  return (
    <>
      <section className="relative overflow-hidden rounded-[2rem] border border-brand-primary/15 bg-brand-primary px-6 py-7 text-white shadow-[var(--shadow-brand-card)] sm:px-8 sm:py-9 lg:px-10">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-brand-cyan/30 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-brand-yellow/20 blur-3xl" aria-hidden="true" />

        <div className="relative max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/12 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/90">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            SQ Hub
          </span>
          <h2 className="mt-5 font-display text-3xl font-bold leading-tight tracking-[-0.035em] sm:text-4xl lg:text-5xl">
            Assalamu&apos;alaikum, {user.displayName}.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80 sm:text-base sm:leading-7">
            Akses aplikasi kerja Sabilul Qur&apos;an dari satu tempat. Yang tampil di sini mengikuti akses aplikasi yang diberikan kepada akun Anda.
          </p>
        </div>
      </section>

      <section id="apps" className="scroll-mt-24 pt-9 sm:pt-11" aria-labelledby="applications-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-primary-deep">Workspace</p>
            <h2 id="applications-heading" className="mt-1 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading sm:text-3xl">
              Aplikasi Saya
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Aplikasi yang tersedia untuk identitas SQ Anda. Hak di dalam masing-masing aplikasi tetap mengikuti aturan aplikasi tersebut.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 self-start rounded-2xl border border-border/70 bg-white px-3.5 py-2.5 text-xs font-semibold text-muted-foreground shadow-[var(--shadow-soft)] sm:self-auto">
            <AppWindow className="h-4 w-4 text-brand-primary-deep" aria-hidden="true" />
            {applications.length} aplikasi tersedia
          </div>
        </div>

        {applications.length > 0 ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {applications.map((application) => (
              <ApplicationCard key={application.key} application={application} />
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-3xl border border-dashed border-border bg-white/70 px-6 py-12 text-center shadow-[var(--shadow-soft)]">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Grid2X2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <h3 className="mt-4 font-display text-xl font-bold text-brand-heading">Belum ada aplikasi</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Belum ada Application Access aktif untuk akun ini. Hubungi administrator SQ bila Anda memerlukan akses aplikasi kerja.
            </p>
          </div>
        )}
      </section>

      <section className="mt-9 grid gap-4 md:grid-cols-2" aria-label="Informasi SQ Hub">
        <div className="rounded-3xl border border-border/70 bg-white p-5 shadow-[var(--shadow-soft)]">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-primary-pale text-brand-primary-deep">
            <LockKeyhole className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <h3 className="mt-4 font-display text-lg font-bold text-brand-heading">Satu identitas untuk aplikasi internal</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            SQ Identity menangani autentikasi. SQ Hub mengatur akses aplikasi, sementara izin kerja spesifik tetap dimiliki aplikasi masing-masing.
          </p>
        </div>
        <div className="rounded-3xl border border-border/70 bg-white p-5 shadow-[var(--shadow-soft)]">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-yellow/25 text-foreground">
            <ShieldEllipsis className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <h3 className="mt-4 font-display text-lg font-bold text-brand-heading">Administrasi tetap terpisah</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Administrasi platform memiliki batas kewenangan sendiri dan tidak otomatis memberi akses penuh ke data bisnis setiap aplikasi.
          </p>
        </div>
      </section>
    </>
  );
}
