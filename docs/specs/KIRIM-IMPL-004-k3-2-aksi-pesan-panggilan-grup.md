# KIRIM-IMPL-004 — Kirim SQ K3.2: aksi pesan, panggilan, foto profil, grup bersama, dan API grup R3

**Status:** DRAFT → **dibangun** di repository (branch `feat/kirim-k3-2-message-actions`, 2026-11-05). Dijalankan di bawah aturan owner 2026-10-26/27 ("jalan terus, keputusan teknis diambil agent dan dilaporkan"). Nilai yang ditandai `DRAFT` boleh diubah owner kapan saja lewat konfigurasi, tanpa migrasi.
**Produk:** SQ Hub — modul `kirim` (Kirim SQ)
**Owner produk:** Kepala HCM (`kirim_admin`)
**Tanggal:** 2026-11-05
**Depends on:**
- [KIRIM-001](../product/kirim-sq-module-design.md) §2, §5.3, §5.4 (API grup R3, batas 20 penambahan/jam/nomor)
- [KIRIM-IMPL-002](KIRIM-IMPL-002-r2-api-percakapan.md) (API percakapan R2) dan [KIRIM-IMPL-003](KIRIM-IMPL-003-kartu-modul.md) (kartu modul): auth, pemilik nomor, `atas_nama`, cursor, bentuk galat, enkripsi, dan audit tetap berlaku kecuali disebut lain di sini
- SPMB `sq-spmb/docs/specs/SPMB-IMPL-005-k3-lanjutan-aplikasi-cs.md` §2, §4.1, §6, §7.3, §10.2, §11, §17.2 (pemakai pertama)
- Kontrak mesin JalurPesan K3.2 (branch JalurPesan `feat/k3-2-message-actions-calls`): kirim dengan `quoted`/`forwarded` (§A), aksi `reaction`/`edit`/`delete` (§B), event `message.edited`/`message.deleted`/`message.reaction`/`call.logged` (§C), `GET /profile-picture` (§D), anggota grup dengan `phoneJid`/`lidJid` dan rute kelola grup (§E)

**Pemakai pertama:** SPMB, tahap K3.2 (aplikasi CS 0.4.0) dan K3.4 (grup baru). Nomor pertama: `spmb`.

## 1. Tujuan

Membuka di Kirim SQ semua yang dibutuhkan kotak masuk SPMB untuk "rasa WhatsApp" (SPMB-IMPL-005 §1 butir 2, 4, 12, 16) dan API grup R3 (KIRIM-001 §5.4):

1. **Balas berkutip** dan **teruskan** (dengan label "Diteruskan").
2. **Edit** dan **hapus untuk semua** pesan nomor ini sendiri, dalam batas waktu yang dikonfigurasi. Isi lama **tetap tersimpan** (owner: "isi lama tetap tersimpan").
3. **Reaksi** dari daftar kecil emoji.
4. Pesan peminat yang **diedit atau dihapus** pengirimnya ditandai, isi lama tetap ada.
5. **Log panggilan**: panggilan pribadi menjadi pesan bertipe `panggilan`. Mesin tidak pernah menolak panggilan.
6. **Foto profil** kecil per percakapan dan grup.
7. **Grup bersama**: grup nomor ini yang juga diikuti kontak itu.
8. **API grup R3**: buat grup, tambah/keluarkan anggota (batas per jam), daftar anggota, tautan undangan, ganti nama dan deskripsi.

Kirim SQ tetap **mesin tanpa layar untuk staf** dan **tidak memeriksa peran petugas**: siapa boleh mengedit, menghapus pesan petugas lain, atau membuat grup adalah aturan modul (SPMB-IMPL-005 §4.1, §7.3). Kirim SQ memeriksa hanya yang diwajibkan WhatsApp dan nomor, lalu mencatat `atas_nama`.

Di luar dokumen ini: sebut nama (`mentions`) saat mengirim, tanda "sedang dibalas" (urusan modul), pesan terjadwal dan pesan ke kelompok (SPMB menahan sendiri, SPMB-IMPL-005 §7.1–§7.2), promote/demote admin grup, keluar dari grup.

## 2. Aturan umum (sama dengan KIRIM-IMPL-002 §3)

- Semua rute di `/internal/kirim/*`: loopback saja, token client credentials, **hanya pemilik nomor**. Pesan, percakapan, atau grup nomor lain dijawab `404 not_found` (tidak membedakan "tidak ada" dan "bukan milikmu"); `GET /devices/:kode/...` dari bukan pemilik dijawab `403 not_owner`.
- **`atas_nama` wajib**: di body `POST`/`PATCH` sebagai `{ "issuer", "sub" }`, di header `GET` sebagai `X-Kirim-Atas-Nama-Issuer` dan `X-Kirim-Atas-Nama-Sub`. Tanpa itu `400 atas_nama_required`.
- Galat: `{ "error": { "code", "message", ...detail } }`. Detail tambahan hanya angka atau kode, tidak pernah data pribadi.
- Jawaban memuat isi pesan dan nomor utuh seperti R2; body, query, header `atas_nama`, dan jawaban tidak masuk log. Isi tidak pernah masuk `kirim_audit.metadata`.
- `Idempotency-Key` (1–200 karakter) **wajib** untuk teruskan, edit, hapus, dan reaksi; opsional untuk buat grup.
- **Aksi lewat API tidak menerbitkan webhook.** Jawaban sinkron sudah membawa hasilnya; modul meneruskannya ke layarnya sendiri. Event dari mesin untuk aksi yang sama (mis. mesin melaporkan edit yang baru kita kirim) dikenali sebagai tanpa perubahan dan tidak menghasilkan webhook kedua.

## 3. Mesin (kontrak JalurPesan K3.2) dan adaptor

Antarmuka provider (`providers/types.ts`) bertambah:

```ts
sendText(device, to, text, key, options?: { quoted?, forwarded? })          // juga sendDocument, sendGroup
react(device, { chat, whatsappMessageId, fromMe, participant? }, emoji, key): ActionResult
editMessage(device, { chat, whatsappMessageId }, text, key): ActionResult
deleteMessage(device, { chat, whatsappMessageId }, key): ActionResult
profilePicture(device, jid): Buffer | null
createGroup(device, subject, participants): ProviderGroup
updateParticipants(device, groupJid, "add" | "remove", participants): { updates, group }
setGroupSubject / setGroupDescription / groupInviteCode / revokeGroupInvite
```

- `chat` adalah tepat satu dari `to` (digit), `toJid` (JID individual, untuk kontak LID), atau `groupJid`.
- Kunci idempotensi ke mesin untuk aksi = `kirim-aksi:` + 48 hex HMAC dari (pemakai, aksi, `Idempotency-Key` modul), jadi dua modul atau edit dan hapus tidak pernah bertabrakan.
- Pemetaan jawaban aksi: `200` → berhasil; `409 idempotency_key_conflict` → konflik; `409` lain → sementara; `429` → batas laju (`code` mesin dibawa sebagai `alasan`); `404 Tenant device not found` dan `503` → nomor tidak tersambung; `5xx` → mesin tidak tersedia; selain itu → ditolak.
- Foto profil: `404 profile_picture_unavailable` → `null`; `429 profile_picture_rate_limited` (120/jam/nomor) dan `503` → tunggu putaran berikutnya; jawaban > 512 KiB ditolak.
- Provider `log` (nomor tanpa WhatsApp): aksi pesan dijawab sebagai dry run, foto `null`, rute grup ditolak (`engine_rejected`).

## 4. Data (migration `0014_kirim_k3_2.sql`)

### 4.1 Perubahan `kirim_messages`

| Kolom | Isi |
| --- | --- |
| `quoted_message_id` uuid null, FK `kirim_messages` | Pesan yang dikutip, bila Kirim SQ menyimpannya |
| `quoted_wa_message_id` text null | ID WhatsApp pesan yang dikutip (dari pesan masuk), juga bila pesan itu tidak tersimpan |
| `forwarded` bool bawaan `false` | Label "Diteruskan" |
| `edited_at` timestamptz null | Terakhir diedit |
| `deleted_at`, `deleted_by` text null | Dihapus untuk semua; `deleted_by` = `issuer sub` petugas, `pengirim`, `admin_grup`, atau `hp`. `CHECK` keduanya terisi bersama. **Isi tidak dihapus** |
| `reactions` jsonb bawaan `[]` | Satu entri per pemberi reaksi: `{ k, dari, emoji, at, enc?, petugas? }`. `k` = `nomor_ini` atau HMAC identitas pemberi; identitas anggota grup disimpan terenkripsi di `enc` (AAD `kirim:kirim_messages:reactions:<message_id>:<k>`) |
| `panggilan` jsonb null, `call_id` text null | Untuk `tipe = 'panggilan'` saja (`CHECK`). Unik (`device_id`, `call_id`) |
| `tipe` | `CHECK` diperluas dengan `panggilan` |

### 4.2 Tabel baru

