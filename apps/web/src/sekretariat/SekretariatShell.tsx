import {
  BookText, Ellipsis, FileStack, Inbox, KeyRound, Landmark, ListOrdered, Mail, Send, UserCheck, Users, type LucideIcon,
} from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";

import { AccountMenu } from "@/components/AccountMenu";
import { AppLauncher } from "@/components/AppLauncher";
import { BrandLockup } from "@/components/BrandLockup";
import { useDismiss } from "@/components/useDismiss";
import type { KotakRingkas } from "@/sekretariat/api";
import { kotakLabel } from "@/sekretariat/format";
import type { SekretariatRoute } from "@/sekretariat/routes";
import { Link } from "@/sekretariat/ui";
import type { WorkspaceApplication } from "@/types";

/** Sekretariat's own launcher tile when SQ Hub's list is unavailable (HUB-IMPL-022). */
const SEKRETARIAT_LAUNCHER_APPLICATION: WorkspaceApplication = { key: "sekretariat-sq", name: "Sekretariat", canonicalUrl: "/" };
const HUB_ACCOUNT_URL = "https://hub.sabilulquran.or.id/account";

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  count?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  /** Inboxes beyond the busy ones, folded behind "Kotak lain" so 18 inboxes do not bury the rest. */
  more?: NavItem[];
}

function activeKey(route: SekretariatRoute, defaultKotakId: string | null): string | null {
  switch (route.name) {
    case "beranda": return defaultKotakId ? `kotak:${defaultKotakId}` : null;
    case "kotak": return `kotak:${route.kotakId}`;
    case "surat-keluar":
    case "penerbit-surat":
    case "surat": return "surat-keluar";
    case "buku": return "buku";
    case "pengaturan": return `pengaturan:${route.bagian}`;
    default: return null;
  }
}

/**
 * SEK-IMPL-003: Sekretariat in the SQ Suite shell (docs/design/sq-core-app-shell.md) — header with
 * logo, launcher and the account menu; a navigation-only sidebar of 248 px (an icon rail from 768
 * to 1023 px); a bottom bar on phones. The sidebar doubles as the folder list of a mail client:
 * every inbox the viewer may open, with its unread count.
 */
export function SekretariatShell({
  route,
  displayName,
  pengelola = false,
  kotak,
  launcherApplications,
  onLogout,
  children,
}: {
  route: SekretariatRoute;
  displayName?: string;
  pengelola?: boolean;
  kotak?: KotakRingkas[] | null;
  launcherApplications?: WorkspaceApplication[] | null;
  onLogout?: () => void | Promise<void>;
  children: ReactNode;
}) {
  const defaultKotakId = kotak?.[0]?.id ?? null;
  const active = activeKey(route, defaultKotakId);
  const groups = buildGroups(kotak ?? [], pengelola, active);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-surface-raised">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4 md:h-16 lg:px-5">
          <Link href="/" className="min-w-0 shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-[13.5rem]">
            <span aria-label="Beranda Sekretariat"><BrandLockup compact appName="Sekretariat" /></span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <AppLauncher
              applications={launcherApplications ?? []}
              current={launcherApplications?.find((application) => application.key === SEKRETARIAT_LAUNCHER_APPLICATION.key) ?? SEKRETARIAT_LAUNCHER_APPLICATION}
            />
            {displayName ? (
              <AccountMenu
                user={{ displayName, initials: initialsOf(displayName), contextLabel: "Sekretariat Yayasan Sabilul Qur'an" }}
                roleLabel={pengelola ? "Pengelola Sekretariat" : "Petugas Sekretariat"}
                accountHref={HUB_ACCOUNT_URL}
                {...(onLogout ? { onLogout } : {})}
              />
            ) : null}
          </div>
        </div>
      </header>

      <Sidebar groups={groups} active={active} />

      <div className="md:pl-14 lg:pl-[248px]">
        <main className="mx-auto w-full max-w-6xl px-4 pb-32 pt-6 sm:px-6 sm:pt-8 md:pb-12 lg:px-8">{children}</main>
      </div>

      <MobileNav groups={groups} active={active} />
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase() || "?";
}

