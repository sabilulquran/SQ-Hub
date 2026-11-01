# HUB-IMPL-023 — Admin Platform memberi peran HCIS

**Status:** **ACCEPTED**, revisi 6, 2026-11-01. Diterima di bawah keputusan berdiri owner 2026-10-27 ("bypass semua approval, sesuai rencana semua, jangan berhenti sebelum closed sesuai PRD"), bukan di bawah pembacaan dokumen ini satu per satu oleh Product Owner. Perbedaannya perlu dinyatakan: yang owner setujui adalah **rencananya berjalan tanpa menunggu persetujuan per langkah**, bukan bahwa setiap kalimat di sini sudah ia baca. Asumsi yang belum ia putuskan tetap bertanda `DRAFT` di §8 dan tidak ikut diterima.

Penerapan di Mi8VPS tetap menuntut review, CI, dan pengaman teknis rilis yang sudah berlaku.
**Product:** SQ Hub
**Area:** Admin Center / identitas dan akses
**Date:** 2026-11-01
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
| ~~**K-1**~~ | ~~`manage-users` pada akun mesin `sq-hub-identity-management`~~ | **DITERAPKAN lalu DICABUT 2026-10-31** atas keputusan owner — §1.2, akibatnya §1.4 |
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

**Dijawab owner 2026-10-31: cabut.** Dijalankan hari itu juga. §1.4 mencatat apa yang sesudahnya benar-benar berubah — yang ternyata bukan apa yang pencabutnya kira.

### 1.3 Apa yang terbukti soal saklar token exchange — dan satu hal yang hanya disimpulkan

Percobaan 2026-10-31 menyelesaikan pertanyaan yang tidak bisa dijawab dengan membaca:

- `kcadm get clients/<id> --fields attributes` menampilkan `{ }` **baik saat exchange berhasil mau pun setelah dimatikan**. Pembacaan atribut tidak dapat dipakai sebagai bukti keadaan saklar, ke arah mana pun.
- Yang bisa dipakai hanya percobaan. Dengan saklar menyala, exchange menjawab `200`; setelah disetel `false`, `400 "Standard token exchange is not enabled for the requested client"`.
- Jadi nama atribut `standard.token.exchange.enabled` **benar dan berpengaruh**; hanya pembacaannya yang tidak dapat dipercaya.

**Yang berikut ini kesimpulan, bukan bukti.** Ia bersandar pada dua hal yang belum diuji: bahwa `404` pada 2026-10-18 benar-benar datang dari HCIS dan bukan dari proxy di depannya, dan bahwa jalur itu memang melewati token exchange. Dibiarkan di sini karena berguna, tetapi tidak boleh dipakai sebagai dasar keputusan tanpa diuji ulang. Bila saklar pada `sq-hub` mati, exchange governance akan gagal dengan galat yang sama, Hub menyembunyikan kartunya, dan HCIS tidak pernah dihubungi. Padahal HUB-IMPL-021 mencatat HCIS menjawab **404** untuk path registry pada 2026-10-18. Maka saklar pada `sq-hub` **sudah menyala sejak sebelum itu**, dan K-4 di dokumen ini kemungkinan besar tidak mengubah apa pun untuk `sq-hub`. Tetap dijalankan sebagai penegasan, bukan sebagai perubahan.

### 1.4 Apa yang sebenarnya berubah ketika `manage-users` dicabut

Peran langsung `service-account-sq-hub-identity-management` pada `realm-management` kini tinggal `query-users`, dan token client-credentials-nya hanya membawa itu.

**Koreksi terhadap laporan pertama.** Skrip pencabutan dan laporannya menyatakan "setelah ini SQ Hub kembali tidak dapat membuat, menonaktifkan, atau mereset kata sandi pengguna". Itu **salah**. Realm `sq-staff` memakai Fine-Grained Admin Permissions v2 (`adminPermissionsEnabled = true`, client `admin-permissions`), dan jalur berbutir halus yang HUB-IMPL-013 maksud **bukan** pekerjaan yang masih tertunda — ia sudah terpasang:

| permission FGAP | scope | isi |
| --- | --- | --- |
| `staff lifecycle: view and manage users` | view, manage | resource type Users, policy = SA identity-management |
| `staff lifecycle: deny service accounts` | impersonate, manage, manage-group-membership, map-roles, view | policy negatif atas daftar akun mesin |

