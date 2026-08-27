# SQ Hub Design System Direction

**Status:** ACCEPTED

## Goal
Membuat HCIS, SQ Hub, SPMB, Finance, Workspace, Academic, dan aplikasi lain terasa sebagai satu keluarga produk tanpa memaksa seluruh business UI menjadi identik.

## Initial baseline
Visual system HCIS yang sudah sesuai brand ditetapkan sebagai baseline awal SQ Design System melalui ADR-0004.

Gunakan `docs/design/hcis-baseline.md` sebagai ringkasan machine-readable agar agent tidak perlu membaca seluruh frontend HCIS untuk task desain biasa.

Prinsip transisinya:
1. HCIS adalah reference implementation awal;
2. token/pattern yang benar-benar lintas aplikasi diekstrak dan dinormalisasi di SQ Hub;
3. setelah shared primitives tersedia, SQ Hub menjadi canonical source untuk design system lintas produk;
4. HCIS kemudian consume/align ke shared primitives tersebut.

Dengan demikian kita reuse desain HCIS tanpa menjadikan repository HCIS sebagai dependency desain permanen bagi semua aplikasi.

## Shared layers
### Foundations
Baseline HCIS menjadi titik awal untuk:
- brand color roles;
- typography scale dan font families;
- spacing scale;
- radius;
- elevation/shadows;
- iconography rules;
- density;
- motion principles;
- responsive breakpoints;
- accessibility baseline.

### Application shell
Shared conventions untuk:
- header/top bar;
- sidebar/navigation;
- app launcher;
- user/account menu;
- breadcrumb/page title;
- responsive/mobile shell.

HCIS `AppShell` menjadi visual reference, tetapi navigation model, capability checks, dan label business tetap milik aplikasi masing-masing.

### Authentication shell
HCIS `AuthLayout` menjadi visual reference untuk SQ Identity. Keycloak login pages harus ditheme agar senada dengan baseline SQ, bukan dibiarkan menggunakan visual default provider.

### Common components
Shared implementation dibuat sesuai kebutuhan nyata, antara lain button, input, select, checkbox, dialog, drawer, tabs, table, pagination, badge, toast, skeleton/loading, empty/error/forbidden states.

Existing HCIS components adalah candidate extraction, bukan otomatis shared API.

### Operational patterns
Standarkan pola yang sering muncul lintas aplikasi:
- list + filter + search;
- status presentation;
- form validation;
- destructive action confirmation;
- approval/action confirmation;
- bulk selection/action;
- loading, empty, error, forbidden;
- mobile/tablet behavior.

## Semantic consistency
Meaning harus konsisten lintas aplikasi. Contoh: warna/status untuk success, warning, danger, draft, active, inactive, atau approved tidak boleh memiliki makna bertentangan antar aplikasi tanpa alasan yang jelas.

## Domain flexibility
Design system mengatur bahasa visual dan interaction baseline, bukan business layout setiap domain. Komponen khusus seperti leave calendar, admission pipeline, finance reconciliation, atau academic grade entry tetap dapat dimiliki aplikasi masing-masing.

## Shared resources
Target implementasi ketika reuse sudah nyata dapat berupa package seperti:
- `@sq/design-tokens`
- `@sq/ui`
- shared icons/assets bila diperlukan.

Nama package final mengikuti keputusan teknis implementasi.

## AI guardrails
- Agent wajib membaca `docs/design/hcis-baseline.md` untuk task visual lintas aplikasi.
- Jangan membuat visual language baru bila pattern HCIS/SQ yang setara sudah ada.
- Jangan membuat komponen shared hanya karena satu halaman membutuhkannya.
- Jangan copy/fork shared component ke aplikasi untuk modifikasi lokal tanpa alasan terdokumentasi.
- Perubahan semantic token atau shared interaction pattern harus dinilai dampaknya lintas aplikasi.
- Jangan menyalin business-specific HCIS component ke SQ Hub/SPMB dan mengganti nama seolah sudah menjadi generic component.

## Remaining design work before shared UI implementation
- normalisasi token HCIS menjadi semantic SQ tokens;
- generalisasi SQ Identity/Auth shell;
- generalisasi app shell tanpa business navigation HCIS;
- minimum common component inventory berdasarkan consumer kedua (SQ Hub/SPMB);
- accessibility review dan responsive behavior verification;
- strategi distribusi/versioning package shared.