function buildGroups(kotak: KotakRingkas[], pengelola: boolean, active: string | null): NavGroup[] {
  const inbox = kotak.map((item): NavItem => ({
    key: `kotak:${item.id}`,
    label: kotakLabel(item),
    href: `/kotak/${item.id}`,
    icon: item.jenis === "yayasan" ? Inbox : Mail,
    count: item.baru,
  }));
  // The foundation inbox, any inbox with something new or an open disposition, and the one being
  // read stay visible; the quiet rest folds away. A petugas with one or two inboxes sees all.
  const busy = (item: KotakRingkas) => item.jenis === "yayasan" || item.baru > 0 || item.disposisiTerbuka > 0 || `kotak:${item.id}` === active;
  const shown = kotak.length <= 4 ? inbox : inbox.filter((_, index) => busy(kotak[index]!));
  const folded = kotak.length <= 4 ? [] : inbox.filter((_, index) => !busy(kotak[index]!));

  const groups: NavGroup[] = [
    { label: "Kotak masuk", items: shown, ...(folded.length > 0 ? { more: folded } : {}) },
    {
      label: "Surat",
      items: [
        { key: "surat-keluar", label: "Surat keluar", href: "/surat-keluar", icon: Send },
        { key: "buku", label: "Buku nomor", href: "/buku", icon: BookText },
      ],
    },
  ];
  if (pengelola) {
    groups.push({
      label: "Pengaturan",
      items: [
        { key: "pengaturan:kotak-masuk", label: "Alamat email", href: "/pengaturan/kotak-masuk", icon: KeyRound },
        { key: "pengaturan:penerbit", label: "Penerbit", href: "/pengaturan/penerbit", icon: Landmark },
        { key: "pengaturan:petugas", label: "Petugas", href: "/pengaturan/petugas", icon: Users },
        { key: "pengaturan:disposisi", label: "Pemberi disposisi", href: "/pengaturan/disposisi", icon: UserCheck },
        { key: "pengaturan:nomor-awal", label: "Nomor awal", href: "/pengaturan/nomor-awal", icon: ListOrdered },
      ],
    });
  }
  return groups;
}

