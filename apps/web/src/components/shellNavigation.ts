import { AppWindow, Home, KeyRound, Landmark, LayoutGrid, ShieldCheck, UserRound, UsersRound, type LucideIcon } from "lucide-react";

import type { HubSpace } from "@/components/SpaceSwitcher";

export type HubNavKey =
  | "yayasan"
  | "home"
  | "apps"
  | "account"
  | "admin-applications"
  | "admin-access"
  | "admin-audit"
  | "admin-lifecycle"
  | "admin-organ";

export interface HubNavItem {
  key: HubNavKey;
  href: string;
  label: string;
  /** Shorter label for the phone bottom navigation. */
  shortLabel: string;
  icon: LucideIcon;
}

export interface HubNavGroup {
  label: string;
  items: HubNavItem[];
}

// One sidebar per space (docs/design/sq-core-app-shell.md): the switcher only changes which one is shown.
export const navigationBySpace: Record<HubSpace, HubNavGroup[]> = {
  workspace: [
    {
      label: "Ruang kerja",
      items: [
        { key: "home", href: "/", label: "Beranda", shortLabel: "Beranda", icon: Home },
        { key: "apps", href: "/apps", label: "Semua aplikasi", shortLabel: "Aplikasi", icon: AppWindow },
        { key: "account", href: "/account", label: "Akun SQ", shortLabel: "Akun", icon: UserRound },
      ],
    },
  ],
  admin: [
    {
      label: "Platform",
      items: [
        { key: "admin-applications", href: "/admin", label: "Registry aplikasi", shortLabel: "Registry", icon: LayoutGrid },
        { key: "admin-access", href: "/admin/access", label: "Akses aplikasi", shortLabel: "Akses", icon: KeyRound },
        { key: "admin-audit", href: "/admin/audit", label: "Audit platform", shortLabel: "Audit", icon: ShieldCheck },
      ],
    },
    {
      label: "Pegawai",
      items: [
        { key: "admin-lifecycle", href: "/admin/lifecycle", label: "Pegawai masuk & keluar", shortLabel: "Pegawai", icon: UsersRound },
      ],
    },
    {
      label: "Yayasan",
      items: [
        { key: "admin-organ", href: "/admin/organ", label: "Organ Yayasan", shortLabel: "Organ", icon: Landmark },
      ],
    },
  ],
};

// HUB-IMPL-021 §5: members of an Organ Yayasan see Ringkasan Yayasan first.
const governanceItem: HubNavItem = {
  key: "yayasan",
  href: "/yayasan",
  label: "Ringkasan Yayasan",
  shortLabel: "Ringkasan",
  icon: Landmark,
};

export function navigationGroups(space: HubSpace, options: { governanceView?: boolean } = {}): HubNavGroup[] {
  const groups = navigationBySpace[space];
  if (space !== "workspace" || !options.governanceView) return groups;
  return groups.map((group, index) => (index === 0 ? { ...group, items: [governanceItem, ...group.items] } : group));
}

export function navigationItems(space: HubSpace, options: { governanceView?: boolean } = {}): HubNavItem[] {
  return navigationGroups(space, options).flatMap((group) => group.items);
}
