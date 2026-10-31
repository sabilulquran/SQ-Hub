# HUB-IMPL-023 — Admin Platform memberi peran HCIS

**Status:** DRAFT, revisi 2 setelah review independen 2026-10-31. Belum diterima Product Owner. Penerimaan memberi wewenang implementasi; penerapan di Mi8VPS tetap menuntut review, CI, dan persetujuan owner tersendiri.
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

## 0. Siapa yang boleh memakai kanal ini

**Ini kebutuhan paling penting di seluruh dokumen, dan rancangan sebelumnya melewatkannya.**

Di HCIS, jalur `sq_hub` hanya memeriksa bahwa aktor adalah **pegawai aktif** (`assertRoleGrantor`, `role-assignment.ts`). Tidak ada syarat peran sama sekali. AUTH-014 §2.5 menyatakan terus terang bahwa "HCIS tidak memverifikasi bahwa aktor berwenang — SQ Hub yang melakukannya", tetapi rancangan Hub sebelumnya hanya menyebutnya dalam prosa dan tidak pernah menuliskannya sebagai kebutuhan. Akibatnya tidak ada satu pun pihak yang menegakkannya.

Yang akan terjadi tanpa ini: dua pegawai biasa yang sama-sama punya akses aplikasi HCIS **saling** memberi `human_capital_admin`. Larangan self-grant di HCIS tidak menyentuh pemberian timbal balik, dan hasilnya eskalasi administratif penuh dari dua akun biasa. Seluruh §3 membahas kolusi antar-Admin Platform dan melewatkan mata rantai yang lebih lemah tepat di bawahnya.

**H-0 — Hub menolak sebelum menyentuh Keycloak.** Setiap rute Hub yang memanggil kanal HCIS wajib memastikan pemanggilnya adalah Admin Platform aktif (`platform_administrators`), dan menolak **sebelum** token exchange dicoba. Penolakan yang terjadi setelah exchange berarti assertion sudah diterbitkan untuk orang yang tidak berhak, dan sekali diterbitkan ia berlaku sampai kedaluwarsa.

Ini bukan pengganti pemeriksaan HCIS; ini satu-satunya pemeriksaan kewenangan yang ada. Perlakukan demikian.

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
| **K-1** | `manage-users` pada akun mesin `sq-hub-identity-management` | **DITERAPKAN 2026-10-31, DAN DIPERTANYAKAN** — lihat §1.2 |
| **K-2** | Client `sq-hub-role-administration` (confidential, service account, tanpa alur login). Client `hcis-role-administration-actor` sebagai sasaran audience. Client scope `role-administration.manage` → audience `hcis-role-administration`, dipasang **default** pada client mesin | diterapkan 2026-10-31 |
| **K-4** | Saklar standard token exchange pada **`sq-hub`** — bukan pada client mesin seperti rancangan awal | **belum**; koreksi §1 |
| **K-5** | Client scope `role-administration.actor` → audience `hcis-role-administration-actor`, dipasang **OPTIONAL** pada **`sq-hub`**. Dan audience mapper pada `sq-hub-dedicated` yang menjadikan `sq-hub` audience token-nya sendiri (langkah 2 HUB-IMPL-021; dipakai bersama, bukan ditambahkan dua kali) | **belum** |

**Optional, tidak pernah default.** Alasannya sama dengan yang sudah ditulis HUB-IMPL-021 untuk `sq-governance-*`: scope default akan menaruh audience aktor di **setiap** token Hub, sehingga token Hub biasa sudah sah sebagai assertion aktor. Itu meniadakan seluruh gunanya.

**Nama scope dan `KeycloakTokenExchanger`.** Penukar token yang ada menyusun scope-nya sendiri: `scope: \`${GOVERNANCE_SCOPE_PREFIX}${audience}\`` dengan prefix `sq-governance-`. Memakainya apa adanya untuk audience aktor akan meminta `sq-governance-hcis-role-administration-actor`, yang tidak ada, dan setiap exchange gagal.

