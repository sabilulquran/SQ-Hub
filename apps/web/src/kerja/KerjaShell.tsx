import { Bell, CheckCheck, FolderKanban, ListChecks, LogOut, Settings2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { AppLauncher } from "@/components/AppLauncher";
import { BrandLockup } from "@/components/BrandLockup";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useDismiss } from "@/components/useDismiss";
import { kerjaFetch, type Notifikasi } from "@/kerja/api";
import { formatTanggal, NOTIFIKASI } from "@/kerja/format";
import type { KerjaRoute } from "@/kerja/routes";
import { Link } from "@/kerja/ui";
import type { WorkspaceApplication } from "@/types";

/** Kerja's own launcher tile when SQ Hub's list is unavailable or leaves it out (HUB-IMPL-022). */
const KERJA_LAUNCHER_APPLICATION: WorkspaceApplication = { key: "kerja-sq", name: "Kerja", canonicalUrl: "/" };

type NavKey = "tugas" | "ruang" | "admin";

function navKey(route: KerjaRoute): NavKey | null {
  if (route.name === "tugas") return "tugas";
  if (route.name === "admin") return "admin";
  if (route.name === "not-found") return null;
  return "ruang";
}

/**
 * SQ Core shell for Kerja (KERJA-IMPL-001 §8, D-8): "Kerja" lockup, Tugas Saya first, the same
 * tokens and themes as Hub. Tabs stay in one row at 390 px.
 */
export function KerjaShell({
  route,
  displayName,
  pengelola = false,
  launcherApplications,
  onLogout,
  showNotifications = false,
  children,
}: {
  route: KerjaRoute;
  displayName?: string;
  pengelola?: boolean;
  launcherApplications?: WorkspaceApplication[] | null;
  onLogout?: () => void | Promise<void>;
  showNotifications?: boolean;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const active = navKey(route);
  const items: Array<{ key: NavKey; label: string; href: string; icon: typeof ListChecks }> = [
    { key: "tugas", label: "Tugas saya", href: "/", icon: ListChecks },
    { key: "ruang", label: "Ruang", href: "/ruang", icon: FolderKanban },
    ...(pengelola ? [{ key: "admin" as const, label: "Pengelola", href: "/pengelola", icon: Settings2 }] : []),
  ];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-surface-raised">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 md:h-16 sm:px-6 lg:px-8">
          <Link href="/" className="min-w-0 shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span aria-label="Beranda Kerja"><BrandLockup compact appName="Kerja" /></span>
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            {/* sq-core-app-shell.md: Notifications → Launcher → Account. */}
            {showNotifications ? <NotificationBell /> : null}
            <AppLauncher
              applications={launcherApplications ?? []}
              current={launcherApplications?.find((application) => application.key === KERJA_LAUNCHER_APPLICATION.key) ?? KERJA_LAUNCHER_APPLICATION}
            />
            {displayName ? <span className="hidden max-w-[12rem] truncate text-sm font-semibold text-muted-foreground md:inline">{displayName}</span> : null}
            {onLogout ? (
              <button
                type="button"
                disabled={busy}
                aria-label="Keluar"
                onClick={() => {
                  setBusy(true);
                  void Promise.resolve(onLogout()).finally(() => setBusy(false));
                }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-bold text-brand-primary-deep disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Keluar</span>
              </button>
            ) : null}
          </div>
        </div>
        <nav aria-label="Navigasi Kerja" className="mx-auto flex w-full max-w-7xl gap-1 px-4 pb-2 sm:px-6 lg:px-8">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                ariaCurrent={item.key === active}
                className={[
                  "inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-center text-sm leading-tight sm:flex-none sm:px-3",
                  item.key === active ? "bg-brand-primary-pale font-semibold text-brand-primary-deep" : "font-medium text-muted-foreground transition-colors hover:bg-muted",
                ].join(" ")}
              >
                <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden="true" />
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

/** §6.4: in-app reminders and assignments. Polled every two minutes while the page is open. */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ belumDibaca: number; items: Notifikasi[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref, triggerRef);

  useEffect(() => {
    let alive = true;
    const load = () => kerjaFetch<{ belumDibaca: number; items: Notifikasi[] }>("/notifikasi").then((body) => alive && setData(body)).catch(() => undefined);
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 120_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const unread = data?.belumDibaca ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={unread > 0 ? `Pemberitahuan, ${unread} belum dibaca` : "Pemberitahuan"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-brand-primary-deep hover:bg-muted"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unread > 0 ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-brand-orange px-1 text-[10px] font-bold leading-5 text-white">{unread > 9 ? "9+" : unread}</span> : null}
      </button>
      {open ? (
        <div className="fixed inset-x-3 top-16 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-border bg-surface-raised p-2 shadow-[var(--shadow-raised)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-bold text-brand-heading">Pemberitahuan</p>
            {unread > 0 ? (
              <button type="button" className="inline-flex items-center gap-1 text-xs font-bold text-brand-primary-deep" onClick={() => void kerjaFetch<typeof data>("/notifikasi/dibaca", { method: "POST" }).then(setData)}>
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" /> Tandai semua dibaca
              </button>
            ) : null}
          </div>
          {data && data.items.length === 0 ? <p className="px-2 py-6 text-center text-sm text-muted-foreground">Belum ada pemberitahuan. Pengingat tenggat dan penugasan muncul di sini.</p> : null}
          <ul className="space-y-1">
            {data?.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/kartu/${item.kartuId}`}
                  onNavigate={() => {
                    setOpen(false);
                    if (!item.dibaca) void kerjaFetch<typeof data>(`/notifikasi/${item.id}/dibaca`, { method: "POST" }).then(setData);
                  }}
                  className={`block rounded-xl px-3 py-2 hover:bg-muted ${item.dibaca ? "" : "bg-brand-primary-pale/50"}`}
                >
                  <span className="block text-xs font-bold text-brand-primary-deep">{NOTIFIKASI[item.jenis]}</span>
                  <span className="block truncate text-sm font-semibold text-foreground">{item.judul}</span>
                  <span className="block text-xs text-muted-foreground">{item.ruang} · {formatTanggal(item.dibuatPada)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