function Sidebar({ groups, active }: { groups: NavGroup[]; active: string | null }) {
  const [showMore, setShowMore] = useState(false);
  return (
    <aside className="fixed bottom-0 left-0 top-16 z-30 hidden w-14 overflow-y-auto border-r border-border bg-sidebar px-2 py-4 md:block lg:w-[248px] lg:px-3">
      <nav aria-label="Navigasi Sekretariat">
        {groups.filter((group) => group.items.length > 0).map((group) => (
          <div key={group.label} className="mb-5">
            <p className="mb-1.5 hidden px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground lg:block">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => <SidebarLink key={item.key} item={item} current={item.key === active} />)}
              {group.more && showMore ? group.more.map((item) => <SidebarLink key={item.key} item={item} current={item.key === active} />) : null}
            </ul>
            {group.more ? (
              <button
                type="button"
                onClick={() => setShowMore((value) => !value)}
                aria-expanded={showMore}
                title={showMore ? "Sembunyikan kotak lain" : `Kotak lain (${group.more.length})`}
                className="mt-0.5 flex min-h-10 w-full items-center justify-center gap-3 rounded-xl px-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:justify-start lg:px-3"
              >
                <FileStack className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span className="sr-only lg:not-sr-only lg:truncate">{showMore ? "Sembunyikan kotak lain" : `Kotak lain (${group.more.length})`}</span>
              </button>
            ) : null}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function SidebarLink({ item, current }: { item: NavItem; current: boolean }) {
  const Icon = item.icon;
  const unread = (item.count ?? 0) > 0;
  return (
    <li>
      <Link
        href={item.href}
        ariaCurrent={current}
        className={[
          "flex min-h-10 items-center justify-center gap-3 rounded-xl px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:justify-start lg:px-3",
          current
            ? "bg-brand-primary-pale font-bold text-brand-primary-deep"
            : unread
              ? "font-bold text-foreground hover:bg-muted"
              : "font-semibold text-muted-foreground hover:bg-muted hover:text-foreground",
        ].join(" ")}
      >
        <span className="relative shrink-0">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          {/* On the icon rail the count has no room, so a dot says "something new" instead. */}
          {unread ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-brand-primary lg:hidden" aria-hidden="true" /> : null}
        </span>
        <span className="sr-only lg:not-sr-only lg:min-w-0 lg:flex-1 lg:truncate" title={item.label}>{item.label}</span>
        {unread ? <span className="hidden text-xs font-bold tabular-nums lg:inline">{item.count}</span> : null}
        {unread ? <span className="sr-only">{`, ${item.count} baru`}</span> : null}
      </Link>
    </li>
  );
}

/** Phones: at most four direct destinations plus "Lainnya", the shell's rule of five. */
function MobileNav({ groups, active }: { groups: NavGroup[]; active: string | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef, triggerRef);

  const inbox = groups[0]?.items ?? [];
  const firstInbox = inbox[0];
  const direct: NavItem[] = [
    ...(firstInbox ? [{ ...firstInbox, label: "Kotak masuk" }] : []),
    { key: "surat-keluar", label: "Surat keluar", href: "/surat-keluar", icon: Send },
    { key: "buku", label: "Buku nomor", href: "/buku", icon: BookText },
  ];
  const directKeys = new Set(direct.map((item) => item.key));
  const sheet = groups
    .map((group) => ({ label: group.label, items: [...group.items, ...(group.more ?? [])].filter((item) => !directKeys.has(item.key)) }))
    .filter((group) => group.items.length > 0);
  const moreActive = sheet.some((group) => group.items.some((item) => item.key === active));

  return (
    <div ref={rootRef} className="md:hidden">
      <nav
        aria-label="Navigasi Sekretariat di ponsel"
        className="fixed inset-x-3 z-40 flex rounded-2xl border border-border/80 bg-surface-raised p-1.5 shadow-[var(--shadow-raised)]"
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {direct.map((item) => {
          const Icon = item.icon;
          const current = item.key === active;
          return (
            <Link key={item.key} href={item.href} ariaCurrent={current} className={tabClass(current)}>
              <span className="relative">
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                {(item.count ?? 0) > 0 ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-brand-primary" aria-hidden="true" /> : null}
              </span>
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
        {sheet.length > 0 ? (
          <button ref={triggerRef} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={tabClass(moreActive || open)}>
            <Ellipsis className="h-[18px] w-[18px]" aria-hidden="true" />
            <span className="truncate">Lainnya</span>
          </button>
        ) : null}
      </nav>
      {open ? (
        <>
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={close} className="fixed inset-0 z-[60] cursor-default bg-black/35" />
          <div
            role="dialog"
            aria-label="Lainnya"
            className="fixed inset-x-0 bottom-0 z-[60] max-h-[80vh] overflow-y-auto rounded-t-3xl border border-border/80 bg-surface-raised p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-raised)]"
          >
            <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-border" aria-hidden="true" />
            {sheet.map((group) => (
              <section key={group.label} aria-label={group.label} className="mb-4 last:mb-0">
                <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const current = item.key === active;
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          ariaCurrent={current}
                          onNavigate={close}
                          className={[
                            "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm",
                            current ? "bg-brand-primary-pale font-bold text-brand-primary-deep" : "font-semibold text-foreground hover:bg-muted",
                          ].join(" ")}
                        >
                          <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {(item.count ?? 0) > 0 ? <span className="text-xs font-bold tabular-nums">{item.count}</span> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function tabClass(active: boolean) {
  return [
    "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "bg-brand-primary-pale text-brand-primary-deep" : "text-muted-foreground",
  ].join(" ");
}
