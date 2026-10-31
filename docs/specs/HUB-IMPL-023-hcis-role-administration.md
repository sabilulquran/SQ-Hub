# HUB-IMPL-023 — Admin Platform memberi peran HCIS

**Status:** DRAFT. Belum diterima Product Owner. Penerimaan memberi wewenang implementasi; penerapan di Mi8VPS tetap menuntut review, CI, dan persetujuan owner tersendiri.
**Product:** SQ Hub
**Area:** Admin Center / identitas dan akses
**Date:** 2026-10-31
**Depends on:** ADR-0003, ADR-0009, HUB-IMPL-002, HUB-IMPL-007, HUB-IMPL-009, HUB-IMPL-021; HCIS ADR-0006 dan AUTH-014
**Counterpart:** HCIS `docs/domain/sq-core-administrator-layers.md` (AUTH-014), fase F1–F4 sudah di `main` HCIS

## Outcome

Admin Platform memberi dan mencabut peran HCIS dari SQ Hub, memakai **akun pegawainya sendiri**, tanpa berganti akun dan tanpa membuka konsol Keycloak.

Hari ini di HCIS hanya akun `SUPER_ADMIN` terpisah yang boleh memberi peran. Owner harus keluar-masuk dengan akun berbeda untuk satu pemberian peran, dan pernah tidak bisa masuk sama sekali karena akun itu belum pernah ditautkan ke Akun SQ. Keputusan owner 27 Oktober 2026 (HCIS ADR-0006) memindahkan kewenangan itu ke lapis Admin Platform di SQ Hub.

Hub tidak memiliki peran HCIS dan tidak menyimpan daftarnya. Hub menyampaikan perintah; HCIS tetap pemilik peran, aturannya, dan auditnya.

## Istilah

| Istilah | Arti |
| --- | --- |
| Admin Platform | Pemegang baris `platform_administrators` di Hub. Mengurus orang dan akses, termasuk pemberian peran di modul mana pun. |
| Admin Modul | Peran di dalam satu aplikasi yang mengurus isi dan jalannya modul itu, tidak pernah memberi peran. Di HCIS: `hcis_module_admin`. |
| Kanal pemberian peran | Rute `/internal/v1/role-administration/*` milik HCIS. |
| Assertion aktor | Token hasil token exchange yang membuktikan **manusia mana** yang bertindak. |

## Scope

Termasuk:

- layar Admin Center untuk memberi dan mencabut peran HCIS;
- pemanggilan kanal HCIS dengan dua bukti: token mesin dan assertion aktor;
- konfigurasi Keycloak yang dibutuhkan kanal itu (K-1, K-2, K-4, K-5);
- pengamanan keanggotaan Admin Platform yang menutup lingkaran eskalasi di luar HCIS (H-9, H-10, H-11).

Tidak termasuk:

- definisi peran HCIS, isinya, atau aturan siapa boleh apa di dalam HCIS — semuanya milik HCIS;
- menjadikan Keycloak sumber kebenaran peran domain (dilarang `AGENTS.md` §5);
- pengelolaan akun HCIS (pembuatan, aktivasi, status) — itu AUTH-014 §2.9, spesifikasi tersendiri;
- menyalakan kanal di production. Saklar `HCIS_ROLE_ADMIN_ENABLED` adalah keputusan owner, dan tidak boleh pada hari rilis payroll.

---

## 1. Keycloak: siapa peminta token exchange

**Keputusan, dengan bukti.** Peminta exchange adalah client **`sq-hub`**, bukan client mesin baru.

Buktinya ada di repo ini dan sudah terbukti dipikirkan untuk HUB-IMPL-021:

- `apps/api/src/modules/governance/token-exchange.ts` memakai `clientId`/`clientSecret` dari konfigurasi Hub, dengan subject token berupa token akses pengguna;
- `docs/operations/HUB-IMPL-021-token-exchange.md` menyatakan dua hal yang mengikat: parameter `audience` **menyaring, tidak pernah menambah**, dan subject token **wajib memuat peminta di klaim `aud`**. Karena subject token adalah token pengguna Hub, pemintanya harus client yang menerbitkan sesi pengguna itu, yaitu `sq-hub`;
- `SQ_HUB_OIDC_CLIENT_ID` di `apps/api/src/config.ts` adalah client yang sama yang dipakai `hub-auth/oidc-provider.ts` untuk login pengguna.

Rancangan awal AUTH-014 menjadikan client mesin `sq-hub-role-administration` sebagai peminta. Itu keliru: untuk bekerja, client itu harus masuk `aud` **setiap** token pengguna Hub. Koreksi ini membuat kebutuhannya jauh lebih kecil, karena `sq-hub` memang sudah harus menjadi audience token-nya sendiri untuk HUB-IMPL-021.

