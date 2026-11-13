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

### Launcher list (HUB-IMPL-022)

- The list comes from SQ Hub: the same rows as Hub's own launcher (active application + active Application Access grant, ordered by name), without SQ Hub itself. Apps fetch it on their backend through `POST /internal/v1/application-access/launcher` with their existing machine client and pass it to the browser on a same-origin route. The browser never calls SQ Hub across origins and no cookie is shared across subdomains.
- Outside SQ Hub, the SQ Hub row links to `https://hub.sabilulquran.or.id` and "Lihat semua aplikasi" to `https://hub.sabilulquran.or.id/apps`. The current app's tile is marked "Di sini" and is shown even when the list is unavailable, empty or leaves it out.
- Icons and category colours per application key are listed in [HUB-IMPL-022 §6](../specs/HUB-IMPL-022-shared-app-launcher-list.md#6-key--icon-and-category-colour); apps copy that table.
- Kirim SQ follows this from HUB-IMPL-022 (launcher between the theme toggle and the account controls).

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

## Detail views open as a pop-up

**Owner decision 2026-11-13.** Opening the detail of one item (a card, a row, a person, a request, an application) or a form to edit it **never changes the page layout**. The list or board behind stays exactly where it was; the detail appears on top of it.

| Width | Form |
| --- | --- |
| 768 px and wider | Centred dialog over a dimmed backdrop. Width up to 720 px (up to 960 px for wide content such as tables), height up to 90 % of the window, with its own scroll. |
| Below 768 px | Full-screen sheet with a close button in its header; short content may use a bottom sheet instead. |

Behaviour:

- `role="dialog"` with `aria-modal="true"` and a label from the dialog's title.
- Focus moves into the dialog on open and returns to the element that opened it on close.
- Escape, the close button and a click on the backdrop close it. The page behind does not scroll while it is open.
- The open item is in the URL (for example `?kartu=<id>`), so a link opens the same dialog and the browser's Back closes it.
- A dialog does not open a second dialog on top of itself for the same purpose. Confirmations inside it (for example "Alasan") may stack once.

Still allowed in place: editing a single field inline, dropdown menus and popovers, and short confirmations (which are dialogs already).

## Not allowed

- A side panel or inline expansion that squeezes, shifts or reflows the page to show an item's detail or edit form (use the pop-up above).
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

### Detail views as pop-ups

| App | Screen | Status |
| --- | --- | --- |
| SQ Hub | Kerja card (`?kartu=<id>`) | Follows the rule. |
| SQ Hub | Admin Center: Registry aplikasi (`?aplikasi=<key>`, `?aplikasi=baru`), Akses aplikasi, Peran HCIS, Pegawai masuk & keluar and Admin Platform (`?orang=<username>`), Organ Yayasan member (`?anggota=<id>`) | Follows the rule since 2026-11-13. The URL carries the Akun SQ username, never the raw OIDC subject. Still in place by design: the "Tambah anggota" column on Organ Yayasan (a create form beside the list, not an item's detail). |

Each app ships this as one PR referencing this document, with light and dark screenshots of desktop, the admin area (where present), and 390 px with the Lainnya sheet open.
