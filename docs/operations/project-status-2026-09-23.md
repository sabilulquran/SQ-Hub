# Status proyek SQ Hub — 2026-09-23

## Ringkasan

Foundation SQ Hub / Akun SQ dinyatakan **CLOSED** berdasarkan gabungan evidence repository, production reconciliation, deployment production, dan browser UAT operator pada 23 September 2026.

Penutupan ini berlaku untuk baseline Foundation yang menjadi blocker sebelum fase lanjutan. Penutupan ini tidak berarti Identity Lifecycle, Organization Directory runtime, SQ Portal, atau fase lanjutan lain sudah diimplementasikan.

## Repository dan CI

- PR #94, **feat(HUB-IMPL-019): complete native Akun SQ self-service parity**, merged ke `main` sebagai `ba553bcbcf99fdf9a1f6b014bc0608491c912646`.
- Exact-head CI untuk PR #94 dan post-merge `main` lulus, termasuk CI, Keycloak Infra, Akun SQ Account Runtime, Akun SQ Experience Contract, Staging Deployment Contract, Hub Production Launcher Contract, dan publisher image terkait.
- PR #95, **fix(HUB-IMPL-016): prevent incomplete production deploy success**, merged ke `main` sebagai `701f4d837a2a6af3933f2b0a59d891ecdee97831`.
- Post-merge CI #463 dan Hub Production Launcher Contract #186 untuk hotfix deployment lulus.
- Ruleset **Protect main** aktif untuk default branch dan mencegah deletion/force-push serta mewajibkan perubahan melalui pull request.

## Production reconciliation

Operator menjalankan guarded native-account reconciliation terhadap exact realm `sq-staff` dan client `sq-hub` setelah backup Keycloak production tersedia.

Evidence aman yang dilaporkan operator:

```text
NATIVE_ACCOUNT_CAPABILITY_BASELINE_PASS realm=sq-staff
NATIVE_ACCOUNT_SCOPE_MAPPING_PASS realm=sq-staff client=sq-hub
NATIVE_ACCOUNT_AUDIENCE_PASS realm=sq-staff client=sq-hub audience=account
```

Reconciliation tersebut membuktikan baseline capability production tidak mengaktifkan capability yang belum dipetakan native, account-client scope berada pada allowlist Foundation, dan access-token audience `account` tersedia untuk delegated Account API.

## Production deployment

Deployment production final dijalankan melalui **Deploy SQ Hub Production #9** dengan target `main`:

`701f4d837a2a6af3933f2b0a59d891ecdee97831`

Karena hotfix deployment hanya mengubah automation, API/web/identity component source tetap berasal dari feature SHA:

`ba553bcbcf99fdf9a1f6b014bc0608491c912646`

Evidence deployment final:

```text
PRODUCTION_RUNTIME_BUNDLE_PREFLIGHT_PASS
API_DEPLOY_NOOP source=ba553bcbcf99fdf9a1f6b014bc0608491c912646
WEB_DEPLOY_PASS source=ba553bcbcf99fdf9a1f6b014bc0608491c912646
IDENTITY_IMAGE_DEPLOY_PASS source=ba553bcbcf99fdf9a1f6b014bc0608491c912646
SQ_HUB_PRODUCTION_DEPLOY_PASS
runtime_scope=auto
```

API tidak direcreate pada run #9 karena API image dari run sebelumnya sudah sama dengan target. Migration additive `0005_native_account_delegation.sql` sebelumnya telah diterapkan dan API image target sudah berhasil berjalan. Run #9 kemudian menyelesaikan web dan identity rollout serta public verification sampai terminal PASS marker.

## Browser UAT production

Operator memverifikasi native Akun SQ di:

`https://hub.sabilulquran.or.id/account`

Checklist UAT dan hasil:

| Area | Hasil |
| --- | --- |
| Profil Saya | PASS |
| Keamanan | PASS |
| Ganti password / required-action flow | PASS |
| Authenticator / MFA | PASS |
| Sesi & Perangkat | PASS |
| Aplikasi | PASS |
| Akun Terhubung | PASS |
| Navigasi antar-section | PASS |
| Logout | PASS |
| Mobile sekitar 390×844 | PASS, dengan catatan polish kerapian GUI |
| Login ulang setelah logout | PASS |

Dengan evidence tersebut, native Akun SQ telah dibuktikan usable di production untuk baseline self-service Foundation dan mobile acceptance minimum yang diuji operator.

## Status Foundation

**FOUNDATION_CLOSED — 2026-09-23**

Dasar penutupan:

1. source dan regression gates sudah merged dan hijau;
2. production Account API scope/audience sudah direconcile secara eksplisit;
3. backup sebelum perubahan production tersedia;
4. migration dan runtime image sudah terpasang;
5. deployment final memiliki terminal `SQ_HUB_PRODUCTION_DEPLOY_PASS`;
6. browser UAT operator untuk baseline account flow seluruhnya PASS.

## Catatan polish non-blocking

Dua catatan visual tetap dibawa ke backlog dan **tidak menahan Foundation closure**:

- ukuran organization mark, nama aplikasi, dan nama Yayasan pada header terasa terlalu kecil; perbaikan harus diperlakukan sebagai **cross-system design-system polish**, bukan hanya halaman Akun SQ, agar konsisten pada SQ Hub, HCIS, dan aplikasi SQ lain yang memakai brand lockup serupa;
- mobile native account lulus fungsi dan usability minimum, tetapi masih memiliki catatan kerapian GUI yang perlu dipoles pada pekerjaan visual berikutnya.

Catatan di atas belum diimplementasikan pada closure ini.

## Batas klaim

Penutupan Foundation ini tidak menyatakan fase lanjutan berikut sudah selesai atau aktif:

- Identity Lifecycle;
- Organization Directory runtime;
- SQ Portal / external identity;
- capability Account Console non-baseline yang sengaja diblokir oleh HUB-IMPL-019;
- polish lintas aplikasi yang dicatat di atas.

Pekerjaan fase berikutnya boleh dimulai setelah closure ini diterima, tanpa mengubah ownership boundary yang sudah ditetapkan: Keycloak tetap identity engine, SQ Hub tetap shared platform/launcher, dan HCIS tetap authority untuk data serta struktur kepegawaian.