| Tabel | Kolom utama | Catatan |
| --- | --- | --- |
| `kirim_message_edits` | `id`, `message_id`, `body_enc` (isi **sebelum** diganti, AAD baris edit), `oleh`, `diganti_at` | Satu baris per isi yang diganti, urut waktu |
| `kirim_group_members` | `group_id`, `member_hmac`, `member_enc`, `member_alt_hmac`, `member_alt_enc`, `admin`, `refreshed_at`; PK (`group_id`, `member_hmac`) | HMAC kanonik sama dengan `kontak_hmac` percakapan (`pn:+<digit>` / `lid:<jid>`). Identitas lain (`phoneJid`/`lidJid`) di `member_alt_*`. Diperbarui setiap penyegaran grup (15 menit); baris hanya ditulis ulang bila berubah |
| `kirim_profile_photos` | `id`, `device_id`, `conversation_id` unik **atau** `group_id` unik, `tersedia`, `file_id`, `path`, `sha256`, `ukuran`, `fetched_at` | Berkas di `KIRIM_MEDIA_ROOT/foto/<file_id>`, terenkripsi dengan kunci data (AAD `kirim:kirim_profile_photos:file:<file_id>`). Foto lama dihapus dari disk saat diganti atau tidak tersedia lagi |
| `kirim_group_additions` | `id`, `device_id`, `group_id`, `consumer_id`, `aksi` (`buat`/`tambah`), `jumlah`, `idempotency_key`, `request_hash`, `created_at` | Penghitung batas penambahan per jam per nomor, dan idempotensi buat grup (unik `consumer_id`, `idempotency_key`) |

`kirim_webhook_deliveries.event_type` diperluas dengan `message.edited`, `message.deleted`, `message.reaction`, `call.logged`. `kirim_audit` tidak punya daftar aksi tetap.

### 4.3 Recovery plan

1. Dump `sq_hub_production` (`sq-core-backup.sh`) sebelum migrate, catat checksum. Jangan rilis pada jam 19 UTC.
2. Migration satu transaksi (`migrate.ts`); gagal = database tetap seperti sebelumnya.
3. **Aditif saja**: kolom baru boleh null atau punya bawaan, `CHECK` yang diganti hanya dilonggarkan, tidak ada baris yang diubah atau dihapus. Diuji: database kosong, dua kali jalan (`IF NOT EXISTS`/`DROP CONSTRAINT IF EXISTS`), dan seluruh uji R1/R2 tetap lulus di atas skema ini.
4. Rollback aplikasi = release SQ Hub sebelumnya; kode lama tidak membaca kolom/tabel baru. Satu-satunya efek: pesan `tipe = 'panggilan'` tampil di API lama sebagai pesan masuk kosong, dan event K3.2 dari mesin dicatat di `kirim_events` tanpa diterapkan (tidak bisa diputar ulang setelah rilis kembali).

## 5. Aksi pada pesan

### 5.1 Balas berkutip

`POST /internal/kirim/conversations/:id/messages` dan `POST /internal/kirim/groups/:id/messages` menerima field opsional baru `kutip_message_id` (uuid). Field ini ikut sidik jari `Idempotency-Key`.

```json
{ "text": "Biaya SDIT tahun ini …", "atas_nama": { "issuer": "https://akun…/realms/sq-staff", "sub": "…" }, "kutip_message_id": "4a0c…" }
```

Diperiksa saat diterima (bukan saat dikirim), supaya petugas tahu langsung:

| Kondisi | Jawaban |
| --- | --- |
| Pesan bukan milik percakapan/grup ini, atau catatan panggilan | `422 quote_invalid` |
| Pesan sudah dihapus | `409 message_deleted` |
| Pesan belum punya ID WhatsApp (masih antre, gagal, impor tanpa ID, nomor `log`), atau pesan grup masuk yang pengirimnya tidak dikenal | `422 quote_unavailable` |

Worker mengirim `quoted: { id, fromMe, participant?, text?, messageType? }`: `fromMe` = pesan keluar; `participant` = JID anggota pengirim untuk pesan grup masuk; `text` = isi/caption (tidak untuk kode verifikasi yang disamarkan); `messageType` dari `tipe`. Bila pesan yang dikutip kehilangan ID WhatsApp di antara diterima dan dikirim, balasan tetap terkirim tanpa kutipan dan dicatat di log (`kirim.send.quote_dropped`, tanpa isi).

### 5.2 Teruskan

`POST /internal/kirim/messages/:id/teruskan` — `Idempotency-Key` wajib.

```json
{ "ke": { "conversation_id": "9b1e…" }, "atas_nama": { "issuer": "…", "sub": "…" }, "ref": "spmb:teruskan:123" }
```

`ke` berisi tepat satu dari `conversation_id` atau `group_id`. Jawaban `202 { "id": "<pesan baru>", "status": "antre" }`; ulangan dengan kunci dan body yang sama mengembalikan pesan yang sama, body lain `409 idempotency_key_conflict`.

- Pesan baru: `keluar`, `asal: petugas`, `forwarded = true`, antrean petugas (bebas jam kirim, tunduk batas laju, kedaluwarsa bawaan 72 jam). Teks dikirim ulang apa adanya (isi terkini bila pernah diedit); media dikirim ulang dari **salinan di Kirim SQ**, bukan diambil dari pesan asal di WhatsApp.
- Audit `pesan.teruskan` pada pesan asal, dengan `ke`, `ke_ref`, dan `message_id` pesan baru di metadata.

| Kondisi | Jawaban |
| --- | --- |
| Tujuan di nomor lain | `422 different_number` |
| Tujuan percakapan yang opt-out (`semua`, nomor ini, atau pemakai ini) — **tanpa** pengecualian 24 jam | `422 optout` |
| Pesan asal dihapus | `409 message_deleted` |
| Kode verifikasi, catatan panggilan, media yang tidak tersalin, atau media selain PDF/JPEG/PNG (`DRAFT`: video, audio, stiker belum) | `422 not_forwardable` |
| Nomor nonaktif | `422 device_inactive` |

### 5.3 Edit

`POST /internal/kirim/messages/:id/edit` — `Idempotency-Key` wajib. Panggilan **sinkron** ke mesin (tanpa outbox).

```json
{ "text": "Biaya SDIT Rp 1.250.000", "atas_nama": { "issuer": "…", "sub": "…" } }
```

Jawaban `200` = item pesan (§6.3) yang sudah diperbarui. Isi lama masuk `kirim_message_edits` (`oleh` = petugas). Mengirim teks yang sama dengan isi sekarang dijawab `200` tanpa memanggil mesin.

`GET /internal/kirim/messages/:id/riwayat-edit` (header `atas_nama`) → isi-isi sebelumnya, terlama dulu; tercatat di audit `pesan.riwayat_edit`:

```json
{ "items": [ { "isi": "Biaya SDIT Rp 1.500.000", "diganti_at": "2026-11-05T03:10:00.000Z",
               "diganti_oleh": { "jenis": "petugas", "petugas": { "issuer": "…", "sub": "…" } } } ] }
```

`diganti_oleh.jenis`: `petugas`, `pengirim` (peminat/anggota yang menulisnya), atau `hp` (diedit di HP nomor ini).

### 5.4 Hapus untuk semua

`POST /internal/kirim/messages/:id/hapus` `{ "atas_nama": … }` — `Idempotency-Key` wajib, sinkron. Jawaban `200` = item pesan dengan `dihapus_at` dan `dihapus_oleh`. **Isi tetap tersimpan dan tetap ada di `isi`**; modul yang memutuskan siapa boleh melihatnya (SPMB: Koordinator ke atas). Pesan yang sudah dihapus dijawab `200` apa adanya tanpa memanggil mesin.

### 5.5 Reaksi

`POST /internal/kirim/messages/:id/reaksi` — `Idempotency-Key` wajib, sinkron.

```json
{ "emoji": "🙏", "atas_nama": { "issuer": "…", "sub": "…" } }
```

`emoji` salah satu dari 👍 ❤️ 😂 😮 😢 🙏 (❤ tanpa pemilih variasi dianggap ❤️), atau `""` untuk mencabut reaksi nomor ini. Emoji lain `400 invalid_request`. Boleh pada pesan masuk maupun keluar; pada pesan grup masuk, pengirimnya harus dikenal. Jawaban `200` = item pesan.

### 5.6 Aturan bersama edit, hapus, reaksi

| Kondisi | Edit | Hapus | Reaksi | Jawaban |
| --- | --- | --- | --- | --- |
| Pesan bukan `keluar`, atau bukan dari HP nomor ini (`asal: hp`) atau dari modul pemanggil sendiri | ✔ | ✔ | — | `422 not_own_message` |
| Bukan teks, atau kode verifikasi | ✔ | — | — | `422 not_editable` |
| Catatan panggilan | — | ✔ | ✔ | `422 not_deletable` / `422 not_reactable` |
| Pengirim pesan grup masuk tidak dikenal | — | — | ✔ | `422 not_reactable` |
| Pesan sudah dihapus | ✔ | (200) | ✔ | `409 message_deleted` |
| Belum diserahkan ke WhatsApp (antre, gagal, dibatalkan, tanpa ID WhatsApp) | ✔ | ✔ | ✔ | `409 message_not_sent` |
| Lewat `KIRIM_EDIT_WINDOW_MINUTES` sejak diserahkan ke WhatsApp | ✔ | — | — | `422 edit_window_passed` |
| Lewat `KIRIM_DELETE_WINDOW_HOURS` sejak diserahkan ke WhatsApp | — | ✔ | — | `422 delete_window_passed` |
| Nomor nonaktif | ✔ | ✔ | ✔ | `422 device_inactive` |
| Mesin: batas laju (`minimum_interval`, `minute_limit`, `hour_limit`, …) | ✔ | ✔ | ✔ | `429 engine_rate_limited` dengan `alasan` |
| Mesin: kunci dipakai untuk body lain | ✔ | ✔ | ✔ | `409 idempotency_key_conflict` |
| Mesin tidak tersedia atau nomor tidak tersambung | ✔ | ✔ | ✔ | `503 engine_unavailable` |
| WhatsApp/mesin menolak | ✔ | ✔ | ✔ | `422 engine_rejected` |