Maka dua client, dua tugas berbeda:

| Client | Tugas |
| --- | --- |
| `sq-hub` | **peminta** exchange; menerbitkan assertion aktor dari token sesi pengguna |
| `sq-hub-role-administration` | **akun mesin**; token client-credentials yang membuktikan permintaan datang dari SQ Hub |

Dua bukti itu tidak saling menggantikan. Token mesin menjawab "dari mana"; assertion aktor menjawab "siapa".

### 1.1 Konfigurasi Keycloak

Realm `sq-staff`. Dijalankan owner lewat skrip `kcadm`; `AGENTS.md` §9 melarang agent AI punya akses tulis tak terbatas ke Keycloak admin API, dan cara kerja ini mematuhinya.

| ID | Perubahan | Status |
| --- | --- | --- |
| **K-1** | `manage-users` ditambahkan ke akun mesin `sq-hub-identity-management` **saja**. `view-users` sengaja tidak ditambahkan: akun itu sudah memegang `query-users`, yang cukup untuk mencari pengguna yang akan dinonaktifkan atau direset | diterapkan 2026-10-31 |
| **K-2** | Client `sq-hub-role-administration` (confidential, service account, tanpa alur login). Client `hcis-role-administration-actor` sebagai sasaran audience. Client scope `role-administration.manage` → audience `hcis-role-administration`, dipasang **default** pada client mesin | diterapkan 2026-10-31 |
| **K-4** | Saklar standard token exchange pada **`sq-hub`** — bukan pada client mesin seperti rancangan awal | **belum**; koreksi §1 |
| **K-5** | Client scope `role-administration.actor` → audience `hcis-role-administration-actor`, dipasang **OPTIONAL** pada **`sq-hub`**. Dan audience mapper pada `sq-hub-dedicated` yang menjadikan `sq-hub` audience token-nya sendiri (langkah 2 HUB-IMPL-021; dipakai bersama, bukan ditambahkan dua kali) | **belum** |

**Optional, tidak pernah default.** Alasannya sama dengan yang sudah ditulis HUB-IMPL-021 untuk `sq-governance-*`: scope default akan menaruh audience aktor di **setiap** token Hub, sehingga token Hub biasa sudah sah sebagai assertion aktor. Itu meniadakan seluruh gunanya.

**Yang tidak boleh diberikan ke akun mesin mana pun** (HCIS ADR-0006 D-2): `impersonation`, `manage-clients`, `manage-realm`, `manage-identity-providers`, `realm-admin`.

### 1.2 Dua temuan yang perlu ditindaklanjuti di luar spesifikasi ini

1. `docs/operations/HUB-IMPL-021-token-exchange.md` berstatus "PREPARED, NOT APPLIED", tetapi penelusuran realm 2026-10-31 menunjukkan client scope `sq-governance-hcis` dan `sq-governance-aset-sq` **sudah ada**. Status dokumennya tertinggal dari kenyataan.
2. Penelusuran yang sama menunjukkan **tidak ada satu pun client menyetel atribut token exchange**. Artinya langkah 1 HUB-IMPL-021 belum diterapkan, dan Ringkasan Yayasan yang bergantung padanya kemungkinan belum pernah bekerja. `DISCOVERY` — pemiliknya HUB-IMPL-021, bukan spesifikasi ini. Kabar baiknya, K-4 di sini menyalakan saklar yang sama dan menguntungkan keduanya.

---

## 2. Yang Hub kirim ke HCIS

### H-1 — Katalog peran datang dari HCIS

Layar pemberian peran membaca `GET /internal/v1/role-administration/catalog` dan menampilkan apa adanya: `roleKey`, nama, keterangan, `allowedScopes`, dan apakah mandat wajib.

**Jangan menyalin daftar peran HCIS ke kode Hub.** Peran HCIS berubah di HCIS; salinan di Hub akan melenceng tanpa ada yang tahu, dan `AGENTS.md` §4 menegaskan ownership data harus eksplisit.

### H-2 — Setiap panggilan membawa dua bukti

```text
POST {hcis}/internal/v1/role-administration/accounts/{accountId}/role-assignments
Authorization: Bearer <token client-credentials sq-hub-role-administration>
X-SQ-Actor-Assertion: <token hasil exchange, audience hcis-role-administration-actor>
Content-Type: application/json

{ "requestId": "<uuid>", "roleId": "...", "scopeType": "organization",
  "organizationalUnitId": null, "reason": "<mandat>", "startsOn": null, "endsOn": null }
```

Aturan yang mengikat implementasi:

- **Identitas aktor tidak pernah ada di body.** HCIS menolak `400` kalau body memuat `actor`. Identitas hanya datang dari assertion.
- **`requestId` unik per aksi.** HCIS menolak `409` kalau diputar ulang.
- **Assertion sekali pakai.** HCIS membelanjakannya dan menolak `409 ROLE_ADMIN_ACTOR_ASSERTION_SPENT` pada presentasi kedua. Jadi **satu assertion untuk satu panggilan**; jangan memakai ulang assertion yang sama untuk membaca katalog lalu memberi peran.
- **`GET /catalog` tidak membelanjakan assertion**, tetapi tetap menuntut kedua bukti.
- **Jangan menyimpan assertion.** Diterbitkan saat dibutuhkan, dipakai sekali, tidak pernah dicatat dan tidak pernah dikirim ke browser — sama seperti HUB-IMPL-021 memperlakukan token exchange-nya.
- **Gagal berarti gagal.** Tidak ada jalur cadangan lain ke HCIS. `AGENTS.md` §5 melarang silent fallback.

### Jawaban HCIS yang harus ditangani

| Status | Kode | Arti bagi operator |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | salah satu bukti tidak terkirim |
| 401 | `ROLE_ADMIN_ACTOR_ASSERTION_INVALID` | assertion cacat, kedaluwarsa, atau audience salah |
| 403 | `ROLE_ADMIN_ACTOR_UNRESOLVED` | HCIS tidak punya akun untuk orang ini. Bukan salah operator — tampilkan sebagai masalah konfigurasi, bukan "akses ditolak" |
| 403 | `HCIS_ACCESS_DENIED` | akses aplikasi HCIS orang ini dicabut di Hub |
| 403 | `ROLE_DELEGATION_FORBIDDEN` | termasuk larangan memberi peran kepada diri sendiri |
| 403 | `ROLE_IDENTITY_PERMISSION_FORBIDDEN` | peran itu membawa kewenangan identitas; tidak akan pernah bisa diberikan dari HCIS |
| 409 | `ROLE_ADMIN_ACTOR_ASSERTION_SPENT` | assertion sudah terpakai; terbitkan yang baru |
| 409 | `ROLE_ADMIN_REQUEST_REPLAYED` | `requestId` sudah pernah dipakai |
| 503 | `ROLE_ADMIN_CHANNEL_DISABLED` | saklar HCIS masih mati. **Keadaan normal sampai F5**; jangan tampilkan sebagai kerusakan |
| 503 | `APPLICATION_ACCESS_UNAVAILABLE` | HCIS tidak bisa menanyakan akses aplikasi ke Hub |

---

## 3. Menutup lingkaran eskalasi di sisi Hub

HCIS menutup lingkaran eskalasi **di dalam dirinya**: tidak ada yang boleh memberi peran kepada dirinya sendiri, dan tidak ada peran HCIS yang boleh membawa kewenangan identitas. Lingkaran yang tersisa ada di sini, dan **satu** Admin Platform cukup untuk menutupnya tanpa kolusi.

### H-9 — Menambah Admin Platform butuh empat mata

Seorang Admin Platform dapat menambahkan Admin Platform kedua yang ia kuasai, lalu memakainya untuk memberi dirinya peran apa pun. Larangan self-grant di HCIS tidak menyentuh itu, karena pada saat pemberian terjadi aktornya memang orang lain.

Maka: penambahan baris `platform_administrators` menuntut **dua Admin Platform berbeda**, dan **tidak seorang pun boleh menambahkan dirinya sendiri**. Pencabutan tidak menuntut empat mata — mempersulit pencabutan akses justru berbahaya.

`DRAFT`: bentuknya usulan-lalu-konfirmasi, dengan usulan kedaluwarsa setelah 7 hari. Keputusan owner kalau angkanya berbeda.

### H-10 — Reset kata sandi sesama Admin Platform dilarang lewat Hub

`manage-users` mencakup pengelolaan credential. Seorang Admin Platform bisa mereset kata sandi Admin Platform lain, masuk sebagai orang itu, lalu memberi dirinya peran apa pun. Reset kata sandi pada dasarnya adalah penyamaran dengan satu baris log tambahan.

Maka Hub **menolak** reset kata sandi untuk akun yang merupakan Admin Platform atau memegang peran istimewa modul. Akun seperti itu hanya lewat konsol Keycloak, yang memang sengaja dipertahankan sebagai kunci cadangan.

`DRAFT`: "peran istimewa modul" untuk v1 berarti Admin Platform saja, karena Hub belum tahu peran mana di tiap modul yang istimewa. Menanyakannya ke tiap aplikasi adalah pekerjaan tersendiri.