Jadi SQ Hub tetap dapat mengelola akun staf sesudah pencabutan, lewat FGAP, dan memang itu yang diinginkan. Yang benar-benar hilang adalah **`map-roles`**. Bukti perilaku terhadap akun staf owner sesudah pencabutan:

| panggilan | jawaban | artinya |
| --- | --- | --- |
| `GET users/{id}` | `200` | view lolos lewat FGAP |
| `POST users/{id}/role-mappings/realm` dengan `[]` | `403` | map-roles hilang — inilah beda nyata |
| `DELETE users/{id}/consents/<client tak ada>` | `404` | manage lolos lewat FGAP, sesuai HUB-IMPL-013 |

Itulah pemisahan yang dicari ADR-0006 R-1: SQ Hub mengurus akun, tetapi tidak dapat mengubah peran realm siapa pun — termasuk Admin Platform dan akun break-glass `SUPER_ADMIN` milik HCIS.

**Satu batas pada bukti di atas, menurut aturan §1.5 sendiri.** Baris `role-mappings` dijalankan hanya sesudah pencabutan, tanpa keadaan "sebelum" dan tanpa subjek pembanding dalam run yang sama. Aturan 1 dan 2 di §1.5 melarang persis itu. Urutan validasi-vs-otorisasi untuk `POST .../role-mappings/realm` dengan badan `[]` juga belum dibuktikan di realm ini — jebakan yang sama bentuknya dengan `POST users` berbadan `{}`. Jadi kesimpulan "yang hilang adalah `map-roles`" berstatus `DRAFT` sampai probe itu diulang berpasangan: satu subjek yang diharapkan ditolak dan satu yang diharapkan lolos, dalam satu run. Dua baris lainnya (`GET users/{id}` dan `DELETE .../consents/...`) tidak terkena batas ini: keduanya dijalankan berpasangan terhadap subjek terlindungi dan tidak terlindungi.

### 1.5 Sumber dan urutan pemeriksaan izin menentukan probe mana yang berarti

Dua kali berturut-turut, probe yang dipilih untuk membuktikan pencabutan ternyata tidak sah. Keduanya gagal dengan cara yang sama berbahayanya: **jawabannya terbaca meyakinkan**.

| probe | kenapa tampak masuk akal | kenapa tidak sah |
| --- | --- | --- |
| `PUT users/<uuid acak>` | menulis ke pengguna, mestinya menuntut izin tulis | `UsersResource.user(id)` menjawab `404` bagi siapa pun yang `canQuery()`, **sebelum** izin manage diperiksa. `query-users` sengaja tetap ada, jadi hasilnya `404` sebelum mau pun sesudah pencabutan |
| `POST users` dengan badan `{}` | validasi nama pengguna terjadi sesudah pemeriksaan manage, jadi `400` berarti diizinkan | benar soal urutan, salah soal **sumber**: izin manage datang dari FGAP, bukan dari `realm-management`. Hasilnya `400` sebelum mau pun sesudah pencabutan |

Yang pertama akan membaca pencabutan yang berhasil sebagai kegagalan; yang kedua benar-benar melakukannya, dan melaporkan "BAHAYA" atas perubahan yang justru berjalan benar.

Aturan untuk siapa pun yang menulis skrip verifikasi berikutnya:

1. **Sebuah probe hanya sah bila ia terbukti berbeda jawabannya antara kedua keadaan.** Tunjukkan pembandingnya: satu subjek yang diharapkan tertutup dan satu yang diharapkan terbuka, dalam run yang sama.
2. Jangan menyimpulkan dari satu kode status saja. `403` berbeda dari `404` berbeda dari `400`, dan tiap-tiapnya bisa datang dari pemeriksaan yang sama sekali lain.
3. Di realm ber-FGAP, mencabut peran `realm-management` tidak otomatis menutup apa pun: periksa permission FGAP juga.
4. `000`, badan kosong, dan `5xx` berarti **tidak terbukti**, bukan tertutup.

Probe yang terbukti sah di realm ini, dan karena itu dipakai seterusnya: `GET users/{id}` berpasangan dengan `DELETE users/{id}/consents/<client yang tidak ada>` — `403/403` untuk subjek yang terlindungi, `200/404` untuk yang tidak.