Batas waktu diukur dengan jam database dari `provider_at` (waktu pesan diserahkan ke WhatsApp). Pada setiap galat, pesan di Kirim SQ **tidak berubah**. Audit: `pesan.edit` (metadata `panjang`), `pesan.hapus`, `pesan.reaksi` (metadata `dicabut`).

Mesin bisa memantulkan aksi kita sendiri (`fromMe`) dan pantulan itu bisa diproses sebelum transaksi API selesai. Bila begitu, catatan "diubah di HP" (`hp`) dari 5 menit terakhir diganti menjadi petugas yang meminta. Baris audit selalu ditulis begitu mesin menerima aksinya. Webhook dari pantulan itu tetap bisa sampai ke modul sebagai `hp`; modul hanya memakainya sebagai tanda segarkan.

## 6. Event dari mesin dan isi pesan

### 6.1 Pesan masuk dan `message.sent`

`message.received` dan `message.sent` dari mesin kini dibaca `quoted.id` dan `forwarded`. `quoted_message_id` diisi bila pesan yang dikutip ada di nomor ini (dicocokkan lewat `wa_message_id`).

### 6.2 Event baru

| Event mesin | Yang dilakukan Kirim SQ |
| --- | --- |
| `message.edited` | Pesan target dicari lewat `wa_message_id` di nomor itu. **Hanya diterapkan bila dari penulisnya**: `fromMe` untuk pesan keluar, atau `senderJid`/`peerJidAlt` cocok dengan kontak percakapan (`kontak_hmac`/`kontak_alt_hmac`) atau dengan pengirim pesan grup (termasuk identitas lain anggota itu di `kirim_group_members`). Isi baru menggantikan, isi lama masuk `kirim_message_edits` (`oleh` = `pengirim` atau `hp`), `edited_at` diisi |
| `message.deleted` | Sama, ditambah: di grup, **admin grup** (menurut `kirim_group_members`, atau nomor ini bila admin) boleh menghapus pesan anggota lain → `deleted_by = admin_grup`. `deleted_at` diisi, isi tetap |
| `message.reaction` | Satu reaksi terkini per pemberi; `""` mencabut. `dari`: `kontak`, `anggota`, atau `nomor_ini` (`fromMe`) |
| `call.logged` | Hanya panggilan **pribadi**; panggilan grup tidak disimpan. Menjadi pesan `tipe: panggilan` di percakapan orang itu (pencocokan LID ↔ nomor seperti pesan masuk). Panggilan dari HP nomor ini (`fromMe`) disimpan sebagai `keluar`, `asal: hp`. Disimpan sekali per (`device`, `callId`); revisi lebih tinggi (`revision: 2`, panggilan `missed` yang dikoreksi accept/reject belakangan) **memperbarui** pesan yang sama dan menerbitkan webhook lagi dengan `dikoreksi: true` |

Edit/hapus yang bukan dari penulisnya (WhatsApp tidak mengautentikasi pengirim revoke/edit) diabaikan dan dicatat di log tanpa isi (`kirim.ingest.change_refused`). Event untuk pesan yang tidak dikenal hanya dicatat di `kirim_events`. Event ganda (`eventId` sama, atau perubahan yang sudah diterapkan) tidak menghasilkan baris atau webhook kedua.

Panggilan masuk **tak terjawab** atau **ditolak**: `belum_dibaca + 1` dan `pesan_masuk_terakhir_at` naik (seperti pesan masuk; ini juga membuka jendela balasan 24 jam bagi nomor opt-out). **Diangkat** dan panggilan keluar hanya menaikkan `pesan_terakhir_at`. Bila koreksi mengubah tak terjawab menjadi diangkat dan percakapan belum dibaca sejak itu, `belum_dibaca` dikurangi satu.

| `outcome` mesin | `hasil` |
| --- | --- |
| `missed` | `tak_terjawab` |
| `rejected` | `ditolak` |
| `answered_elsewhere` | `diangkat` |

### 6.3 Item pesan (tambahan pada KIRIM-IMPL-002 §6.1)

Semua item di `GET /conversations/:id/messages`, `GET /groups/:id/messages`, dan jawaban aksi kini memuat:

```json
{
  "id": "…", "arah": "masuk", "tipe": "teks", "isi": "Anak saya umur 7", "…": "field R2 lain tetap",
  "kutipan": { "id": "…", "arah": "keluar", "tipe": "teks", "cuplikan": "≤ 200 karakter", "disamarkan": false, "dihapus": false },
  "diteruskan": false,
  "diedit_at": "2026-11-05T03:12:00.000Z",
  "dihapus_at": null,
  "dihapus_oleh": null,
  "reaksi": [
    { "emoji": "🙏", "dari": "nomor_ini", "petugas": { "issuer": "…", "sub": "…" }, "waktu": "…" },
    { "emoji": "👍", "dari": "anggota", "nomor": "+6289999999999", "petugas": null, "waktu": "…" }
  ],
  "panggilan": null
}
```

- `kutipan`: `null` bila tidak mengutip; `{ "id": null, "arah": null, "tipe": null, "cuplikan": null, … }` bila WhatsApp mengutip pesan yang tidak tersimpan di Kirim SQ.
- `dihapus_oleh`: `{ "jenis": "petugas" | "pengirim" | "admin_grup" | "hp", "petugas": { issuer, sub } | null }`.
- `reaksi[].nomor` hanya untuk `dari: anggota` (null bila anggota hanya dikenal lewat LID). `petugas` terisi bila reaksi dibuat lewat API.
- `panggilan` (hanya `tipe: panggilan`, `isi: null`):

```json
{ "hasil": "tak_terjawab", "video": true, "mulai": "…", "diangkat_at": null, "selesai": "…", "durasi_detik": 0, "revisi": 1 }
```

`durasi_detik` bisa `null` bila mesin tidak tahu lamanya, misalnya panggilan yang diangkat di HP (`answered_elsewhere` → `hasil: "diangkat"`, `durationSeconds: null`, addendum 2026-11-05). Kirim SQ menyimpan dan meneruskan `null` apa adanya di item pesan dan webhook `call.logged`; tidak pernah diubah menjadi 0.

`pesan_terakhir` di item percakapan dan grup bertambah `diedit_at`, `dihapus_at`, dan `panggilan` (untuk chip "Panggilan tak terjawab").

## 7. Webhook baru ke modul pemilik nomor

Amplop, tanda tangan, retry, dan `event_id` sama dengan KIRIM-IMPL-001 §6.2. Penerima yang memvalidasi tipe harus mengabaikan tipe yang tidak dikenal dengan `2xx`. Hanya untuk perubahan dari mesin (§2: aksi lewat API tidak menerbitkan webhook).

```jsonc
// message.edited
{ "device": "spmb", "conversation_id": "…" /* atau "group_id" */, "message_id": "…", "arah": "masuk",
  "cuplikan": "≤ 200 karakter isi baru", "diedit_at": "…", "diedit_oleh": "pengirim" /* atau "hp" */ }
// message.deleted
{ "device": "spmb", "conversation_id": "…", "message_id": "…", "arah": "masuk",
  "dihapus_at": "…", "dihapus_oleh": "pengirim" /* "admin_grup" | "hp" */ }
// message.reaction
{ "device": "spmb", "group_id": "…", "message_id": "…", "dari": "anggota" /* "kontak" | "nomor_ini" */,
  "pengirim": { "nomor": "+6289…" } /* hanya untuk "anggota", seperti group.message.received */,
  "emoji": "👍" /* "" = dicabut */, "waktu": "…" }
// call.logged
{ "device": "spmb", "conversation_id": "…", "message_id": "…", "arah": "masuk" /* "keluar" dari HP nomor ini */,
  "from": "+6281234567890" /* nomor kontak, null untuk LID tanpa nomor; sama dengan message.received */,
  "hasil": "tak_terjawab", "video": false, "mulai": "…", "diangkat_at": null, "selesai": "…", "durasi_detik": 0,
  "revisi": 1, "dikoreksi": false }
```

Tambahan pada event lama (aditif): `message.received`, `group.message.received`, dan `message.sent` kini membawa `kutipan_message_id` (uuid atau null) dan `diteruskan` (bool).

## 8. Foto profil

