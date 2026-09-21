# Akun SQ / SQ Hub — panduan UAT delta production, 21 September 2026

**Status:** READY AS A PROCEDURE; execution results remain NOT_RUN unless evidence already exists.
**Contracts:** HUB-IMPL-003/011/012/016/017, Staff authentication policy.
**Ledger:** [Foundation closure](foundation-v1-closure.md). This guide does not authorize production deployment, realm-wide configuration changes, real-user mutations, or service outages.

## 1. Jangan mengulang pekerjaan yang sudah terbukti

Recovery delivery, successful reset/single-use/expired-link rejection (3.3–3.5) dan basic trusted-device behavior (5.1–5.5) sudah PASS dalam [matrix historis](HUB-IMPL-003-production-cutover.md#execution-matrix--58-scenarios). Jangan ubah menjadi NOT_RUN atau minta seluruh pengujian diulang tanpa perubahan material. Satu pengujian baru dapat menutup beberapa ID hanya bila setiap expected result benar-benar diamati dan dicatat.

Browser checks **wajib**, bukan opsional. Matrix privileged/recovery code, invalidation, negative mapping, dan Google tidak boleh dilewati hanya karena login normal berhasil.

## 2. Persiapan operator — tanpa mengirim credential

Gunakan browser profile A yang terpisah untuk UAT dan profile B yang bersih. Catat versi/browser dan tanggal. Profile A tidak boleh dihapus sebelum skenario trust/invalidation selesai. Sign out aplikasi dan Akun SQ sebelum fresh authentication; menutup tab bukan logout.

Operator memverifikasi fixture saat ini, bukan menganggap fixture 17 September masih ada:

| Handle yang dicatat | Kebutuhan | Jangan diasumsikan |
| --- | --- | --- |
| UAT-HCIS-001 atau pengganti yang disetujui | Ordinary synthetic Staff, email diterima tester, password/TOTP dikuasai tester, mapping/access yang diketahui | Historical account bisa sudah dinonaktifkan/dibersihkan; jangan ganti dengan akun pegawai nyata |
| UAT-PRIV | Synthetic privileged identity dengan policy MFA wajib dan recovery code tersedia | OTP yang enroll sukarela saja tidak membuktikan enforcement privileged |
| UAT-GOOGLE-LINK | Google identity milik organisasi/tester yang disetujui, asserted email sama persis dengan existing verified unique synthetic Akun SQ email | Gmail plus-address alias belum tentu sama dengan email yang diklaim Google; jangan mengubah email akun nyata untuk mencocokkan |
| UAT-GOOGLE-UNKNOWN | Google identity yang tidak punya existing Akun SQ match | Tidak boleh dibuatkan Akun SQ baru untuk membuat negative case lulus |
| UAT-UNMAPPED / UAT-NOACCESS | Synthetic identity dengan expected unknown mapping / tanpa HCIS grant | Jangan menghapus mapping/grant pegawai nyata |
| UAT-MANAGER / UAT-HC / UAT-NONEMP | Synthetic persona dengan expected local authorization yang disetujui | Platform Admin bukan otomatis domain admin |

Satu fixture boleh menutup beberapa skenario bila state awal dan hasilnya eksplisit. Bila fixture tidak tersedia, laporkan `BLOCKED: FIXTURE_UNAVAILABLE` beserta kelompoknya; jangan mengarang hasil atau melakukan provisioning lewat fitur fase berikutnya. Penyediaan test fixture melalui operator path yang sudah disetujui bukan implementasi HUB-IMPL-013.

Account disable/restore dan perubahan credential hanya pada fixture yang disetujui. Urutannya selalu snapshot non-secret -> bounded change -> browser check -> restore state -> verify restore. Hentikan batch bila restoration gagal. Password baru/recovery codes tetap dikelola tester; jangan mengembalikan password lama yang sudah direset hanya demi rollback.

## 3. Batch A — browser baseline dan smoke (mulai di sini)

Tidak perlu reset password, mengganti TOTP, atau mengubah realm untuk batch ini.

1. Login ke `https://hub.sabilulquran.or.id` dengan fixture ordinary yang sudah disetujui. Pastikan kembali ke workspace, lalu buka HCIS dari launcher dan Account Console dari menu Akun SQ. Catat hanya hasil dan aplikasi yang memang diharapkan.
2. Di Edge/Chrome tekan F12, buka **Application**. Pada **Local storage** dan **Session storage**, periksa origin Hub, HCIS, dan login yang relevan setelah perjalanan masing-masing selesai. Laporkan ada/tidaknya persisted access/refresh/ID token, code/state/nonce/PKCE verifier/client secret. Jangan copy value atau menjalankan console snippet yang mencetak seluruh storage.
3. Untuk Hub, periksa juga IndexedDB dan Cache storage yang dibuat aplikasi sesuai HUB-IMPL-016. Static assets biasa bukan credential leakage.
4. Di **Cookies**, lihat hanya metadata. Hub session/transaction cookies wajib host-only (tidak menetapkan Domain), Secure, HttpOnly, SameSite=Lax, Path=/. Transaction cookie boleh sudah terhapus setelah callback; itu bukan FAIL. Atribut cookie transaksi dapat diperiksa pada respons yang menyetelnya tanpa menyalin header/value.
5. Untuk `SQ_TRUSTED_DEVICE`, bila ada pada approved trusted profile, cek Secure, HttpOnly, SameSite=Lax, exact realm path `/realms/sq-staff` sesuai implementasi, tanpa broad Domain, dan masa berlaku paling lama 30 hari (2.592.000 detik). Cookie yang tidak ada pada profile yang belum dipercaya adalah hasil yang wajar, bukan bukti atribut sudah PASS.
6. Catat cookie sesi HCIS berdasarkan contract aplikasi tersebut. Jangan menganggap semua cookie Keycloak harus HttpOnly: preference/session-status cookie bukan otomatis credential. Eskalasi nama dan atribut yang diragukan tanpa value.
7. Tutup DevTools atau sembunyikan kolom Value sebelum screenshot. Jangan menyertakan address bar yang berisi query authentication, email pengguna, atau QR authenticator.

Hasil menutup 7.1–7.4 dan F-BROWSER hanya untuk origin/cookie yang benar-benar diperiksa. Bila satu origin belum dicek, sebutkan NOT_RUN; jangan mengirim satu PASS global.

Account Console native dapat menggunakan JavaScript adapter dengan token in-memory. Hal itu bukan bukti token dipersistenkan ke localStorage/sessionStorage dan tidak mengubah contract backend Hub. Referensi upstream: [Keycloak JavaScript adapter](https://www.keycloak.org/securing-apps/javascript-adapter), khusus bagian token disimpan in-memory.

## 4. Batch B — Google existing-account matrix

Operator memverifikasi provider alias `google`, link-only-existing flow, registration tetap off, storeToken off, dan tidak ada privilege mapper menggunakan jalur administrasi yang disetujui. Catat boolean/marker saja. Jangan menjalankan reconcile script ulang bila konfigurasi sudah sesuai.

- **4.1:** Google identity tanpa existing match harus ditolak. Operator membandingkan keberadaan user terkait sebelum/sesudah secara bounded; tampilan error saja tidak cukup membuktikan tidak ada auto-create. Tidak ada grant/role baru.
- **4.2:** Pada existing synthetic match yang belum tertaut, pilih **Masuk dengan Google**. Harus ada konfirmasi link dan pembuktian password akun lokal. Pembatalan atau password lokal salah tidak boleh menyelesaikan linking. Jangan mengganti existing mapping secara heuristik dari email.
- **4.3 / 5.12:** Pada TOTP fixture dan profile tanpa valid trust, Google tidak melewati TOTP. Pada profile dengan valid trust, first factor tetap harus berhasil dan hanya TOTP boleh dilewati sesuai policy. Catat kedua jalur terpisah.
- **4.4:** Logout penuh lalu login Google lagi. Operator memverifikasi exact identity dan HCIS principal sama sebelum/sesudah tanpa mengirim raw `sub` atau account ID. Marker `SAME_IDENTITY=true` dan `SAME_HCIS_PRINCIPAL=true` cukup bila dibandingkan secara nyata.
- **4.5:** Bandingkan Application Access, Platform Administrator membership, realm/client role, dan HCIS authorization sebelum/sesudah. Semua tetap seperti baseline; tidak cukup hanya melihat homepage yang sama.
- Regression: login NIP/email + password masih memakai identity yang sama. Unknown mapping/no-access negative case tetap fail closed (1.5, 6.3, 6.5).

Tidak mengaktifkan public self-registration, auto-link email, auto-create Staff, atau membuat Google sebagai authority role. Bila Google fixture cocok belum tersedia, kelompok ini BLOCKED, bukan PASS atau SKIP yang dianggap selesai.

## 5. Batch C — recovery lengkap + password invalidation, sekali jalan

Tujuan: F-REC dan 5.8; evidence 3.3–3.5 tetap dipertahankan, bukan dihapus.

1. Dengan approved TOTP fixture, operator memastikan profile A mempunyai trust yang valid. Bila trust lama sudah hilang, bentuk precondition dengan valid TOTP dan checkbox trust; ini setup, bukan klaim pengujian September diulang wajib.
2. Logout penuh, pilih **Lupa password?**, dan terima email di mailbox yang dikuasai tester. Catat waktu permintaan/penerimaan, sender sesuai baseline, dan hanya origin tujuan link.
3. Buat password baru melalui halaman Akun SQ. Jangan mengirim password, isi email recovery, atau URL lengkap.
4. Akhiri sesi reset/SSO yang mungkin terbentuk. Pada fresh authentication, coba password lama satu kali: harus ditolak. Jangan berulang sampai akun terkunci.
5. Pada profile A yang sebelumnya dipercaya, login dengan password baru. Harus diminta TOTP karena proof lama invalid. Selesaikan dengan OTP yang benar, lalu pastikan Hub/HCIS membuka principal yang sama dan tidak mendapat hak baru.
6. Catat password baru dapat digunakan, password lama ditolak, TOTP diminta lagi, dan application/identity mapping tetap. Jangan menyimpulkan hanya dari toast "password berhasil diubah".

Link native Keycloak menggunakan action-token sementara; code/state juga bagian dari redirect OIDC yang sah. Karena itu kriteria bukan "URL tidak pernah mengandung parameter token", melainkan tidak ada credential/bearer material bocor ke log, browser persistent storage, pesan error, screenshot, atau pihak yang tidak berhak. Jangan menyalin URL recovery atau auth query. Referensi upstream: [Keycloak Action Token Handler SPI](https://www.keycloak.org/docs/26.7.4/server_development/#_action_token_spi); referensi ini menjelaskan protokol, bukan izin meng-upgrade runtime 26.7.2 yang dipin.

Bila pengiriman gagal, catat waktu, origin/path tanpa query, dan error generik. Operator mengorelasikan delivery/event/error melalui jalur yang disetujui dengan redaction. Jangan dump environment, SMTP credential, Compose, atau seluruh database. Diagnosis source/config/runtime dilakukan sebelum perubahan; jangan menebak DNS/SMTP atau mengulang reset berkali-kali.

## 6. Batch D — sisa MFA/trusted-device/security

| Scenario | Prosedur dan expected result | Boundary |
| --- | --- | --- |
| 3.1 / 5.11 | Bandingkan ordinary unenrolled, ordinary enrolled, dan privileged fixture. Privileged wajib TOTP; ordinary tidak tiba-tiba mendapat privilege/policy wajib baru | Catat enforcement, bukan hanya enrollment |
| 3.2 | Gunakan satu recovery Authentication Code milik privileged fixture melalui flow resmi; ulangi code yang sama pada fresh attempt dan pastikan ditolak | Code hanya dipegang tester, tidak disalin ke evidence |
| 5.9 | Trust profile A, ganti credential TOTP melalui approved Account Console/operator flow, lalu fresh login pada profile A | Proof lama wajib invalid. Tester memastikan faktor baru bekerja sebelum mengakhiri batch |
| 3.6 / 5.10 / 6.2 | Approved synthetic fixture trusted/enabled disnapshot, dinonaktifkan sementara, lalu dicoba login/recovery/new session | Semua jalur tidak membuat sesi baru. Restore enabled state dan verifikasi sebelum lanjut |
| 5.7 | Approved operator melakukan manipulasi proof hanya dalam test profile tanpa mencatat nilainya; fresh auth harus meminta TOTP | Jangan paste cookie ke chat, repo, email, HAR, atau clipboard sinkron |
| 5.6 | Gunakan proof yang benar-benar expired pada approved target; fresh auth meminta TOTP | Menghapus cookie hanya membuktikan missing-cookie, mengubah payload tanpa signature hanya tamper; keduanya bukan expiry test |
| Replay / rotation | Capture/use/replay proof hanya secara lokal di approved isolated harness, atau gunakan exact accepted test evidence untuk layer otomatis | Bukti per layer; jangan menyebut unit test sebagai production UAT |
| Wrong user/realm, invalid signing key | Referensikan exact provider regression tests; runtime exercise tambahan hanya di isolated target yang disetujui | Jangan merotasi signing key production, mengganti clock VPS/realm-wide TTL, atau mengubah realm production untuk mengejar PASS |

Jika expiry belum dapat dieksekusi aman, tandai BLOCKED dengan dependency expired-proof/isolated target. Jangan memalsukan elapsed 30 days atau menurunkan policy production. Dilarang menghentikan Keycloak production untuk 9.1–9.3; siapkan isolated/production-like target dan lakukan failure/restore secara terpisah sesuai operational approval.

## 7. Batch E — authorization, logout, dan operational closure

Persona remaining 1.4/2.2–2.4 memakai kemampuan domain yang sudah disepakati, termasuk satu akses diizinkan dan satu ditolak bila relevan. F-ADMIN membandingkan approved platform admin dengan ordinary Staff menggunakan direct entry ke admin surface yang ditemukan dari UI/source, bukan menebak URL dan bukan melakukan real-user role changes.

Untuk F-LOGOUT, buka Hub dan HCIS pada sesi synthetic yang sama. Logout dari Hub, lalu verifikasi sesi Hub/SSO dan refresh protected data HCIS; catat perilakunya. Ulangi arah HCIS -> Hub. Bandingkan dengan Staff authentication policy dan implementasi client, bukan hanya halaman yang masih tampil dari cache. Jangan menganggap RP logout otomatis membuktikan semua sesi aplikasi sudah hilang. Unexpected surviving access atau redirect loop adalah temuan yang harus dianalisis sebelum closure.

Operator merujuk [deployment evidence](HUB-IMPL-016-deployment-evidence-2026-09-21.md) dan runbook untuk F-OPS: source/image identity, backup database dan isolated restore evidence, incident/rollback owner, privileged recovery/custody, dan gap historical cutover record. Compose backup bukan backup database; successful NO-OP bukan rollback rehearsal. Tidak ada perintah cutover ulang, database cleanup, service recreate, atau deployment dalam panduan ini.

## 8. Format hasil yang aman

Kirim per batch yang benar-benar dilakukan:

```text
Waktu (WIB):
Browser/profile:
Persona handle: UAT-... (bukan nama/email/NIP)
Baseline deployment: 35581490721 / perubahan setelahnya bila ada
Scenario ID:
Hasil: PASS / FAIL / NOT_RUN / BLOCKED
Yang diharapkan:
Yang terlihat: tanpa token/credential/URL query
Origin yang diperiksa: hub / hcis / login
Cookie metadata: nama + Secure/HttpOnly/SameSite/Path/Domain saja
State diubah: tidak / jenis perubahan synthetic
State dipulihkan dan diverifikasi: tidak diperlukan / PASS / FAIL
```

Satu screenshot halaman akhir tidak membuktikan mapping, no-auto-create, cookie security, atau rollback. Reviewer mengikat laporan ke exact ID dan evidence lalu memperbarui matrix yang sesuai melalui PR; owner memberi final acceptance hanya setelah seluruh gate wajib selesai. Jangan menghapus semua jejak UAT sebelum evidence dan safe fixture-restoration dicatat.