### 1.6 Drift: daftar akun mesin yang dilindungi tidak ikut bertambah

Seluruh seksi ini menggambarkan keadaan **sampai 2026-11-01 08:31 UTC**, ketika (D) menutupnya. Ditulis dalam bentuk lampau; penutupannya ada di akhir seksi.

Permission `staff lifecycle: deny service accounts` menyebut akun mesin **satu per satu**. Daftarnya dibuat saat HUB-IMPL-013 dipasang dan berisi **7** resource. Realm ternyata punya **12** akun mesin, jadi **lima** tidak terlindungi: `karir-sq-api`, `keluarga-sq-api`, `spmb-api`, `sq-hub-role-administration`, dan akun mesin milik client `admin-permissions` sendiri. Kelimanya terbukti lewat probe menjawab `200/404`, sedangkan `hcis-api` sebagai pembanding menjawab `403/403`.

> **Koreksi.** Revisi 3 seksi ini menulis "11 akun mesin" dan "empat yang tidak terlindungi". Keduanya salah; angka sebenarnya 12 dan lima. Angka lama berasal dari hitungan manual — persis metode yang seksi ini pakai sebagai contoh kegagalan. Dicatat di sini, bukan dihapus, karena kekeliruannya adalah buktinya.

Akibatnya, selama itu SQ Hub dapat menonaktifkan akun mesin Karir, SPMB, atau Keluarga. Bahwa `sq-hub-role-administration` termasuk berarti kanal pemberian peran HCIS sendiri dapat dimatikan dari Hub.

**Yang paling berat adalah yang paling tidak terduga.** `admin-permissions` adalah resource server yang **menegakkan permission deny itu sendiri**. Service account-nya tidak terlindungi, sehingga SQ Hub — lewat `staff lifecycle: view and manage users` yang memang sengaja dipasang — dapat menyentuh akun mesin dari kendali yang seharusnya menahannya. Kendali yang dapat mematikan dirinya sendiri bukan kendali. Jendela paparannya membentang dari pemasangan HUB-IMPL-013 sampai 2026-11-01. Tidak ada bukti bahwa itu pernah dipakai, dan tidak ada pula bukti sebaliknya, karena tidak ada yang mengawasinya.

**Lima akun, tiga sebab yang berbeda.** `karir-sq-api`, `keluarga-sq-api`, dan `spmb-api` dibuat setelah HUB-IMPL-013 dipasang dan tidak pernah didaftarkan — drift biasa. `sq-hub-role-administration` lain: client itu **baru dibuat oleh K-2 pada 2026-10-31** (§1.1), dalam penerapan spesifikasi ini, dan langkah pendaftarannya terlewat pada hari yang sama, sehingga pelanggaran pertama D-DRIFT-2 dilakukan oleh dokumen yang menetapkan D-DRIFT-2. Dan `admin-permissions` bukan keduanya: ia sudah ada sejak FGAP dipasang dan **tidak pernah terpikirkan**, karena tidak seorang pun menduga sebuah resource server punya service account.

Ketiga sebab itu menuntut obat yang sama, dan hanya satu obat: daftar yang diambil dari realm. Kelalaian masih bisa diingatkan; yang tidak terpikirkan tidak bisa diingatkan. Ia hanya dapat ditemukan oleh pemeriksaan yang tidak bertanya kepada manusia apa saja isinya.

Tidak ada yang rusak, tidak ada yang memberi tanda, dan selisihnya hanya terlihat kalau seseorang sengaja membandingkan. Inilah bentuk "sudah diset lalu terlewat" yang owner minta jangan terulang.

**D-DRIFT-1 — pemeriksaan drift.** Harus ada langkah yang membandingkan daftar akun mesin realm dengan daftar resource permission tersebut, dan menyatakan **TIDAK LULUS** bila tidak sama. Daftar akun mesin diambil dari realm (client yang `serviceAccountsEnabled`, lalu `clients/{id}/service-account-user`), bukan dari daftar yang ditulis tangan di mana pun — daftar tangan adalah persis penyebab masalah ini. `kc-auth014-d-kecualikan-akun-mesin.sh` tanpa `--apply` sudah menjalankan pembandingan itu dan tidak mengubah apa pun, jadi ia dapat dipakai langsung sebagai pemeriksaannya.

