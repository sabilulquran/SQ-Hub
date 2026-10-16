# SQ Core design system — direction C

**Status:** ACCEPTED by the Product Owner on 2026-10-16 for Akun SQ, SQ Hub, HCIS, and Aset SQ. This document records the visual decisions. Rollout happens per surface, starting with the Akun SQ login.

**Source:** owner-reviewed mockup "SQ Core Design System Mockup" (private design canvas, 2026-10-16). It covers the foundation, components, login, and the desktop and mobile shell, each in light and dark.

**Shell:** header, sidebar, account menu, app launcher and space switcher are specified in [sq-core-app-shell.md](sq-core-app-shell.md).

## Decisions

- **Direction C, multi-accent.** Teal stays the primary brand and action colour. Each service category has its own accent for icons, labels, and markers only.
- **Dark mode** is supported everywhere. It follows the device setting, and apps may offer Light, Dark, or Follow system.
- **Typeface:** Inter for all text. It ships with each surface: the login theme bundles `resources/fonts/inter-latin-wght.woff2` (SIL OFL 1.1). Do not rely on a system font. Do not let PatternFly's Red Hat faces reach titles.
- **Logo:**
  - The full foundation logo ("Islamic Tahfizh School Sabilul Qur'an") appears on sign-in, landing pages, and print. Use `logo-white.png` on dark backgrounds.
  - Inside apps, use the eight-point star mark with the app name in heavy dark sans and "SABILUL QUR'AN" in condensed gold, echoing the original wordmark.
- **Shape:** 12 px radius for controls, 16 px for cards, 24 px for sign-in panels. Controls are 44 px high, or 48 px on phones.
- **Wording:** user-facing text says "Akun SQ" (never "SQ Identity") and "kata sandi" (never "password").

## Colour roles

| Role | Light | Dark |
| --- | --- | --- |
| Background | `#F7F7F5` | `#0F1418` |
| Surface | `#FFFFFF` | `#161D22` |
| Line | `#E2E4E2` | `#2A343B` |
| Text | `#161E25` | `#E8EDEF` |
| Muted text | `#5B6873` | `#9AA7B0` |
| Primary (buttons, links, active nav) | `#0B7A79`, white text | `#2BB3B1`, `#04201F` text |
| Category: attendance | `#0B7A79` on `#DDF3F2` | `#6FD3CF` on `#12393A` |
| Category: leave | `#2563A8` on `#DCE8F7` | `#8DB8EE` on `#16283F` |
| Category: pay | `#8A6300` on `#FBEFC9` | `#F0CD5E` on `#3A2F0F` |
| Category: assets and services | `#6D4AB8` on `#EAE3F7` | `#BBA6EE` on `#2A2142` |
| Category: tasks | `#C2531F` on `#FDEEE6` | `#E5763F` on `#2A1A12` |
| Success | `#1E7A4C` on `#E6F4EC` | `#7FD3A3` on `#12301F` |
| Warning | `#B26A00` on `#FFF3D6` | `#F2C766` on `#3A2C0B` |
| Danger | `#C0362C` on `#FCEBEA` | `#E0574C` on `#3D1716` |
| Info | `#1F5F99` on `#E8F1FA` | `#8DB8EE` on `#142A40` |

## Rules for category colours

1. Action buttons are always the primary teal, in every app.
2. Category colours are used only for icons, labels, and markers of a service type.
3. Use one category colour per card.
4. Status colours (success, warning, danger, info) are separate and never stand in for a category.
