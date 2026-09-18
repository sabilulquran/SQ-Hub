# Status proyek SQ Hub — 2026-09-18

Dokumen ini adalah status repository untuk persiapan peluncuran SQ Hub launcher production. Ia tidak mengklaim pemeriksaan atau perubahan VPS/DNS/browser pada 18 September 2026.

## Ringkasan non-engineer

SQ Hub launcher dan login terautentikasi sudah tersedia di source dan sebelumnya telah lulus UAT staging. SQ Hub API production juga sebelumnya teramati berjalan. Gap utama yang tersisa untuk launcher production adalah jalur deployment web yang eksplisit, production OIDC client yang terpisah dari staging, reverse proxy/DNS, dan verifikasi browser pada hostname production.

HUB-IMPL-016 menambahkan paket repository untuk menutup gap tersebut tanpa menyentuh production dari GitHub: kontrak `sq-hub` production, Compose API/web yang tidak memiliki Keycloak/HCIS/database lain, contoh Caddy, desired-state OIDC client tanpa secret, contract CI, serta runbook preflight/deploy/smoke/rollback.

Status pada branch/PR ini hanya dapat menjadi **REPOSITORY_READY** setelah review dan CI lulus. `hub.sabilulquran.or.id` tidak boleh disebut **DEPLOYED** atau **BROWSER_VERIFIED** sampai Codex lokal/operator benar-benar menjalankan handoff live dan menghasilkan bukti yang sesuai.

## Matriks status

| Area | Status saat dokumen dibuat | Makna |
| --- | --- | --- |
| Authenticated SQ Hub workspace | Sudah diimplementasikan dan ACCEPTED | Server-side Authorization Code + PKCE, opaque Hub session, Application Access workspace, logout tersedia. |
| Staging Hub UAT | Bukti accepted sudah ada | Bukti lama dipertahankan dan tidak diulang/dihapus oleh paket production ini. |
| SQ Hub API production | Sebelumnya teramati deployed/healthy pada audit 16 September | Bukti historis; agent GitHub ini tidak memeriksa live runtime 18 September. |
| SQ Hub web production | Belum dibuktikan deployed | Audit terakhir menyatakan launcher publik belum tersedia. |
| Production Hub OIDC client | Repository desired state disiapkan | Live `sq-hub` client/secret tetap pekerjaan operator. |
| Caddy route production | Repository example disiapkan | Live Caddy belum diklaim berubah. |
| DNS `hub.sabilulquran.or.id` | Belum dibuktikan tersedia | DNS/Cloudflare tetap pekerjaan operator. |
| Browser production UAT | Belum dijalankan oleh paket ini | Harus diuji setelah deployment/DNS. |
| Account Console Akun SQ | Source tersedia; runtime activation terpisah | `accountTheme=sq-hub` tetap pekerjaan operator terpisah dan bukan scope launcher. |

## Production contract yang disiapkan

- issuer: `https://login.sabilulquran.or.id/realms/sq-staff`;
- Hub origin: `https://hub.sabilulquran.or.id`;
- client production: `sq-hub`, terpisah dari `sq-hub-staging`;
- callback exact: `https://hub.sabilulquran.or.id/auth/callback`;
- logout redirect exact: `https://hub.sabilulquran.or.id/`;
- Authorization Code + PKCE S256;
- implicit/direct grant/service account nonaktif pada browser client;
- secure host-only Hub cookies;
- no browser OIDC token/code/state/nonce/verifier storage;
- API/web image production menggunakan digest immutable;
- Caddy hanya menargetkan web loopback boundary;
- production Compose tidak mendefinisikan Keycloak, HCIS, atau database lain.

## Handoff live yang masih wajib

Codex lokal/operator menjalankan urutan:

**backup/snapshot → provision/reconcile client + secret secara aman → deploy API → deploy web → Caddy → DNS/Cloudflare → health/protocol smoke → browser UAT → rollback bila gagal.**

Bukti aman dan data terlarang dijelaskan rinci di `HUB-IMPL-016-production-launcher.md`.

## Batas klaim

Green CI membuktikan kontrak repository, bukan availability production. Health check membuktikan service merespons, bukan browser UAT. DNS resolve membuktikan routing tersedia, bukan login/authorization benar. Browser UAT hanya boleh diberi status PASS bila benar-benar dijalankan.