**D-DRIFT-2 — checklist onboarding aplikasi baru.** Setiap aplikasi SQ Core baru yang membawa service account menambahkan satu langkah wajib: daftarkan akun mesinnya pada permission tersebut, lalu buktikan `403/403` dengan probe §1.5. Langkah ini masuk ke prosedur onboarding, bukan ke ingatan seseorang.

Keduanya `DRAFT` sampai owner menyetujui tempat pemeriksaannya dijalankan; isinya tidak menunggu siapa pun.

**Ditutup 2026-11-01 08:31 UTC.** Resource pada permission bertambah dari **7 menjadi 12**, dan seluruh 12 akun mesin terbukti menjawab `403/403`; kontrol akun staf tetap `200/404`. Akun mesin `admin-permissions` yang ditambahkan adalah `5b8e081c-4f72-44fd-b970-ef3dc11421c5`.

Itu pembenaran D-DRIFT-1 yang paling langsung: pemeriksaan yang mengambil daftarnya **dari realm** menemukan satu akun yang tidak akan pernah masuk daftar tulisan tangan. Pemeriksaan yang dibuat dari daftar nama akan lulus sambil meninggalkan akun mesin paling berwenang di realm tetap terbuka.

Badan PUT terbukti membawa `resourceType: Users`, 5 scope, dan 1 policy. Itu menjawab kekhawatiran nyata pada saat skrip ditulis: PUT bersifat replace, dan representasi **daftar** sebuah permission tidak dijamin membawa `resourceType`, sehingga badan yang disusun darinya dapat mengubah jenis permission itu sendiri. Skrip berangkat dari representasi tunggal dan menolak jalan bila ada field yang hilang dibanding baris daftar. Perlu dinyatakan jujur: itu **terbukti sesudah dijalankan**, bukan sebelumnya. Yang membuat risikonya dapat diterima bukan keyakinan, melainkan penjagaannya.

**Rollback belum pernah dijalankan.** Jalurnya adalah satu PUT tanpa kelima resource itu, dan menurut bentuk perubahannya restore database tidak diperlukan. Itu kesimpulan beralasan, bukan latihan yang pernah lulus — §6 menempatkan latihan rollback di antara hal yang tidak dapat dijalankan dari CI, dan standar itu berlaku untuk kalimat ini juga. Backup sebelum penerapan: `backup-keycloak-auth014-d-20261101-153000-an/sqcore_keycloak.dump`.

### 1.7 Satu temuan yang perlu ditindaklanjuti di luar spesifikasi ini

`docs/operations/HUB-IMPL-021-token-exchange.md` berstatus "PREPARED, NOT APPLIED", tetapi penelusuran realm 2026-10-31 menunjukkan client scope `sq-governance-hcis` dan `sq-governance-aset-sq` **sudah ada**, dan §4 dokumen itu sendiri mencatat koreksi production 2026-10-18. Status di kepalanya tertinggal dari isinya sendiri. Pemiliknya HUB-IMPL-021, bukan dokumen ini.

**Ditarik.** Revisi 1 dokumen ini menyimpulkan Ringkasan Yayasan "kemungkinan belum pernah bekerja", dari penelusuran yang tidak menemukan atribut token exchange pada client mana pun. Kesimpulan itu keliru dan dicabut; §1.3 menjelaskan kenapa pembacaan atribut tidak membuktikan apa-apa. Dicatat di sini, bukan dihapus diam-diam, supaya siapa pun yang pernah membaca klaim lama menemukan bantahannya.

---

## 2. Yang Hub kirim ke HCIS

### H-1 — Katalog peran datang dari HCIS

Layar pemberian peran membaca `GET /internal/v1/role-administration/catalog` dan menampilkan apa adanya. Rute itu mengembalikan `roleId`, `roleKey`, `name`, `description`, `permissions[]`, `allowedScopes`, dan `mandateRequired`. **`roleId` yang dikirim kembali pada POST**, bukan `roleKey`.

**Jangan menyalin daftar peran HCIS ke kode Hub.** Peran HCIS berubah di HCIS; salinan di Hub akan melenceng tanpa ada yang tahu, dan `AGENTS.md` §4 menegaskan ownership data harus eksplisit.

