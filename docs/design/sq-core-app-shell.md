# SQ Core app shell

**Status:** ACCEPTED by the Product Owner on 2026-10-16. Every SQ Core app follows it (SQ Hub, HCIS, Aset SQ, and future apps).

**Part of:** [SQ Core design system, direction C](sq-core-design-system-c.md), which covers colour, type, logo and components. This document covers the **shell**: where account, app switching, the way back to SQ Hub, and admin areas live.

**Mockup:** "SQ Core Design System Mockup", artboards 5a–5e (private design canvas).

## Why

After the direction C rollout (2026-10-16) the apps shared colours but not structure:

- Aset SQ put a profile card and Keluar at the bottom of its sidebar, covering the last menu items, and had no way back to SQ Hub.
- HCIS showed the account twice, once at the top right and once as a card at the bottom left.
- HCIS reached its admin area through a "Administrasi HCIS" link next to the avatar, and returned from it through a different control in a different place.

## Anatomy (desktop, 1024 px and wider)

```
┌───────────────────────────────────────────────────────────────────────┐
│ [1 Logo app] [2 Ruang pegawai | Administrasi]      [3 🔔] [4 ⋮⋮⋮] [5 Akun ▾] │  header 64 px
├──────────────┬────────────────────────────────────────────────────────┤
│ 6 Sidebar    │ Breadcrumb                                             │
│   navigation │ Page title                                             │
│   only       │ Page content                                           │
└──────────────┴────────────────────────────────────────────────────────┘
```

| # | Element | Rule |
| --- | --- | --- |
| 1 | **App logo** | Star mark, app name, and gold wordmark (`BrandLockup`). Links to the app's home. |
| 2 | **Space switcher** ("Pindah ruang") | Segmented control directly right of the logo: `Ruang pegawai` / `Administrasi`. Shown only to users with admin rights in that app, and only in apps that have an admin area. It is **the only** way into and out of admin. The selected segment shows where you are. |
| 3 | **Notifications** | Bell icon button with a dot for unread items. Scoped to this app. |
| 4 | **App launcher** | 3×3 dot icon. The panel lists **SQ Hub first** ("Beranda semua aplikasi Anda"), then the user's apps as a 3-column icon grid in their category colours, with the current app marked. It is the same in every app, so the way back to SQ Hub never disappears. |
| 5 | **Account menu** | Avatar + name + role, opening a menu with: identity block (name, masked NIP, unit, role badges), **Akun SQ** (profile, security, sessions; opens SQ Hub `/account`), **Tampilan** (Terang · Gelap · Sistem), **Bantuan**, then **Keluar** (danger tone, separated). This is the **only** place for account, role and sign-out. |
| 6 | **Sidebar** | 248 px, below the header, scrolls independently. **Navigation only:** grouped links with small uppercase group labels, category dots, counts as badges. No profile card, Keluar button, app description or info boxes. |

Fixed order on the right of the header: **Notifications → Launcher → Account**. Apps may add a search field to the left of notifications. They must not add other controls there.

### Admin area

- Uses the same shell, logo, header and launcher. Only the sidebar contents and the selected segment change.
- The breadcrumb starts with "Administrasi".
- The account menu shows the admin role badge (for example "Administrator HCIS").
- Do not add "Kembali ke ruang pegawai" links in pages or the sidebar; the switcher is the way back.

### Apps without an admin area

Aset SQ and SQ Hub's ordinary users get the same header without the switcher (artboard 5e). Platform administration in SQ Hub follows the admin-area rules and uses the switcher once its Admin Center is reached from the Hub shell.

## Phones (below 768 px)

| Element | Rule |
| --- | --- |
| Header | 56 px: compact logo, notifications, launcher, avatar. No switcher in the header. |
| Bottom navigation | Floating rounded bar with at most 5 destinations. The last one is **Lainnya**. |
| Lainnya sheet | Bottom sheet: **Pindah ruang** at the top (when allowed), then every remaining menu item. |
| Account | Tapping the avatar opens the account menu as a bottom sheet with the same items as desktop. |
| Admin on phones | Switching to Administrasi swaps the bottom navigation to admin destinations (for example Ringkasan, Pegawai, Kehadiran, Cuti, Lainnya). |

Between 768 and 1023 px the sidebar collapses to an icon rail (56 px) with labels in tooltips. The header stays as on desktop.

## Not allowed

- Profile cards, avatars or Keluar buttons inside the sidebar.
- Info or explanation boxes in the sidebar.
- Admin entry or exit controls anywhere except the space switcher.
- An app without the launcher, which is the way back to SQ Hub.
- A second, app-specific account menu.

## States and accessibility

- The switcher is a real tab list (`role="tablist"`). Both segments are links to the space's home, so they work without JavaScript and in new tabs.
- Launcher and account menu are menus that close on Escape and on outside click, and return focus to their button.
- All header controls are at least 40 × 40 px. Phone touch targets are at least 44 px.
- Dark mode uses the same structure with direction C dark tokens.

## Rollout

| App | Change |
| --- | --- |
| SQ Hub | Add the sidebar; keep the header. Show the account menu items above. The switcher appears for platform administrators once Admin Center uses this shell. |
| HCIS | Remove the sidebar profile card and the header "Administrasi HCIS" link. Add the switcher. Make employee and admin shells one shell with two sidebars. |
| Aset SQ | Remove the sidebar profile card, Keluar button and "Aset SQ" info box. Add the header with notifications, launcher and account menu. |

Each app ships this as one PR referencing this document, with light and dark screenshots of desktop, the admin area (where present), and 390 px with the Lainnya sheet open.