Keputusan: **parameterkan scope-nya**, jangan menamai ulang scope Keycloak agar muat ke prefix itu. Menamai ulang akan menabrak langkah 5 HUB-IMPL-021 ("jangan beri `sq-hub` optional scope lain dengan audience mapper untuk aplikasi di luar registry"), karena audience aktor memang bukan entri registry. Implementasinya menambah parameter scope pada `TokenExchanger.exchange`, dengan pemanggil governance tetap mengirim nilai yang sama seperti sekarang.

**Yang tidak boleh diberikan ke akun mesin mana pun** (HCIS ADR-0006 D-2): `impersonation`, `manage-clients`, `manage-realm`, `manage-identity-providers`, `realm-admin`.

### 1.2 K-1 bertentangan dengan spesifikasi yang sudah ACCEPTED

`HUB-IMPL-013` berstatus **ACCEPTED** dan sudah di `main`. Isinya menyatakan `sq-hub-identity-management` **tidak menerima** `realm-admin`, **`manage-users` yang luas**, pengelolaan client/realm/role/group, mau pun impersonation; ia harus memakai `query-users` ditambah izin admin berbutir halus. Dokumen operasinya menjadikan probe izin production sebagai prasyarat.

Perubahan 2026-10-31 menambahkan `manage-users` ke client itu. `AGENTS.md` §1 menetapkan spesifikasi DRAFT tidak boleh membatalkan yang ACCEPTED, jadi dokumen ini **tidak** mengesahkannya.

Akibat nyatanya bukan soal dokumen: `manage-users` memberi kemampuan mereset kredensial dan mengubah peran **setiap** pengguna realm `sq-staff` — termasuk para Admin Platform dan akun break-glass `SUPER_ADMIN` milik HCIS. Itu kebalikan dari pemisahan yang ADR-0006 R-1 susun, dan membuat H-10 di §3 tidak ada artinya.

**Menunggu keputusan owner**, dua jalan: cabut `manage-users` dan kembali ke jalur berbutir halus HUB-IMPL-013, atau amandemen tertulis pada HUB-IMPL-013 yang membatalkan larangannya dengan alasan dan penerimaan owner. `DRAFT` sampai dijawab.

### 1.3 Apa yang terbukti soal saklar token exchange

Percobaan 2026-10-31 menyelesaikan pertanyaan yang tidak bisa dijawab dengan membaca:

- `kcadm get clients/<id> --fields attributes` menampilkan `{ }` **baik saat exchange berhasil mau pun setelah dimatikan**. Pembacaan atribut tidak dapat dipakai sebagai bukti keadaan saklar, ke arah mana pun.
- Yang bisa dipakai hanya percobaan. Dengan saklar menyala, exchange menjawab `200`; setelah disetel `false`, `400 "Standard token exchange is not enabled for the requested client"`.
- Jadi nama atribut `standard.token.exchange.enabled` **benar dan berpengaruh**; hanya pembacaannya yang tidak dapat dipercaya.

Satu kesimpulan menyusul dari situ. Bila saklar pada `sq-hub` mati, exchange governance akan gagal dengan galat yang sama, Hub menyembunyikan kartunya, dan HCIS tidak pernah dihubungi. Padahal HUB-IMPL-021 mencatat HCIS menjawab **404** untuk path registry pada 2026-10-18. Maka saklar pada `sq-hub` **sudah menyala sejak sebelum itu**, dan K-4 di dokumen ini kemungkinan besar tidak mengubah apa pun untuk `sq-hub`. Tetap dijalankan sebagai penegasan, bukan sebagai perubahan.

### 1.4 Satu temuan yang perlu ditindaklanjuti di luar spesifikasi ini

`docs/operations/HUB-IMPL-021-token-exchange.md` berstatus "PREPARED, NOT APPLIED", tetapi penelusuran realm 2026-10-31 menunjukkan client scope `sq-governance-hcis` dan `sq-governance-aset-sq` **sudah ada**, dan §4 dokumen itu sendiri mencatat koreksi production 2026-10-18. Status di kepalanya tertinggal dari isinya sendiri. Pemiliknya HUB-IMPL-021, bukan dokumen ini.