- **Penyegar** (timer di proses API, `KIRIM_PHOTO_REFRESH_INTERVAL_MS`, bawaan 1 jam): untuk setiap nomor `jalurpesan` yang tersambung, maks. 25 percakapan dan 25 grup per putaran yang aktif dalam 30 hari terakhir dan fotonya belum ada atau lebih tua dari **7 hari**. Untuk percakapan dipakai JID nomor telepon bila diketahui (privasi foto diperiksa terhadapnya), selain itu LID.
- Hasil: JPEG (diperiksa byte awal `FF D8 FF`) disimpan terenkripsi; sama dengan yang lama (`sha256`) hanya memperbarui `fetched_at`. `null` dari mesin → `tersedia = false` dan **berkas lama dihapus**. JID yang ditolak mesin dicatat "tidak ada" selama 7 hari; mesin tidak tersedia, nomor tidak tersambung, batas laju, atau mesin tanpa rute foto → putaran nomor itu berhenti tanpa mencatat apa-apa.
- `GET /internal/kirim/conversations/:id/foto` dan `GET /internal/kirim/groups/:id/foto` (header `atas_nama`, tidak diaudit seperti daftar percakapan) → `200 image/jpeg`, `Cache-Control: private, max-age=86400`, `ETag`, `X-Content-Type-Options: nosniff`. `If-None-Match` yang sama → `304`. Tidak ada foto → `404 foto_tidak_ada` (modul menampilkan inisial).
- Modul tidak boleh membuka foto untuk disimpan atau dibagikan (SPMB-IMPL-005 §17.2); Kirim SQ tidak memberi URL publik.

## 9. API grup R3 (KIRIM-001 §5.4)

Semua panggilan: pemilik nomor, `atas_nama`, audit (`grup.buat`, `grup.anggota_tambah`, `grup.anggota_keluarkan`, `grup.undangan_lihat`, `grup.undangan_tarik`, `grup.ubah`; metadata hanya hitungan per status, tidak pernah nomor). Nomor anggota dinormalkan seperti R1 (`08…`, `628…`, `+62…`), ganda dibuang; nomor tidak sah → `422 invalid_number` dengan `indeks`.

### 9.1 Buat grup

`POST /internal/kirim/devices/:kode/groups` — `Idempotency-Key` opsional (disarankan).

```json
{ "nama": "Peminat SDIT 2026", "deskripsi": "Info SPMB", "anggota": ["+6281234567890", "081200000003"], "atas_nama": { "issuer": "…", "sub": "…" } }
```

`nama` 1–100, `deskripsi` ≤ 2048, `anggota` 1–100. Jawaban `201`:

```json
{
  "grup": { "id": "…", "device": "spmb", "nama": "Peminat SDIT 2026", "jumlah_anggota": 2, "nomor_ini_admin": true, "pesan_terakhir_at": null, "belum_dibaca": 0, "pesan_terakhir": null },
  "anggota": [
    { "nomor": "+6281234567890", "status": "ditambahkan", "perlu_undangan": false, "kode_whatsapp": null },
    { "nomor": "+6281200000003", "status": "perlu_undangan", "perlu_undangan": true, "kode_whatsapp": null }
  ],
  "deskripsi": "berhasil"
}
```

- `perlu_undangan` saat membuat = nomor yang tidak ada di daftar anggota grup baru (`DRAFT`: mesin tidak memberi status per anggota saat membuat; biasanya karena privasi). Modul mengirim tautan undangan (§9.4) lewat chat pribadi, setelah petugas melihat pratinjau (SPMB-IMPL-005 §7.3).
- `deskripsi`: `berhasil`, `gagal` (grup tetap ada; ulangi lewat §9.5), atau `null` bila tidak diminta.
- Ulangan dengan kunci dan body yang sama → `200 { "grup", "anggota": null, "ulangan": true }` tanpa membuat grup kedua; body lain → `409 idempotency_key_conflict`; permintaan pertama masih berjalan → `409 idempotency_request_in_progress`.
- Nomor yang opt-out tidak ditawarkan ke WhatsApp (status `optout`); semua opt-out → `422 optout`.

### 9.2 Tambah anggota dan batas per jam

`POST /internal/kirim/groups/:id/participants` `{ "nomor": ["+62…"], "atas_nama": … }` → `200 { "grup", "anggota": [...] }`.

| `status` | Arti (kode WhatsApp di `kode_whatsapp`) |
| --- | --- |
| `ditambahkan` | `200` |
| `perlu_undangan` | `403`: privasi menolak; kirim tautan undangan |
| `sudah_anggota` | `409` |
| `baru_keluar` | `408`: baru keluar dari grup, WhatsApp belum mengizinkan |
| `optout` | Tidak ditawarkan ke WhatsApp |
| `gagal` | Kode lain |

**Batas `KIRIM_GROUP_ADD_LIMIT_PER_HOUR` (bawaan 20, `DRAFT`) per nomor dalam 60 menit bergulir**, gabungan buat grup dan tambah anggota, menghitung setiap nomor yang **ditawarkan** ke WhatsApp (termasuk yang ditolak privasi; yang opt-out tidak dihitung). Dihitung dan dipesan dalam satu transaksi berkunci per nomor; bila panggilan ke mesin gagal seluruhnya, pesanan dikembalikan.

- Melebihi sisa → `429 group_add_limit`, header `Retry-After`, body `{ "batas_per_jam": 20, "sisa": 1, "retry_after_detik": 2412 }`. Modul membagi permintaan menurut `sisa` dan menjadwalkan sisanya.
- Satu permintaan lebih besar dari batas itu sendiri → `422 group_add_too_many` dengan `batas_per_jam`.

### 9.3 Keluarkan anggota

`POST /internal/kirim/groups/:id/participants/keluarkan` `{ "nomor": [...], "atas_nama": … }` → `200 { "grup", "anggota": [{ "status": "dikeluarkan" | "bukan_anggota" | "gagal", … }] }`. Tidak kena batas per jam.

Bentuk ini menggantikan `DELETE …/participants/:nomor` di KIRIM-001 §5.4, supaya nomor tidak pernah ada di path URL (path masuk log akses). Anggota yang hanya dikenal lewat LID belum bisa dikeluarkan lewat API (`TBD`, menunggu kebutuhan).

### 9.4 Anggota dan tautan undangan

- `GET /internal/kirim/groups/:id/anggota` → `{ "items": [{ "nomor": "+62…" | null, "jenis": "pn" | "lid", "admin": true, "nomor_ini": false }], "disegarkan_at": "…" }` (admin dulu). Dari penyegaran terakhir; dipakai SPMB untuk tanda "peminat/kontak" dan **Jadikan kontak** (SPMB-IMPL-005 §7.3).
- `GET /internal/kirim/groups/:id/invite-link` (header `atas_nama`) → `{ "tautan": "https://chat.whatsapp.com/KODE", "kode": "KODE" }`.
- `POST /internal/kirim/groups/:id/invite-link/tarik` `{ "atas_nama": … }` → tautan baru; tautan lama mati.

### 9.5 Ganti nama dan deskripsi

`PATCH /internal/kirim/groups/:id` `{ "nama"?: "…", "deskripsi"?: "…", "atas_nama": … }` (minimal salah satu; `deskripsi: ""` menghapus) → `200` item grup.

### 9.6 Galat grup

| Kondisi | Jawaban |
| --- | --- |
| Nomor ini sudah bukan anggota grup itu | `409 group_unavailable` |
| WhatsApp menolak dan nomor ini bukan admin | `409 not_group_admin` |
| WhatsApp menolak (lainnya) | `422 engine_rejected` |
| Mesin tidak tersedia / nomor tidak tersambung / nomor `log` tanpa mesin | `503 engine_unavailable` (nomor `log`: `422 engine_rejected`) |
| Grup sudah ditinggalkan atau milik nomor lain | `404 not_found` |

Setelah buat, tambah, dan keluarkan, Kirim SQ langsung menyimpan nama, jumlah, admin, dan anggota dari jawaban mesin, tanpa menunggu penyegaran 15 menit.

### 9.7 Kelengkapan admin seperti WhatsApp (2026-11-06)

Permintaan owner: "fitur admin grup pastikan lengkap seperti di WA asli". Semua rute di bawah hanya untuk grup milik nomor modul. Bila nomor ini bukan admin, WhatsApp menolak dan Kirim menjawab `409 not_group_admin`. Audit hanya mencatat jumlah, tidak pernah nomor.

| Rute | Isi | Jawaban | Audit |
| --- | --- | --- | --- |
| `POST /groups/:id/admin` | `{ nomor[], jadikan, atas_nama }` | `{ grup, anggota[] }`; status `dijadikan_admin`, `dicabut_admin`, `bukan_anggota`, atau `gagal` | `grup.admin_jadikan` / `grup.admin_cabut` |
| `GET /groups/:id/setelan` | (header atas nama) | `{ hanya_admin_kirim, hanya_admin_ubah_info, semua_boleh_tambah, perlu_persetujuan }`; `null` bila WhatsApp tidak menyebut | — |
| `PATCH /groups/:id/setelan` | sebagian dari empat kunci itu + `atas_nama` (minimal satu kunci) | setelan terbaru | `grup.setelan` (daftar perubahan) |
| `GET /groups/:id/permintaan` | — | `{ items: [{ nomor, diminta_at, ref }] }`; nomor `null` bila hanya dikenal lewat LID. `ref` adalah JID peminta yang disegel khusus untuk grup itu | — |
| `POST /groups/:id/permintaan` | `{ nomor[] dan/atau ref[], setujui, atas_nama }`; `ref` dari grup lain menghasilkan `422 invalid_ref`. Yang disetujui langsung tersimpan sebagai anggota | `{ anggota[] }`; status `disetujui`, `ditolak`, atau `gagal` | `grup.permintaan_setujui` / `grup.permintaan_tolak` |
| `POST /groups/:id/foto` | `{ gambar (JPEG base64, ≤ 1 MB), atas_nama }` | item grup; salinan foto di Kirim langsung diganti | `grup.foto_ganti` |
| `POST /groups/:id/foto/hapus` | `{ atas_nama }` | item grup | `grup.foto_hapus` |
| `POST /groups/:id/keluar` | `{ atas_nama }` | `{ ok: true }`; `keluar_at` diisi, grup tetap ada di riwayat. Jika nomor sudah keluar lebih dulu, tetap dicatat keluar | `grup.keluar` |

