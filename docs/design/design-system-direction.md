# SQ Hub Design System Direction

**Status:** ACCEPTED

## Goal
Membuat HCIS, SPMB, Finance, Workspace, Academic, dan aplikasi lain terasa sebagai satu keluarga produk tanpa memaksa seluruh business UI menjadi identik.

## Shared layers
### Foundations
- brand color roles;
- typography scale;
- spacing scale;
- radius;
- elevation;
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

### Common components
Shared implementation dibuat sesuai kebutuhan nyata, antara lain button, input, select, checkbox, dialog, drawer, tabs, table, pagination, badge, toast, skeleton/loading, empty/error/forbidden states.

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
- Agent wajib mencari pattern yang sudah ada sebelum membuat UI pattern baru.
- Jangan membuat komponen shared hanya karena satu halaman membutuhkannya.
- Jangan copy/fork shared component ke aplikasi untuk modifikasi lokal tanpa alasan terdokumentasi.
- Perubahan semantic token atau shared interaction pattern harus dinilai dampaknya lintas aplikasi.

## Open design work before UI implementation
- audit brand visual Sabilul Qur'an yang sudah ada;
- audit UI HCIS sebagai source/reference, bukan otomatis sebagai design-system truth;
- tentukan typography dan token awal;
- definisikan app shell;
- definisikan minimum common component inventory;
- accessibility baseline dan responsive behavior.