**Ditarik.** Revisi 1 dokumen ini menyimpulkan Ringkasan Yayasan "kemungkinan belum pernah bekerja", dari penelusuran yang tidak menemukan atribut token exchange pada client mana pun. Kesimpulan itu keliru dan dicabut; §1.3 menjelaskan kenapa pembacaan atribut tidak membuktikan apa-apa. Dicatat di sini, bukan dihapus diam-diam, supaya siapa pun yang pernah membaca klaim lama menemukan bantahannya.

---

## 2. Yang Hub kirim ke HCIS

### H-1 — Katalog peran datang dari HCIS

Layar pemberian peran membaca `GET /internal/v1/role-administration/catalog` dan menampilkan apa adanya. Rute itu mengembalikan `roleId`, `roleKey`, `name`, `description`, `permissions[]`, `allowedScopes`, dan `mandateRequired`. **`roleId` yang dikirim kembali pada POST**, bukan `roleKey`.

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

### H-2b — Pencabutan peran

Scope dan Outcome menyebut "memberi **dan mencabut**", tetapi rancangan sebelumnya hanya menulis POST. Bentuk pencabutannya tidak lazim dan tidak akan ditebak benar:

```text
DELETE {hcis}/internal/v1/role-administration/role-assignments/{assignmentId}
Authorization: Bearer <token mesin>
X-SQ-Actor-Assertion: <assertion, audience hcis-role-administration-actor>
Content-Type: application/json

{ "requestId": "<uuid>" }
```

`requestId` ada di **body**, pada sebuah DELETE. Pencabutan **membelanjakan assertion** persis seperti pemberian, jadi ia juga menuntut assertion sendiri. Jawaban berhasil adalah `204` tanpa isi.

### H-2c — Umur assertion menentukan kapan ia diterbitkan

Assertion ditolak HCIS bila umurnya melewati `HCIS_ROLE_ADMIN_ACTOR_MAX_AGE_SECONDS` (bawaan 60 detik, maksimum 300) — dihitung dari `iat`, bukan dari kedaluwarsanya. Maka Hub menerbitkan assertion **tepat sebelum** panggilan yang memakainya, bukan saat layar dimuat.

Implementasi yang menerbitkan satu assertion di awal lalu memakainya setelah operator mengisi formulir akan gagal `401` secara acak, tergantung berapa lama operator mengetik — kegagalan yang paling sulit dilacak karena tampak sesekali.

### Jawaban HCIS yang harus ditangani

| Status | Kode | Arti bagi operator |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | skema params atau body gagal — termasuk bila body masih memuat `actor` |
| 401 | `UNAUTHENTICATED` | salah satu dari kedua bukti tidak terkirim |
| 403 | `FORBIDDEN_CLIENT` | token mesin sah tetapi client-nya di luar allowlist HCIS, atau scope-nya kurang. Berbeda dari 401: kredensialnya terbaca, kewenangannya tidak ada |
| 403 | `ROLE_GRANT_ACTOR_INVALID` | aktor bukan akun pegawai aktif. Kemungkinan penolakan paling sering di dunia nyata |
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

Maka: **menjadikan seseorang Admin Platform aktif** menuntut **dua Admin Platform berbeda**, dan **tidak seorang pun boleh menjadikan dirinya sendiri**. Pencabutan tidak menuntut empat mata — mempersulit pencabutan akses justru berbahaya.

**Dirumuskan sebagai "menjadikan aktif", bukan "menambah baris", dan itu bukan soal kata.** `platform_administrators` adalah `UNIQUE (identity_issuer, identity_subject)` dengan `status IN ('active','revoked')`, dan `repository.ts` mengimplementasikan `grant()` sebagai satu UPSERT yang menyetel `status = 'active'`. Mengaktifkan kembali identitas yang pernah dicabut **tidak menambah baris**; ia UPDATE. Aturan yang berbicara tentang baris karena itu punya jalan pintas yang rapi: A mencabut B sendirian (memang diizinkan), lalu mengaktifkannya lagi sendirian. Empat mata tidak pernah terlibat.