### H-1b — Orang diterjemahkan menjadi akun HCIS oleh HCIS

Hub mengenal orang sebagai **subject Keycloak**; HCIS mengenalnya sebagai **id akun**, dan kedua id itu tidak bertemu di tempat lain. Rute HCIS `GET /internal/v1/role-administration/accounts?issuer=&subject=&page=&pageSize=` menjembataninya, dan sudah ada di `main` HCIS (PR #252, `7cb2d35`; HCIS AUTH-014 §2.1b).

```json
{
  "account": { "accountId": "…", "grantable": true, "notGrantableReason": null },
  "assignments": {
    "items": [ { "assignmentId": "…", "roleId": "…", "roleKey": "…", "roleName": "…",
                 "scopeType": "unit", "organizationalUnitId": "…", "organizationalUnitName": "…",
                 "startsOn": "2026-01-01", "endsOn": null, "createdAt": "…",
                 "revocableViaHub": true } ],
    "pagination": { "page": 1, "pageSize": 25, "total": 1, "pageCount": 1 }
  }
}
```

**Alternatif yang ditolak.** Rancangan sementara yang sempat diusulkan adalah operator menyalin `accountId` dan `assignmentId` dengan tangan dari layar baca-saja HCIS. Ditolak karena dua hal. HCIS §8 menjadwalkan layar itu **dihapus** ketika kewenangannya pindah, sehingga v1 akan dibangun di atas sesuatu yang memang akan hilang. Dan salah tempel `accountId` memberi peran kepada **orang lain**, dengan audit yang terlihat sah sepenuhnya — kesalahan yang tidak meninggalkan jejak sebagai kesalahan.

**Yang Hub lakukan** (diterapkan di PR #169, `3d4702a`):

- operator memilih orang dari direktori Akun SQ; perintah pemberian dan pencabutan di Hub menerima **subject**, bukan id HCIS, sehingga tidak ada id HCIS yang pernah diketik manusia;
- Hub memanggil `GET /accounts` **di dalam aksi yang sama**, lalu memakai `accountId` yang baru diterima. Itu syaratnya: id yang dipakai harus berasal dari pembacaan pada saat aksi, bukan dari state layar yang bisa sudah basi. Syarat ini **tidak** berarti satu panggilan per operasi — lihat catatan audit di bawah;
- Hub hanya menawarkan pencabutan untuk assignment yang tercantum bagi orang itu dengan `revocableViaHub = true`;
- Hub menolak pemberian dan pencabutan terhadap diri sendiri (`ROLE_ADMIN_SELF_FORBIDDEN`) **sebelum** exchange, seperti H-0;
- **Satu assertion dipakai bersama oleh semua pembacaan dalam satu aksi; tiap perubahan membawa assertion sendiri.** Jadi satu pemberian adalah satu `jti` baca ditambah satu `jti` POST, dan satu pencabutan satu `jti` baca ditambah satu `jti` DELETE — berapa pun halaman yang perlu ditelusuri. Rancangan sebelumnya menerbitkan exchange baru per panggilan; itu benar secara keamanan tetapi membuat satu pencabutan yang sah tampak sebagai belasan pembacaan tak berkaitan di audit HCIS.

**Dua batas yang HCIS terapkan, dan Hub tidak boleh menebak sebaliknya:**

1. **Pembacaan menuntut aktor yang sah memberi peran.** HCIS menjalankan `assertRoleGrantor` juga pada rute ini, jadi aktor yang bukan akun pegawai aktif dijawab `403 ROLE_GRANT_ACTOR_INVALID` **untuk membaca**, bukan hanya untuk menulis. Admin Platform yang tidak punya akun pegawai HCIS tidak dapat memakai layar ini sama sekali; itu konsekuensi ADR-0006 D-3 yang memang disengaja, bukan kerusakan, dan perlu tertulis supaya orang pertama yang menemuinya tidak melaporkannya sebagai bug lalu "memperbaikinya" dengan melonggarkan sesuatu.

   Pemeriksaan itu **bukan** gerbang kewenangan. Ia hanya memastikan aktornya pegawai aktif. **H-0 tetap satu-satunya pemeriksaan kewenangan, termasuk untuk membaca** — jangan membaca `assertRoleGrantor` di sisi HCIS sebagai penggantinya.
2. **`404 ROLE_ADMIN_ACCOUNT_NOT_FOUND` menutupi dua keadaan.** Subject tanpa akun HCIS, dan subject yang akunnya bukan akun pegawai (`FOUNDATION_BOARD`, `SUPER_ADMIN`), dijawab sama. Itu disengaja: `403` akan menjadikan rute ini cara mengetahui subject mana yang memegang akun istimewa. Hub karena itu **tidak boleh** menampilkan "akun ini istimewa" berdasarkan rute ini — informasinya memang tidak tersedia, dan menebaknya dari ketiadaan akan salah untuk orang yang sekadar belum punya akun HCIS.

**Tidak ada identitas di jawaban** — tidak ada surel, nama, nomor identitas, mau pun status kepegawaian. Hub sudah tahu siapa orangnya, karena Hub yang mengirim `subject`. Yang dikembalikan hanya alasan sebuah pemberian akan ditolak (`account_inactive`, `employee_inactive`): cukup untuk memperingatkan operator sebelum mengirim, tidak cukup untuk menjadikan kanal peran sebuah jalur pembacaan data pegawai.

**Setiap pembacaan tercatat di HCIS** sebagai `role.account.lookup` dengan `jti` assertion. Karena semua pembacaan dalam satu aksi berbagi satu assertion, satu aksi muncul sebagai satu `jti` baca, bukan serentetan.

Itu bukan kerapian belaka. `jti` adalah satu-satunya cara memisahkan pemakaian biasa dari enumerasi; kalau pemakaian biasa sendiri sudah berisik, yang tidak biasa tidak lagi menonjol. Rancangan 2026-11-01 pagi masih menerbitkan exchange per panggilan, sehingga satu pencabutan dapat tampil sebagai sebelas pembacaan tak berkaitan — ditemukan review dan ditutup di SQ-Hub#169 `5258412`. Dicatat di sini karena kekeliruannya masuk akal: "satu assertion per panggilan" terdengar lebih aman daripada "satu assertion per aksi", padahal yang dikorbankan adalah kemampuan mendeteksi.

Layar Hub memaginasi penugasan dengan tombol Sebelumnya/Berikutnya, 25 per halaman, jadi tidak ada pengecualian ENG-LIST-001 untuk dicatat di sini.

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

**Diterapkan bersama rutenya (SQ-Hub#169).** Sebelum PR itu tidak ada rute HTTP yang membuat Admin Platform. Kini satu-satunya jalur Hub adalah `/admin/platform-administrators/proposals` lalu `/confirm` oleh admin kedua; aturannya diperiksa di transaksi yang mengaktifkan, dengan baris terkunci, dan dijaga CHECK di tabel `platform_admin_proposals` (migration 0012). Mengaktifkan kembali sesudah dicabut menuntut usulan baru dan orang kedua. CLI `platform:admin grant` tetap jalur bootstrap/break-glass yang menuntut akses shell ke host Hub; itu di luar model ancaman Hub.

`DRAFT`: usulan kedaluwarsa setelah 7 hari. Keputusan owner kalau angkanya berbeda.

### H-10 — Reset kata sandi sesama Admin Platform dilarang lewat Hub

Akun mesin SQ Hub dapat mengelola credential pengguna staf. Kemampuan itu datang dari permission FGAP `staff lifecycle: view and manage users` (§1.4), bukan dari `manage-users` yang sudah dicabut; revisi sebelumnya dokumen ini menyebut sumber yang salah. Seorang Admin Platform karenanya bisa mereset kata sandi Admin Platform lain dan masuk sebagai orang itu. Reset kata sandi pada dasarnya adalah penyamaran dengan satu baris log tambahan.

Maka Hub **menolak** reset kata sandi untuk akun yang merupakan Admin Platform. Akun seperti itu hanya lewat konsol Keycloak, yang memang sengaja dipertahankan sebagai kunci cadangan.

**Dua batas yang harus dinyatakan, karena tanpanya H-10 terbaca lebih kuat daripada yang sebenarnya.**

Pertama, Hub **tidak punya** operasi reset kata sandi umum. Satu-satunya jalur kredensial adalah `sendPasswordInitialization`, yang hanya berlaku untuk akun yang belum pernah diaktifkan dan mengirim surel ke alamat akun itu sendiri — bukan menyetel kredensial. SQ-Hub#169 memasang penolakan H-10 pada jalur itu (kirim ulang dan provisioning akun yang sudah ada, `PLATFORM_ADMIN_CREDENTIAL_FORBIDDEN`) supaya operasi berikutnya mewarisi tempatnya; jangan dibaca seolah sudah menutup sesuatu yang besar.

Kedua, dan lebih penting: kemampuan yang ditakuti H-10 hidup di **akun mesin Keycloak**, bukan di Hub. Siapa pun yang memegang secret `sq-hub-identity-management` — atau jalur kode Hub mana pun di masa depan — memanggil admin API Keycloak langsung dan melewati pemeriksaan Hub sama sekali.

Pencabutan `manage-users` pada 2026-10-31 **tidak** menutup itu, karena sumbernya FGAP. Jadi H-10 tetap relevan sepenuhnya.

Satu langkah rantai itu kemungkinan sudah terputus di Keycloak: `map-roles` ikut tercabut, sehingga "memberi dirinya peran apa pun" tidak lagi dapat dilakukan lewat akun mesin Hub. Ditulis "kemungkinan" dengan sengaja — §1.4 menurunkan temuan itu ke `DRAFT` karena probenya dijalankan tanpa pembanding, dan H-10 tidak boleh bersandar pada bukti yang dokumen ini sendiri belum terima. Langkah "mereset kata sandi, masuk sebagai orang itu" tidak terputus sama sekali. H-10 menutup sisa itu di sisi Hub, dan hanya di sisi Hub.

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
1b. **Pengguna Hub yang bukan Admin Platform ditolak, dan ditolak sebelum token exchange dicoba.** Yang kedua tidak boleh menghasilkan satu pun permintaan exchange ke Keycloak.

   **Terpenuhi di production 2026-11-01**, sesudah rilis `hub-6e42f718-20261101`: dua sesi sintetis non-admin mencoba saling memberi peran, membaca katalog, mencari akun, dan mencabut — seluruhnya `403 ADMIN_FORBIDDEN`, kontrol `/workspace` `200`, dan **nol** baris `role_administration.exchange` di log Hub. Sesi uji dihapus sesudahnya.

   **Batasnya dinyatakan, karena ia nyata.** Keduanya sesi sintetis, bukan orang yang login. Login sungguhan oleh pegawai bukan Admin Platform tidak mungkin sekarang: HCIS belum live, akun staf masih berstatus *invited*, dan owner melarang aktivasi sebelum go-live. Yang dibuktikan adalah gerbangnya menolak sesi yang bukan Admin Platform; yang belum dibuktikan adalah bahwa akun staf sungguhan memang jatuh ke kategori itu. Pemeriksaan dengan login sungguhan **wajib dilakukan pada hari go-live**, dan tercatat sebagai syarat go-live, bukan syarat penyalaan kanal.
1c. Pencabutan peran berhasil lewat H-2b dan menghasilkan `204`, dengan audit `role.assignment.removed` di HCIS.
2. Katalog peran yang ditampilkan berasal dari `GET /catalog`; tidak ada `roleKey` HCIS yang tertulis di kode Hub.
2b. **Tidak ada id HCIS yang pernah diketik manusia.** Perintah Hub menerima subject, dan `accountId` berasal dari `GET /accounts` dalam aksi yang sama. Diuji dengan satu pemberian penuh dari pemilihan orang sampai `201`, tanpa id HCIS di input mana pun.
2c. Pencabutan hanya ditawarkan untuk assignment dengan `revocableViaHub = true`, dan subject yang tidak punya akun pegawai HCIS menghasilkan pesan "tidak ada akun HCIS", bukan pesan yang membedakan akun istimewa dari ketiadaan akun.
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

identity mapping; perilaku fail-closed; penyimpanan token; keamanan cookie; Application Access; kontinuitas otorisasi lokal; logout; backup/restore; latihan rollback; **pemeriksaan drift D-DRIFT-1** (§1.6).

Catatan jujur sejak sekarang, tiga hal yang **tidak dapat dijalankan dari CI** dan karena itu tidak boleh diklaim lulus di PR:

- latihan rollback dan backup/restore — keduanya menyentuh Keycloak dan database production;
- AC 8 — penegaknya HCIS dan Keycloak, bukan Hub;
- uji assertion aktor dari ujung ke ujung — menuntut token sesi manusia yang tidak dapat diperoleh tanpa login.

Ketiganya dijalankan owner saat rollout dan dilaporkan di situ.

**AC 9** dan **AC 10** kini punya objek uji sejak SQ-Hub#169: rute usulan/konfirmasi Admin Platform (`test/platform-admin-proposals.integration.test.ts`) dan penolakan H-10 pada `sendPasswordInitialization` (`test/staff-lifecycle.test.ts`). AC 10 diuji terhadap satu-satunya jalur kredensial yang ada, bukan terhadap reset kata sandi umum (§3).

Satu lagi yang bukan ketidakmampuan CI melainkan keadaan: **keputusan §1.1 bahwa peminta exchange adalah `sq-hub` belum pernah dijalankan satu kali pun**, karena K-4 dan K-5 belum diterapkan. Ia keputusan beralasan, bukan fakta teruji.

## 7. Rollback

| Langkah | Akibatnya |
| --- | --- |
| Matikan `HCIS_ROLE_ADMIN_ENABLED` di HCIS | kanal menjawab 503; layar Hub menampilkan "belum aktif" |
| Lepas optional scope `role-administration.actor` dari `sq-hub` | exchange gagal; tidak ada yang lain berubah |
| Matikan saklar standard token exchange pada `sq-hub` | **juga mematikan Ringkasan Yayasan** (HUB-IMPL-021). Jangan dipakai sebagai rollback spesifikasi ini |
| ~~Cabut `manage-users` dari `sq-hub-identity-management`~~ | **Bukan rollback, dan kalimat lamanya salah.** Sudah dicabut 2026-10-31, jadi tidak tersedia lagi. Dan ia tidak membuat "Hub kembali tidak bisa mengelola pengguna": pengelolaan akun berjalan lewat FGAP (§1.4). Yang dicabutnya adalah `map-roles` |

Hub tidak menyimpan data peran, jadi tidak ada yang perlu dibersihkan. Yang Hub simpan hanyalah jejak aksinya sendiri di `platform_audit_events` (`requestId`, `roleId`, `assignmentId`, kode HCIS), padanan AUTH-014 H-5; itu catatan bahwa perintah dikirim, bukan salinan daftar peran. Rollback migration 0012 (H-9) ada di kepala berkasnya.

## 8. Asumsi yang belum diputuskan

| Tanda | Asumsi |
| --- | --- |
| `DRAFT` | Empat mata H-9 berbentuk usulan-lalu-konfirmasi dengan kedaluwarsa 7 hari |
| `DRAFT` | "Peran istimewa modul" di H-10 untuk v1 berarti Admin Platform saja |
| `DRAFT` | Audience aktor bernama `hcis-role-administration-actor`; client-nya sudah dibuat 2026-10-31 |
| `TBD` | Apakah aplikasi SQ Core lain memakai kanal berbentuk sama. Rancangan ini tidak memuat apa pun yang khas HCIS selain katalog perannya |
| **diputuskan 2026-10-31** | K-1: owner memilih cabut `manage-users`; sudah dijalankan (§1.2, §1.4) |
| **ditutup 2026-11-01** | Drift akun mesin: 7 → 12 resource, seluruh 12 terbukti `403/403` (§1.6) |
| `DRAFT` | D-DRIFT-1/D-DRIFT-2: tempat pemeriksaan drift dijalankan dan pemilik checklist onboarding (§1.6) |
| **belum diuji** | Jalur rollback (D): satu PUT tanpa kelima resource; belum pernah dilatih (§1.6) |
| `DRAFT` | "Yang hilang karena pencabutan adalah `map-roles`": probe `role-mappings` belum dijalankan berpasangan (§1.4) |
| **diuji 2026-11-01** | AC 9 dan AC 10 punya objek uji sejak SQ-Hub#169 (§6) |
| **menunggu owner** | Menjalankan K-4/K-5 pada `sq-hub`, karena saklarnya dipakai bersama Ringkasan Yayasan (§1.3) |
| `DRAFT` | Scope exchange diparameterkan, bukan dinamai ulang agar muat ke prefix `sq-governance-` |