### H-11 — Daftar Admin Platform terlihat tanpa akses database

Daftar Admin Platform dan setiap perubahannya tampil di layar audit yang bisa dibaca owner sendiri. Lingkaran yang tersisa ada di luar HCIS, jadi deteksinya juga harus di luar HCIS — dan deteksi yang menuntut akses database bukan deteksi.

---

## 4. Yang tidak boleh terjadi

- Hub **tidak** menyimpan, menyalin, atau menebak daftar peran HCIS.
- Hub **tidak** memakai identitas mesin untuk mengatasnamakan pengguna. Assertion aktor selalu berasal dari token sesi orang itu sendiri.
- Assertion aktor **tidak pernah** sampai ke browser, ke log, atau ke penyimpanan.
- Scope aktor **tidak pernah** menjadi default pada client mana pun.
- Kegagalan kanal **tidak pernah** punya jalur cadangan.
- Hub **tidak** menonaktifkan jalur break-glass HCIS dan tidak bergantung padanya.

## 5. Acceptance criteria

1. Admin Platform memberi satu peran HCIS dari Admin Center memakai akun pegawainya sendiri, dan HCIS mencatatnya dengan `actor_source = "sq_hub"` beserta akun manusia yang benar.
2. Katalog peran yang ditampilkan berasal dari `GET /catalog`; tidak ada `roleKey` HCIS yang tertulis di kode Hub.
3. Memberi peran kepada diri sendiri ditolak, dan pesannya mengatakan kenapa.
4. Assertion yang sama dipakai dua kali ditolak `409`, dan Hub menerbitkan yang baru alih-alih mengulang.
5. `requestId` yang sama dikirim dua kali tidak menghasilkan dua assignment.
6. Saat `HCIS_ROLE_ADMIN_ENABLED` masih `0`, layar menampilkan keadaan "belum aktif", bukan kerusakan.
7. Assertion aktor tidak pernah muncul di respons browser, di log aplikasi, atau di penyimpanan.
8. Token Hub biasa yang **bukan** hasil exchange ditolak kanal HCIS.
9. Menambah Admin Platform menuntut dua orang berbeda, dan menambahkan diri sendiri ditolak.
10. Reset kata sandi untuk akun Admin Platform ditolak lewat Hub, dengan pesan yang menunjuk konsol Keycloak.

## 6. Gate kualitas (AGENTS.md §11, jalur auth)

Wajib diperiksa dan dilaporkan apa adanya, termasuk yang tidak bisa dijalankan:

identity mapping; perilaku fail-closed; penyimpanan token; keamanan cookie; Application Access; kontinuitas otorisasi lokal; logout; backup/restore; latihan rollback.

Catatan jujur sejak sekarang: **latihan rollback dan backup/restore tidak dapat dijalankan dari CI**, karena keduanya menyentuh Keycloak dan database production. Keduanya dijalankan owner saat rollout dan dilaporkan di situ, bukan diklaim lulus di PR.

## 7. Rollback

| Langkah | Akibatnya |
| --- | --- |
| Matikan `HCIS_ROLE_ADMIN_ENABLED` di HCIS | kanal menjawab 503; layar Hub menampilkan "belum aktif" |
| Lepas optional scope `role-administration.actor` dari `sq-hub` | exchange gagal; tidak ada yang lain berubah |
| Matikan saklar standard token exchange pada `sq-hub` | **juga mematikan Ringkasan Yayasan** (HUB-IMPL-021). Jangan dipakai sebagai rollback spesifikasi ini |
| Cabut `manage-users` dari `sq-hub-identity-management` | Hub kembali tidak bisa mengelola pengguna; konsol Keycloak tetap bisa |

Hub tidak menyimpan data peran, jadi tidak ada yang perlu dibersihkan.

## 8. Asumsi yang belum diputuskan

| Tanda | Asumsi |
| --- | --- |
| `DRAFT` | Empat mata H-9 berbentuk usulan-lalu-konfirmasi dengan kedaluwarsa 7 hari |
| `DRAFT` | "Peran istimewa modul" di H-10 untuk v1 berarti Admin Platform saja |
| `DRAFT` | Audience aktor bernama `hcis-role-administration-actor`; client-nya sudah dibuat 2026-10-31 |
| `TBD` | Apakah aplikasi SQ Core lain memakai kanal berbentuk sama. Rancangan ini tidak memuat apa pun yang khas HCIS selain katalog perannya |
| `DISCOVERY` | Saklar token exchange pada `sq-hub` belum pernah diterapkan, sehingga Ringkasan Yayasan kemungkinan belum pernah bekerja (§1.2) |