**Butuh perubahan database.** Bentuk usulan-lalu-konfirmasi menuntut keadaan ketiga, sedangkan `CHECK (status IN ('active','revoked'))` dan pasangan `granted_at`/`revoked_at` melarangnya. Migration beserta rencana pemulihannya adalah bagian dari implementasi ini, bukan sesudahnya (`AGENTS.md` §11).

**Dan hari ini belum ada yang bisa melakukannya.** Tidak ada satu pun rute HTTP yang membuat Admin Platform: `registerPlatformAdminRoutes` hanya memaparkan `/admin/context`, `/admin/applications`, `/admin/staff*`, `/admin/application-access/*`, dan `/admin/audit`; `PlatformAdminService.grant` tidak punya pemanggil di `src/`. Jadi serangan yang H-9 bahas belum dapat dijalankan lewat Hub. Aturannya tetap benar untuk dipasang sebelum rutenya ada — itu justru saat yang tepat — tetapi jangan dibaca seolah menutup lubang yang menganga sekarang.

`DRAFT`: usulan kedaluwarsa setelah 7 hari. Keputusan owner kalau angkanya berbeda.

### H-10 — Reset kata sandi sesama Admin Platform dilarang lewat Hub

`manage-users` mencakup pengelolaan credential. Seorang Admin Platform bisa mereset kata sandi Admin Platform lain, masuk sebagai orang itu, lalu memberi dirinya peran apa pun. Reset kata sandi pada dasarnya adalah penyamaran dengan satu baris log tambahan.

Maka Hub **menolak** reset kata sandi untuk akun yang merupakan Admin Platform. Akun seperti itu hanya lewat konsol Keycloak, yang memang sengaja dipertahankan sebagai kunci cadangan.

**Dua batas yang harus dinyatakan, karena tanpanya H-10 terbaca lebih kuat daripada yang sebenarnya.**

Pertama, hari ini Hub **tidak punya** operasi reset kata sandi umum untuk ditolak. Satu-satunya jalur adalah `sendPasswordInitialization` (`apps/api/src/modules/identity-management/client.ts`), yang hanya berlaku untuk akun yang belum pernah diaktifkan dan mengirim surel ke alamat akun itu sendiri — bukan menyetel kredensial. Jadi H-10 adalah aturan untuk operasi yang **akan** ada, bukan penjagaan atas yang sudah ada. Tulis begitu, jangan seolah sudah menutup sesuatu.

Kedua, dan lebih penting: kemampuan yang ditakuti H-10 hidup di **akun mesin Keycloak**, bukan di Hub. Siapa pun yang memegang secret `sq-hub-identity-management` — atau jalur kode Hub mana pun di masa depan — memanggil admin API Keycloak langsung dan melewati pemeriksaan Hub sama sekali. Selama §1.2 belum dijawab, H-10 adalah polisi tidur, bukan pagar. Pagarnya adalah tidak memberikan `manage-users` sejak awal.

`DRAFT`: "peran istimewa modul" dikeluarkan dari v1. Hub belum tahu peran mana di tiap modul yang istimewa, dan menanyakannya ke tiap aplikasi adalah pekerjaan tersendiri.

### H-11 — Daftar Admin Platform terlihat tanpa akses database

Daftar Admin Platform dan setiap perubahannya tampil di layar audit yang bisa dibaca owner sendiri. Lingkaran yang tersisa ada di luar HCIS, jadi deteksinya juga harus di luar HCIS — dan deteksi yang menuntut akses database bukan deteksi.

Sebagian sudah ada, dan H-11 **memperluas**, bukan menciptakan: `platform_audit_events` ada, `platform-admin/repository.ts` sudah menulis `platform_admin.grant` dan `platform_admin.revoke` ke sana, dan `GET /admin/audit` sudah membacanya. Dua hal yang kurang, dan keduanya menentukan apakah layar itu berguna:

1. `makePlatformAdminTargetRef` menyimpan sasaran sebagai `platform-admin:<sha256(issuer+subject)>`, dan `toBrowserAudit` menyaring kunci payload, sehingga tidak ada yang mengidentifikasi orang sampai ke browser. Owner akan melihat **bahwa** seorang admin berubah dan **tidak melihat siapa**. Perlu cara menyelesaikan hash itu menjadi orang, untuk pembaca yang memang berhak.
2. Tidak ada endpoint yang menampilkan daftar Admin Platform saat ini sama sekali; `PlatformAdminService.show` tidak punya rute.

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
1b. **Pengguna Hub yang bukan Admin Platform ditolak, dan ditolak sebelum token exchange dicoba.** Diuji dengan dua akun: satu Admin Platform, satu pegawai biasa yang punya akses aplikasi HCIS. Yang kedua tidak boleh menghasilkan satu pun permintaan exchange ke Keycloak.
1c. Pencabutan peran berhasil lewat H-2b dan menghasilkan `204`, dengan audit `role.assignment.removed` di HCIS.
2. Katalog peran yang ditampilkan berasal dari `GET /catalog`; tidak ada `roleKey` HCIS yang tertulis di kode Hub.
3. Memberi peran kepada diri sendiri ditolak, dan pesannya mengatakan kenapa.
4. Assertion yang sama dipakai dua kali ditolak `409`, dan Hub menerbitkan yang baru alih-alih mengulang.
5. `requestId` yang sama dikirim dua kali tidak menghasilkan dua assignment.
6. Saat `HCIS_ROLE_ADMIN_ENABLED` masih `0`, layar menampilkan keadaan "belum aktif", bukan kerusakan.
7. Assertion aktor tidak pernah muncul di respons browser, di log aplikasi, atau di penyimpanan. Diuji dengan tiga pernyataan yang bisa gagal: tidak ada nilai `X-SQ-Actor-Assertion` di baris log mana pun selama satu pemberian peran; tidak ada kolom yang menyimpannya; tidak ada badan respons yang memuatnya.
8. Token Hub biasa yang **bukan** hasil exchange ditolak kanal HCIS. **Tidak dapat diuji di CI SQ Hub**: penegaknya HCIS dan Keycloak, bukan Hub. Diverifikasi saat rollout bersama probe HUB-IMPL-021, dan dilaporkan di situ.
9. Menambah Admin Platform menuntut dua orang berbeda, dan menambahkan diri sendiri ditolak.
10. Reset kata sandi untuk akun Admin Platform ditolak lewat Hub, dengan pesan yang menunjuk konsol Keycloak.

## 6. Gate kualitas (AGENTS.md §11, jalur auth)

Wajib diperiksa dan dilaporkan apa adanya, termasuk yang tidak bisa dijalankan:

identity mapping; perilaku fail-closed; penyimpanan token; keamanan cookie; Application Access; kontinuitas otorisasi lokal; logout; backup/restore; latihan rollback.

Catatan jujur sejak sekarang, tiga hal yang **tidak dapat dijalankan dari CI** dan karena itu tidak boleh diklaim lulus di PR:

- latihan rollback dan backup/restore — keduanya menyentuh Keycloak dan database production;
- AC 8 — penegaknya HCIS dan Keycloak, bukan Hub;
- uji assertion aktor dari ujung ke ujung — menuntut token sesi manusia yang tidak dapat diperoleh tanpa login.

Ketiganya dijalankan owner saat rollout dan dilaporkan di situ.

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
| **menunggu owner** | K-1: cabut `manage-users`, atau amandemen tertulis pada HUB-IMPL-013 (§1.2) |
| **menunggu owner** | Menjalankan K-4/K-5 pada `sq-hub`, karena saklarnya dipakai bersama Ringkasan Yayasan (§1.3) |
| `DRAFT` | Scope exchange diparameterkan, bukan dinamai ulang agar muat ke prefix `sq-governance-` |