Foto selain JPEG, atau lebih dari 1 MB, ditolak dengan `422 picture_invalid`. Batas body rute ini 2 MB, sehingga JPEG 1 MB dalam bentuk base64 tetap muat. Aplikasi CS mengirim JPEG 640 px. Bila WhatsApp menolak karena nomor ini bukan admin, JalurPesan menjawab `403 not_group_admin` dan Kirim meneruskannya sebagai `409 not_group_admin`. Pada perubahan setelan bertahap, setelan yang sudah berlaku tetap diaudit, dengan `gagal_pada` untuk perubahan yang ditolak. Rute-rute ini memakai JalurPesan PR #22: `settings` di metadata, nilai setelan `member_add_*`/`approval_*`, `…/requests`, dan `…/picture`.

### 9.8 Tag @anggota (2026-11-06)

Kirim tidak menambah kolom maupun kunci API. Saat pesan grup dikirim, worker membaca token `@<digit>` (8–15 digit) dalam teks, maksimal 50. Token yang cocok dengan anggota grup itu, baik lewat nomor (`pn:+…`) maupun LID, dikirim ke JalurPesan sebagai `mentions` (#23). WhatsApp lalu menampilkannya sebagai nama anggota dan memberi notifikasi. Nomor yang bukan anggota tetap menjadi teks biasa. Modul cukup menyisipkan `@<nomor tanpa +>` ke teks, misalnya dari pemilih anggota.

## 10. Grup bersama

`GET /internal/kirim/conversations/:id/grup-bersama` (header `atas_nama`) → grup nomor ini (belum ditinggalkan) yang juga beranggotakan kontak percakapan itu, dicocokkan pada **kedua** identitas: `kontak_hmac`/`kontak_alt_hmac` percakapan terhadap `member_hmac`/`member_alt_hmac`. Jadi kontak yang tercatat sebagai nomor tetap ditemukan walau di grup ia tercatat sebagai LID, dan sebaliknya, selama mesin atau penyegar kontak mengetahui pasangannya.

```json
{ "items": [ { "id": "…", "nama": "Wali murid kelas 1A", "jumlah_anggota": 32, "kontak_admin": false, "nomor_ini_admin": true, "disegarkan_at": "…" } ] }
```

Sumbernya penyegaran grup tiap 15 menit (`KIRIM_GROUP_REFRESH_INTERVAL_MS`). Hanya grup yang diikuti nomor ini.

## 11. Konfigurasi

| Variabel | Bawaan | Catatan |
| --- | --- | --- |
| `KIRIM_EDIT_WINDOW_MINUTES` | 15 | `DRAFT`, **akan diukur** di nomor `spmb` (batas WhatsApp sekitar 15 menit). 1–1440 |
| `KIRIM_DELETE_WINDOW_HOURS` | 48 | `DRAFT`, **akan diukur** (batas WhatsApp sekitar 2 hari). 1–720 |
| `KIRIM_GROUP_ADD_LIMIT_PER_HOUR` | 20 | `DRAFT` (KIRIM-001 §5.4 "awal 20"). 1–200 |
| `KIRIM_PHOTO_REFRESH_INTERVAL_MS` | 3600000 | Jeda penyegar foto; umur foto tetap 7 hari |

Tidak ada secret baru. `infra/production.env.example` diperbarui.

## 12. Akses dan privasi

- Nomor, JID, nama grup, isi lama, dan identitas pemberi reaksi anggota grup disimpan terenkripsi (`crypto.seal` + `columnAad`) dan dicari lewat HMAC; foto terenkripsi di disk.
- Log tidak memuat isi, nomor, JID, emoji, atau `atas_nama`; hanya kode event, kode galat, dan kode nomor (`spmb`).
- Webhook baru tidak membawa nomor di luar yang sudah dibawa webhook lama (`from` seperti `message.received`, `pengirim.nomor` anggota seperti `group.message.received`).
- `kirim_admin` tetap tidak bisa membaca isi chat, isi lama, atau foto.

## 13. Uji

**Otomatis** (`apps/api/test/kirim-k32-unit.test.ts`, `kirim-k32.integration.test.ts`, stub JalurPesan diperluas di `kirim.fixture.ts`):

- Unit: reaksi per pemberi dan pencabutan; daftar emoji; batas penambahan dan perhitungan `retry_after`; status anggota; pembaca payload edit/hapus/reaksi/panggilan (termasuk `fromMe`, `revision`); pemetaan jawaban aksi; konfigurasi; adaptor (body `quoted`/`forwarded`, target aksi, foto, kelola grup); provider `log`.
- Integrasi: kutipan pribadi dan grup sampai body ke mesin; penolakan kutipan; teruskan teks dan JPEG, idempotensi, opt-out; edit dengan riwayat, jendela, galat mesin (429/503/400), belum terkirim; hapus dan ulangan; reaksi dan pencabutan; pemilik saja; event edit sekali, gema edit sendiri tanpa webhook, hapus oleh pengirim dan admin grup, **edit/hapus dari bukan penulis diabaikan**, reaksi, panggilan tak terjawab sekali, **revisi panggilan memperbarui pesan dan webhook lagi**, panggilan keluar, kutipan dan `diteruskan` di pesan masuk; foto (ambil, `ETag`/`304`, tidak diulang 7 hari, dihapus saat tidak tersedia, mesin tanpa rute); grup bersama lewat nomor dan LID; R3 buat (perlu undangan, ulangan), batas 20/jam (`429`, `Retry-After`, `group_add_too_many`, pengembalian pesanan), opt-out, keluarkan, anggota, undangan, ganti nama/deskripsi, audit; log tanpa isi dan nomor.

**Manual sebelum dipakai SPMB** (di nomor `spmb` dengan HP uji): batas edit dan hapus yang sebenarnya (§11, ganti `DRAFT`); tampilan kutipan dan "Diteruskan" di HP penerima; panggilan suara/video tak terjawab, ditolak, dan diangkat di HP nomor SPMB; foto profil kontak dengan privasi terbuka dan tertutup; buat grup kecil dengan satu nomor ber-privasi ketat.

## 14. Rilis

| # | Langkah | Rollback |
| --- | --- | --- |
| 1 | Rilis JalurPesan K3.2 (branch `feat/k3-2-message-actions-calls`) | Release JalurPesan sebelumnya; Kirim SQ K3.2 menjawab `503`/`422` untuk aksi dan berhenti mengambil foto |
| 2 | Backup lalu rilis SQ Hub dengan migration 0014 (dry-run, gate kandidat, verifikasi, bukan jam 19 UTC) | Release SQ Hub sebelumnya (§4.3) |
| 3 | Uji manual §13; isi hasil ukur batas edit/hapus ke §11 | — |
| 4 | SPMB 0.4.0 memakai kontrak ini | — |

Urutan 1→2 tidak wajib: Kirim SQ K3.2 di atas mesin lama tetap berjalan (event baru tidak datang, aksi dan foto gagal dengan galat yang jelas, kirim biasa tidak berubah karena `quoted`/`forwarded` hanya dikirim bila diisi).

## 16. Stiker keluar (adendum 2026-11-05, SPMB-IMPL-005 §22)

- `POST /internal/kirim/media` menerima `image/webp` (header `RIFF....WEBP`, maks. 500 KiB) sebagai stiker.
- Balasan dengan media itu menjadi pesan `tipe: stiker`. Stiker tidak bisa diberi keterangan (`422 invalid_request`).
- Worker mengunggahnya ke mesin dengan `type=sticker`; JalurPesan mengirimnya sebagai stiker WhatsApp. Tidak perlu perubahan mesin.
- Stiker yang tersalin juga bisa diteruskan (§5.2).

## 17. WhatsApp Business: balasan cepat dan katalog (adendum 2026-11-06, SPMB-IMPL-005 §31)

Keputusan owner 2026-11-06: balasan cepat disinkronkan dua arah dengan WhatsApp Business di HP, dan katalog memakai katalog WhatsApp Business yang asli, bukan modul katalog sendiri.

**Mesin (JalurPesan, migration v23 `whatsapp_quick_replies`).** Baileys tidak punya event balasan cepat. Mesin menangkap aksi app-state `quick_reply` dari trace logger, lalu menyimpan per perangkat: `wa_id`, pintasan, pesan, `deleted`, dan `updated_at`. Mesin menulis lewat `addOrEditQuickReply`/`removeQuickReply`, dan membaca katalog lewat `getCatalog` (harga dalam per-seribu mata uang).

**Kirim SQ (tanpa tabel baru).** Mesin adalah salinannya, dan Kirim hanya meneruskan:

| Rute | Isi |
| --- | --- |
| `GET /devices/:kode/balasan-cepat` | `items[]`: `wa_id`, `shortcut`, `pesan`, `dihapus`, `diubah_at`. Yang dihapus di HP tetap muncul dengan `dihapus: true`, agar modul bisa ikut menonaktifkan |
| `PATCH /devices/:kode/balasan-cepat/:waId` | `waId` bernilai `baru` untuk menambah. Body `shortcut` (1–25 karakter tanpa spasi, `/` di depan dibuang), `pesan` (1–4096), `atas_nama`. Jawaban `{ wa_id }`. Audit `balasan_cepat.tambah`/`ubah` |
| `POST /devices/:kode/balasan-cepat/:waId/hapus` | Body `atas_nama`. Audit `balasan_cepat.hapus` |
| `POST /devices/:kode/balasan-cepat/baca-ulang` | Body `atas_nama`. Mesin membaca ulang seluruh balasan cepat dari WhatsApp (snapshot app-state `regular`), karena WhatsApp hanya mengirim perubahan sehingga balasan yang dibuat sebelum mesin mendengar tidak pernah terbaca. Paling sering sekali per 5 menit per nomor. Jawaban `{ dibaca_ulang }` (`false` bila dilewati). Audit `balasan_cepat.baca_ulang` |
| `PUT /devices/:kode/jam-kerja` | Jam layanan di profil WhatsApp Business, diganti utuh. Body `atas_nama`, `zona` (nama zona IANA baku, mis. `Asia/Jakarta`; tulisan lain seperti `asia/jakarta` atau alias `EST` ditolak), `hari[]` (1–7 entri, tanpa hari ganda): `{ hari: 1–7 (ISO, 1 = Senin), rentang: [{ buka: "HH:MM", tutup: "HH:MM" }] }` (1–6 rentang, `buka` < `tutup`, tidak tumpang tindih; `tutup` boleh `24:00`). Hari yang tidak disebut berarti tutup. Jawaban `{ diterapkan: true }`. Audit `jam_kerja.ubah` (zona dan jam, bukan data pribadi). Lihat §17.1 |
| `PUT /conversations/:id/label` | Label WhatsApp Business pada satu chat pribadi, satu arah modul → HP. Body `atas_nama`, `dikelola[]` (semua label yang dikelola modul, 1–50 nama, tiap nama 1–25 karakter), `label[]` (bagian dari `dikelola` yang harus ada di chat ini, boleh kosong). Nama dibandingkan tanpa beda huruf besar/kecil dan tidak boleh ganda. Tiap nama di `label` dibuat di HP bila belum ada, lalu dipasang; tiap nama di `dikelola` yang tidak ada di `label` dilepas bila terpasang. Label lain di HP tidak pernah disentuh. Jawaban `{ label: string[] }` (label kelolaan yang kini ada di chat). Audit `percakapan.label` (nama label). Lihat §17.2 |
| `GET /devices/:kode/katalog?setelah=&semua=1` | Satu halaman, maks. 100 produk. `katalog_ada`: `false` bila nomor itu belum punya katalog WhatsApp Business (daftarnya kosong), `null` bila mesin tidak menyebutkannya. Produk tersembunyi tidak ikut, kecuali dengan `semua=1` (untuk modul yang mengelola katalog, §17.4). Tiap produk berisi `id`, `nama`, `deskripsi`, `harga` (satuan mata uang), `mata_uang`, `url`, `sku`, `tersembunyi`, `status_tinjauan`, `ada_gambar`, `tautan` (`https://wa.me/p/<id>/<nomor sendiri>`). Ada juga kursor `setelah` |
| `GET /devices/:kode/katalog/:id/gambar` | Gambar pertama produk yang sudah tercantum di daftar. Hanya https dari CDN WhatsApp (`whatsapp.net`, `fbcdn.net`, `fbsbx.com`), tanpa redirect, maks. 2 MiB, `image/*`. Selain itu `404`. URL tidak pernah diambil dari pemanggil |

Semua rute hanya untuk nomor milik modul pemanggil (`403` bagi modul lain). Nomor nonaktif mendapat `422 device_inactive`. Bila WhatsApp atau mesin menolak (misalnya nomor bukan WhatsApp Business), jawabannya `422 engine_rejected`. Bila mesin tidak tersambung, `503`.

**Privasi.** Audit memuat kode nomor dan `wa_id` saja, tanpa pintasan atau isi. Log tidak memuat isi.

### 17.1 Jam kerja (adendum 2026-11-07)

SPMB memegang jam layanan CS dan mendorongnya ke profil WhatsApp Business agar keluarga melihatnya. Mesin: `PUT /api/v1/platform/tenants/:id/business-hours` → Baileys `updateBussinesProfile({ hours })`, lalu dibaca balik dengan `getBusinessProfile` (beda hasil dicatat ke log `kirim.jam_kerja.beda`, tidak menggagalkan).

- **Satu rentang per hari.** WhatsApp Business menyimpan satu `business_hours_config` per hari (`specific_hours` dengan menit buka/tutup, `open_24h`, `appointment_only`). Rentang yang lebih dari satu digabung menjadi buka pertama → tutup terakhir; jeda istirahat tidak tampil di WhatsApp.
- Satu hari 00:00–24:00 dikirim sebagai `open_24h`.
- Mesin menolak dengan IQ error 4xx (misalnya nomor bukan WhatsApp Business) → `422 engine_rejected`. Mesin atau koneksi bermasalah → `503 engine_unavailable`.

### 17.2 Label chat (adendum 2026-11-07)

SPMB memasang label WhatsApp Business pada chat untuk mencerminkan status penanganan dan program (mis. Baru, Ditangani, Menunggu, Selesai, Taman Tahfizh, SDIT). Arahnya satu: SPMB → HP.

- **Mesin (JalurPesan, migration v24).** Label (`labels.edit`) dan label pada chat (`labels.association`, `label_jid`) disimpan per perangkat. `clearIdentity` menghapusnya. Rute `PUT /api/v1/platform/tenants/:id/chat-labels` dengan body `{ chatJid, altJid, managed, labels }`. Label baru dibuat dengan `addLabel` (id = id terbesar yang pernah ada + 1, warna 0–19 dari nama), lalu dipasang dan dilepas dengan `addChatLabel`/`removeChatLabel`. Perubahan berjalan berurutan per nomor, dalam antrean yang sama dengan balasan cepat.
- **Kelengkapan.** Sebelum perubahan pertama, mesin membaca koleksi app-state `regular` secara utuh (snapshot di bawah kunci app-state Baileys) agar label yang sudah ada di HP dikenal dan tidak dibuat kembar. Label yang tidak muncul lagi di snapshot ditandai terhapus, dan id-nya tidak dipakai ulang. Sebelum tiap perubahan berikutnya, perubahan terbaru dibaca dulu. Bila snapshot gagal, mesin menjawab `503 labels_unread` (Kirim: `503 engine_unavailable`) dan tidak mencoba lagi dalam satu menit.
- **Alamat chat.** Kirim mengirim JID percakapan (nomor atau LID) beserta identitas lainnya bila diketahui. Mesin juga melengkapinya dari pemetaan LID↔nomor. Label baru dipasang pada alamat yang sudah dipakai HP untuk label lain di chat itu. Bila belum ada, dipasang pada JID percakapan.

### 17.3 Profil bisnis (adendum 2026-11-09)

SPMB mengelola profil WhatsApp Business nomornya sendiri: dibaca utuh, lalu deskripsi, alamat, e-mail, situs, foto profil, dan foto sampul bisa diubah. **Nama bisnis tidak pernah ditulis** (keputusan owner, `DRAFT`): mengganti nama bisa membuat nomor ditinjau ulang oleh WhatsApp.

**Mesin (JalurPesan PR #27, tanpa migrasi).** Rute platform baru:

| Rute mesin | Isi |
| --- | --- |
| `GET …/business-profile` | IQ `w:biz` `business_profile` dibaca sendiri, karena `getBusinessProfile` Baileys hanya menyimpan situs dan kategori pertama. Isinya `jid`, `name` (dari sesi, hanya baca), `description`, `address`, `email`, `websites[]`, `categories[{id,name}]`, `hours`, `profilePictureUrl`, `coverPhoto{id,url}` |
| `PATCH …/business-profile` | `{ description?, address?, email?, websites? }` (minimal satu) → `updateBussinesProfile` (delta), lalu dibaca balik: `verified` true/false/null |
| `PUT`/`DELETE …/business-profile/picture` | `updateProfilePicture`/`removeProfilePicture` untuk nomor sendiri. Tanpa sharp/jimp, JPEG dikirim apa adanya |
| `PUT …/business-profile/cover-photo` | `updateCoverPhoto` → `{ id, verified }` |
| `DELETE …/business-profile/cover-photo[?id=]` | `removeCoverPhoto(id)`. Tanpa `id`, dipakai id dari profil, lalu id yang terakhir dipasang mesin itu. Bila tidak ada, `409 cover_photo_unknown` |

**Kirim SQ.**

| Rute | Isi |
| --- | --- |
| `GET /devices/:kode/profil-bisnis` | `{ nama, deskripsi, alamat, email, situs[], kategori[{id,nama}], jam_kerja, ada_foto, sampul_id }`. `jam_kerja` berbentuk sama dengan body `PUT …/jam-kerja` (`{ zona, hari: [{ hari, rentang[], janji_temu }] }`). Hari "dengan janji temu" berisi `rentang: []` dan `janji_temu: true`. Tiap hari muncul sekali dengan semua rentangnya, urut. HP bisa menyimpan beberapa rentang per hari (mis. 08:00–12:00 dan 13:00–16:00), dan mesin melaporkannya sebagai entri terpisah. Hari yang tidak disebut WhatsApp berarti tutup dan tidak ikut |
| `PATCH /devices/:kode/profil-bisnis` | Body `atas_nama` dan minimal satu dari `deskripsi` (≤ 512, boleh baris baru), `alamat` (≤ 256), `email` (≤ 128, tanpa karakter kendali, `""` mengosongkan), dan `situs[]` (≤ 2 tautan http(s) berbeda, ≤ 256). Isian yang tidak disebut tetap. Tidak ada `nama`. Jawaban `{ diterapkan: true, terbaca_ulang, profil }`. Audit `profil_bisnis.ubah` (nama kolom saja) |
| `GET /devices/:kode/profil-bisnis/foto` | Foto profil nomor sendiri (ukuran pratinjau WhatsApp, `image/jpeg`), lewat rute foto profil mesin. `404` bila tidak ada. Disimpan di memori 5 menit per nomor (juga "tidak ada"), agar modul yang memeriksanya berulang tidak menghabiskan jatah foto profil nomor itu. Mengganti atau menghapus foto lewat Kirim membuang simpanan itu |
| `POST /devices/:kode/profil-bisnis/foto` | Body `atas_nama`, `gambar` (base64 JPEG ≤ 2 MB). Jawaban `{ diterapkan: true, terbaca_ulang }`. Audit `profil_bisnis.foto_ganti` |
| `POST /devices/:kode/profil-bisnis/foto/hapus` | Body `atas_nama`. Audit `profil_bisnis.foto_hapus` |
| `POST /devices/:kode/profil-bisnis/sampul` | Body `atas_nama`, `gambar` (base64 JPEG ≤ 4 MB). Jawaban `{ diterapkan: true, sampul_id, terbaca_ulang }`. Audit `profil_bisnis.sampul_ganti` |
| `POST /devices/:kode/profil-bisnis/sampul/hapus` | Body `atas_nama`, `sampul_id?` (angka). Jawaban `{ dihapus: true, sampul_id }`, atau `409 sampul_tidak_dikenal` bila tidak ada foto sampul yang diketahui. Audit `profil_bisnis.sampul_hapus` |

`terbaca_ulang`: `true` berarti WhatsApp menyimpan persis yang dikirim. `false` berarti yang tersimpan berbeda (dicatat ke log `kirim.profil_bisnis.beda`, tidak menggagalkan). `null` berarti tidak bisa dibaca balik.

**Gambar.** Gambar yang bukan JPEG (produk: JPEG/PNG), terlalu besar, atau terlalu banyak ditolak dengan `422 gambar_invalid` sebelum sampai ke mesin, termasuk body yang melebihi batas rute (Fastify `413` diubah menjadi `422 gambar_invalid` pada rute bergambar, dan `413 body_too_large` dalam bentuk galat Kirim pada rute lain). Per nomor hanya satu tulisan bergambar (produk, foto profil, foto sampul) yang berjalan sekaligus di proses Kirim. Antreannya paling banyak 3 (yang berjalan ikut dihitung). Permintaan berikutnya ditolak `429 antrean_penuh` (`Retry-After: 30`) sebelum dikirim ke mesin. Tulisan bergambar menunggu mesin sampai 120 detik, karena mesin mengunggah tiap gambar ke WhatsApp (sampai 30 detik per gambar) sebelum mengirim perubahannya.

**Hasil tak pasti.** Bila mesin tidak menjawab tepat waktu, koneksi terputus, atau mesin menjawab `502 whatsapp_outcome_unknown` (WhatsApp tidak mengonfirmasi, mesin PR #28), perubahan itu mungkin sudah terjadi. Begitu juga bila mesin menjawab sukses tanpa produk yang bisa dibaca. Kirim menjawab `503 engine_outcome_unknown` dan tetap mencatat audit aksinya dengan `hasil: "tidak_pasti"`, sehingga tidak ada perubahan di WhatsApp yang tidak teraudit. Modul sebaiknya membaca ulang profil atau katalog sebelum mencoba lagi. Hanya koneksi yang ditolak mesin yang dianggap pasti tidak terjadi (`503 engine_unavailable`).

### 17.4 Menulis katalog (adendum 2026-11-09)

Katalog tidak lagi hanya dibaca: modul pemilik nomor bisa menambah, mengubah, dan menghapus produk. Produk bisa ditinjau WhatsApp sebelum tampil ke pelanggan, dan statusnya terlihat di `status_tinjauan` (mis. `PENDING`, `APPROVED`, `REJECTED`, sesuai jawaban WhatsApp).

**Mesin.** `POST …/catalog/products`, `PUT …/catalog/products/:id`, dan `DELETE …/catalog/products/:id`. IQ `w:biz:catalog` (`product_catalog_add`/`_edit`) ditulis sendiri, karena `productCreate`/`productUpdate` Baileys membuang tautan (`url`) dan mewajibkan harga. Gambar (JPEG/PNG, ≤ 10, 4 MB per gambar, 10 MB total) diunggah ke server media WhatsApp dari byte, tidak pernah diambil dari URL. Produk baru ditandai `COUNTRY_ORIGIN_EXEMPT` kecuali `originCountryCode` diisi. Jawaban WhatsApp dibaca balik (`verified`) beserta `reviewStatus`. Hapus memakai `productDelete` → `{ deleted }`.

**Kirim SQ.**

| Rute | Isi |
| --- | --- |
| `POST /devices/:kode/katalog` | Header `Idempotency-Key` wajib (1–200). Body `atas_nama`, `nama` (1–200), `deskripsi?` (≤ 2000), `harga?` (bilangan bulat satuan mata uang, mis. rupiah; `null` = tanpa harga), `mata_uang?` (ISO 4217, hanya bersama `harga`, bawaan `IDR`), `url?` (http(s), ≤ 500), `sku?` (≤ 100), `tersembunyi?` (bawaan `false`), `gambar?` (≤ 5 base64 JPEG/PNG, ≤ 2 MB per gambar, ≤ 6 MB seluruhnya). Jawaban `201 { produk, terbaca_ulang }` dengan `produk` berbentuk sama seperti di daftar katalog. Audit `katalog.tambah`. Lihat "Sekali per kunci" di bawah |
| `PATCH /devices/:kode/katalog/:id` | Ubah sebagian: body `atas_nama` dan minimal satu isian yang sama. Isian yang tidak disebut tetap seperti di WhatsApp sekarang (dibaca di dalam antrean nomor itu, tepat sebelum ditulis). Deskripsi yang di daftar mesin terpotong (2000 karakter) tidak ditulis balik: bila `deskripsi` tidak disebut, deskripsi tidak dikirim sama sekali (mesin PR #29). `null` mengosongkan `harga` (beserta mata uangnya), `url`, atau `sku`. `gambar` yang disebut mengganti semua gambar dan harus berisi minimal satu (`gambar: []` → `422 gambar_invalid`, gambar tetap). `gambar` yang tidak disebut berarti gambar tetap. `mata_uang` untuk produk tanpa harga → `400`. Id yang tidak ada di katalog → `404 produk_tidak_ada`. Audit `katalog.ubah` dengan `kolom` yang diubah |
| `POST /devices/:kode/katalog/:id/hapus` | Body `atas_nama`. Jawaban `{ dihapus: n }`. Id yang tidak ada di katalog → `404 produk_tidak_ada`. Audit `katalog.hapus` |

**Sekali per kunci (migration `0018_kirim_katalog_tulis.sql`).** Sebelum mesin ditanya, Kirim menyimpan baris `kirim_catalog_writes` (`consumer_id`, `idempotency_key`, hash body, `status`). Setelah berhasil, statusnya `selesai` dan jawabannya disimpan (data katalog saja, tanpa nomor). Permintaan ulang dengan kunci dan body yang sama mendapat jawaban itu lagi (`200`, `ulangan: true`) tanpa membuat produk kedua. Kunci yang sama dengan body lain → `409 idempotency_key_conflict`. Kunci yang masih berjalan → `409 idempotency_request_in_progress`. Bila hasilnya tak pasti (atau masih `berjalan` 10 menit setelah tulisannya keluar dari antrean), statusnya `tidak_pasti`, dan percobaan ulang dengan kunci itu ditolak `409 hasil_tidak_pasti`. Modul memeriksa katalog (`semua=1`), lalu memakai kunci baru bila produknya memang belum ada. Bila mesin atau WhatsApp jelas menolak, barisnya dihapus agar kunci bisa dipakai lagi.

Audit katalog memuat id (`<kode>:baru` untuk penambahan yang hasilnya tak pasti), nama, harga, `tersembunyi`, jumlah gambar, `status_tinjauan`, dan `terbaca_ulang`, atau `hasil: "tidak_pasti"`. Isinya data katalog, bukan data pribadi.

**Nomor tanpa katalog (temuan produksi 2026-11-09, mesin PR #30).** Untuk nomor yang belum pernah membuat katalog, WhatsApp tidak menjawab kueri katalog sama sekali. Baileys rc14 juga menelan time-out 60 detiknya, sehingga dulu Kirim menyerah dengan 503. Sekarang mesin menunggu paling lama 10 detik: halaman pertama tanpa jawaban berarti katalog kosong dengan `katalog_ada: false`. Penambahan produk pada nomor tanpa katalog tidak dicoba ke WhatsApp dan dijawab `422 katalog_belum_ada`. Modul meminta Admin membuat katalog sekali di aplikasi WhatsApp Business (Alat bisnis → Katalog), lalu mencoba lagi dengan kunci yang sama. Belum diketahui apakah WhatsApp mau membuat katalog dari perangkat tertaut, karena tidak diuji (tidak ada penulisan uji ke WhatsApp produksi).

**Kompatibilitas mesin.** Kirim tidak memeriksa versi mesin. Mesin sebelum PR #27 tidak punya rute ini dan menjawab `404`, yang oleh Kirim diteruskan sebagai `422 engine_rejected`, sama seperti balasan cepat pada mesin sebelum v23. Semua rute §17.3–§17.4 mengikuti aturan §17: hanya nomor milik modul pemanggil (`403`), nomor nonaktif `422 device_inactive`, dan mesin tidak tersedia `503 engine_unavailable`.

**Mengirim produk.** Modul mengirim `tautan` sebagai pesan teks biasa, dan WhatsApp menampilkannya sebagai kartu produk. Tidak ada jenis pesan baru.

## 15. Keputusan yang diambil agent (`DRAFT`, dilaporkan ke owner)

| # | Topik | Keputusan |
| --- | --- | --- |
| A-1 | Batas edit/hapus | 15 menit / 48 jam dari diserahkan ke WhatsApp, lewat konfigurasi, sampai diukur |
| A-2 | Edit/hapus pesan otomatis modul lain di nomor yang sama | Tidak boleh (`not_own_message`); hanya pesan modul pemanggil dan pesan dari HP |
| A-3 | Teruskan ke opt-out | Selalu ditolak, tanpa jendela 24 jam (SPMB-IMPL-005 §4.1 "tidak bisa dipilih") |
| A-4 | Jenis media yang bisa diteruskan | PDF, JPEG, PNG (yang sudah bisa dikirim Kirim SQ); video, audio, stiker menyusul bila dibutuhkan |
| A-5 | Webhook untuk aksi lewat API | Tidak diterbitkan; jawaban sinkron cukup |
| A-6 | Panggilan tak terjawab/ditolak | Dihitung seperti pesan masuk (belum dibaca, jendela 24 jam) |
| A-7 | `perlu_undangan` saat buat grup | Ditebak dari daftar anggota hasil buat, karena mesin tidak memberi status per anggota |
| A-8 | Batas penambahan | Menghitung setiap nomor yang ditawarkan ke WhatsApp, termasuk yang ditolak privasi; permintaan yang melebihi sisa ditolak utuh (`429`) dengan `sisa` |
| A-9 | Keluarkan anggota | `POST …/participants/keluarkan` dengan body, bukan nomor di path |
| A-10 | Foto profil | Hanya chat aktif 30 hari, 25+25 per nomor per jam, cache modul 1 hari |
| A-11 | Katalog | Sejak 2026-11-09 dibaca dan ditulis modul pemilik nomor (§17.4). Produk dikirim sebagai tautan `wa.me/p` (§17) |
| A-12 | Balasan cepat dari HP sebelum mesin v23 | Belum diketahui mesin sampai HP mengubahnya lagi atau sinkron app-state ulang. Tidak ada impor paksa |
| A-13 | Jam kerja lebih dari satu rentang per hari | Saat menulis, digabung menjadi buka pertama → tutup terakhir (§17.1). Catatan 2026-11-09: produksi menunjukkan HP menyimpan beberapa rentang per hari sebagai entri terpisah, sehingga penggabungan ini kemungkinan tidak perlu (tindak lanjut). Saat membaca, semua rentang ditampilkan per hari (§17.3). `hari` minimal satu entri |
| A-14 | Nama label | Dibandingkan tanpa beda huruf besar/kecil. Label HP bernama sama (mis. `baru`) dianggap label kelolaan `Baru`. Warna label baru dipilih tetap dari namanya (§17.2) |
| A-15 | Nama bisnis | Tidak bisa ditulis lewat Kirim, karena mengganti nama bisa memicu peninjauan WhatsApp. Ubah nama dilakukan di aplikasi WhatsApp Business (§17.3) |
| A-16 | Batas profil | Deskripsi 512, alamat 256, e-mail 128, situs maks. 2 (seperti aplikasi WhatsApp Business). Foto profil JPEG ≤ 2 MB, foto sampul JPEG ≤ 4 MB |
| A-17 | Mengosongkan isian profil dan produk | E-mail/alamat/deskripsi `""` dikirim apa adanya. `situs: []`, serta tautan atau SKU yang dihapus dari produk, belum terbukti dikosongkan oleh WhatsApp, jadi lihat `terbaca_ulang` |
| A-18 | Ubah produk | Ubah sebagian: isian yang tidak disebut tetap, diambil dari katalog WhatsApp saat itu (maks. 20 halaman × 100 produk). `gambar: []` ditolak (`422`) dan gambar tetap, karena mengosongkan gambar produk belum terbukti didukung WhatsApp |
| A-19 | Gambar produk | Maks. 5 per produk di Kirim (WhatsApp mengizinkan 10), 2 MB per gambar, 6 MB seluruhnya, agar body tetap di bawah 9 MB. Produk tanpa gambar boleh dicoba. Bila WhatsApp menolaknya, jawabannya `422 engine_rejected` |
| A-20 | Asal negara produk | Tidak diisi Kirim: produk baru ditandai bebas asal negara (`COUNTRY_ORIGIN_EXEMPT`), karena isinya layanan pendidikan |
| A-21 | Hapus foto sampul tanpa id | Id diambil dari profil, lalu dari foto sampul yang terakhir dipasang mesin (hanya di memori, hilang saat mesin dimulai ulang). Selain itu `409 sampul_tidak_dikenal` |
| A-22 | Hasil tak pasti | Penambahan produk tidak dicoba ulang otomatis dan tidak dicocokkan otomatis dengan katalog (nama bisa kembar); modul yang memeriksa. Batas waktu tulisan bergambar 120 detik, antrean tulisan bergambar per nomor hanya di dalam satu proses Kirim |
| A-23 | Simpanan foto profil sendiri | 5 menit di memori per nomor, termasuk jawaban "tidak ada foto" |

## Riwayat

| Tanggal | Perubahan |
| --- | --- |
| 2026-11-05 | Dibuat dan dibangun bersama kontrak mesin JalurPesan K3.2, termasuk adendum: `fromMe`/`revision` pada `call.logged`, dan edit/hapus hanya dari penulis pesan |
| 2026-11-05 | Review independen: audit dan petugas tetap tercatat bila pantulan mesin datang lebih dulu (§5.6). Tindak lanjut `TBD`: kunci idempotensi buat grup saat mesin timeout, kutipan/reaksi masuk dicocokkan per chat (bukan per nomor), ganti nama+deskripsi sebagian gagal, berkas foto yatim bila transaksi gagal |
| 2026-11-05 | `durasi_detik` boleh `null` (panggilan diangkat di HP) |
| 2026-11-06 | §17 balasan cepat dua arah dan katalog WhatsApp Business |
| 2026-11-09 | §17.3 profil bisnis (baca utuh, tulis deskripsi/alamat/e-mail/situs/foto/sampul, tanpa nama) dan §17.4 katalog ditulis modul; mesin JalurPesan PR #27 |
| 2026-11-09 | Review independen #195: `Idempotency-Key` untuk tambah produk (migration 0018), hasil tak pasti (`engine_outcome_unknown`, audit `tidak_pasti`, mesin PR #28), batas waktu 120 detik dan satu tulisan bergambar per nomor, gambar kebesaran `422 gambar_invalid` (termasuk 413), foto profil sendiri disimpan 5 menit, ubah produk sebagian, `404 produk_tidak_ada` |
| 2026-11-09 | Tindak lanjut review kedua #195: antrean bergambar maks. 3 (`429 antrean_penuh`), batas 10 menit dihitung sejak keluar antrean, baca produk di dalam antrean, deskripsi terpotong tidak ditulis balik (mesin PR #29), jumlah gambar dicek sebelum didekode, sukses tanpa produk = hasil tak pasti |
| 2026-11-09 | Temuan produksi: jam kerja dibaca per hari dengan semua rentangnya; nomor tanpa katalog dijawab cepat (`katalog_ada: false`) dan penambahan produk pertama `422 katalog_belum_ada` (mesin PR #30) |
