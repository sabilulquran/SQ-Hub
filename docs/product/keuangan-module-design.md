# Keuangan — Rancangan modul (PRD)

**Status:** DRAFT / DISCOVERY. Dokumen ini tidak mengizinkan implementasi atau perubahan production.
**Spesifikasi:** KEU-001 (usulan). Spesifikasi implementasi belum ada.
**Tanggal:** 2026-10-26 (revisi 0)
**Terkait:** `docs/domain/ownership-and-integration.md` (Finance sebagai pemilik catatan keuangan), ADR-0001, ADR-0007 (Organization Directory), ADR-0009 (Ringkasan Yayasan), ADR-0010 (realm keluarga), ADR-0011 + `kirim-sq-module-design.md`; SPMB `sq-spmb/docs/product/module-design.md` (SPMB-001 §6.4, §7); Keluarga SQ `sq-keluarga/docs/product/module-design.md` (K1); HCIS `docs/domain/payroll-calculation-v1.md` + ADR-0003 HCIS (PAY-003, PROPOSED)

## 1. Dasar

### 1.1 Masalah

Pekerjaan keuangan yayasan saat ini berjalan di spreadsheet dan di sela-sela modul lain:

- **Uang masuk murid baru** belum punya tempat. SPMB sengaja tidak menagihnya. Sebelum modul ini ada, Petugas Keuangan hanya mencatat *status* pelunasan secara manual di SPMB (SPMB-001 §7).
- **SPP, cicilan, dan pengembalian biaya** juga belum punya sistem di SQ Core. Keluarga SQ sudah menyiapkan menu Tagihan (K1) yang menunggu modul ini.
- **Potong gaji untuk biaya pendidikan anak pegawai** diketik HC per periode sebagai komponen `CHILD_EDU` di payroll HCIS (payroll-calculation-v1 §3.1 dan §4). Rinciannya berasal dari catatan yang tidak tersambung ke tagihan.
- **Kas, bank, voucher pengeluaran, kasbon kegiatan, dan pagu** dicatat di spreadsheet. Tiga yang teramati dalam audit SIPAYA Fase 4: `Voucher, Kuitansi & Kasbon.xlsx`, `Keuangan Divisi Usaha.xlsx`, dan `2026 Rekening Kas Operasional.xlsx`.

> **DISCOVERY.** Daftar spreadsheet di atas berasal dari audit read-only untuk SIPAYA (DANA_BUDGET_CONTROL_ACTIVE, 2026-09-30) dan belum dicocokkan ulang dengan bagian keuangan. Juga belum diketahui di mana SPP murid lama dicatat saat ini; HCIS menyebut "sistem SPP di luar" tanpa nama.

### 1.2 Hasil yang dituju

1. Setiap rupiah yang ditagih ke keluarga punya satu tagihan resmi, satu riwayat pembayaran, dan kuitansi resmi yang bisa diverifikasi.
2. Setiap rupiah yang keluar punya permintaan, persetujuan oleh orang yang berbeda, voucher, dan bukti.
3. Saldo kas dan bank dihitung dari buku kas, bukan diketik, dan bisa dicocokkan dengan rekening koran atau hitungan fisik.
4. Modul lain **tidak** perlu menebak status keuangan: SPMB tahu kursi mana yang sudah pasti, HCIS tahu berapa yang dipotong dari gaji, Keluarga SQ tahu tagihan mana yang belum dibayar.

### 1.3 Rujukan: modul Dana SIPAYA

Rancangan ini mengadaptasi modul **Dana** SIPAYA versi live di Mi8 (`/srv/sipaya/src`, build 2026-10-07; salinan lokal `Projects/sipaya/yayasan-hub` sudah tertinggal). Dana punya empat kontrak dengan kode dan migrasi `0047`–`0066`:

| Fase SIPAYA | Kontrak | Dipakai di sini |
| --- | --- | --- |
| 1 · Penagihan | `M1_DANA_ACTIVE.md`, `DANA_BILLING_COLLECTION_ACTIVE.md` | R1 |
| 2 · Kas & Bank | `DANA_TREASURY_ACTIVE.md` | R2 |
| 3 · Pengeluaran | `DANA_EXPENDITURE_ACTIVE.md` | R3 |
| 4 · Anggaran + tutup kas harian | `DANA_BUDGET_CONTROL_ACTIVE.md` | R4 |

Production acceptance M1 di SIPAYA masih tertunda, dan acceptance fase 2–4 belum terlihat. Yang diambil adalah **aturan domainnya** (state machine, rumus saldo, aturan penguncian, pemisahan wewenang), bukan klaim bahwa aturan itu sudah teruji di lapangan.

Yang **tidak** diambil dari SIPAYA (sama dengan keputusan SPMB-001 §1):

- multi-tenant, entitlement modul berbayar, dan RLS per tenant;
- tabel Person bersama. Di SQ Core, anak, keluarga, pegawai, dan pemasok tetap konsep berbeda, dan Keuangan hanya menyimpan rujukan ID;
- istilah "Kasbon" untuk uang muka kegiatan. Di HCIS, kasbon berarti **pinjaman pegawai yang dipotong dari gaji** (`LOAN`). Di sini uang muka kegiatan disebut **Uang muka kegiatan** supaya dua hal itu tidak tertukar (§13 nomor 4).

## 2. Batas tanggung jawab

| Urusan | **Keuangan** | **Di luar modul** |
| --- | --- | --- |
| Biaya pendaftaran SPMB | Menerima catatan kuitansinya sebagai penerimaan kas (R2) | SPMB menagih dan mengonfirmasi lewat port `BillingProvider` (SPMB-001 §7) |
| Uang masuk murid baru | Menagih, mencatat pembayaran dan cicilan, menerbitkan kuitansi, mengirim status pelunasan | SPMB menentukan rincian biaya, potongan, dan **status kursi** (§6.2) |
| SPP dan biaya rutin | Menagih, mencatat, mengingatkan | Sekolah (kelak) menjadi sumber daftar murid aktif |
| Potongan dan beasiswa | Mencatat potongan sebagai penyesuaian tagihan, dengan rujukan sumber | SPMB dan Sosial **memutuskan** siapa mendapat berapa |
| Potong gaji | Menyusun daftar potongan per pegawai per periode, lalu mencatatnya sebagai pembayaran setelah gaji dibayar | HCIS menghitung payroll dan memotongnya |
| Gaji | Membayar gaji bersih dan mencatatnya di Kas & Bank | HCIS menghitung, Direktur mengesahkan (ADR-0003 HCIS) |
| Pinjaman pegawai | Mencairkan pokok pinjaman sebagai pengeluaran | HCIS mengelola saldo dan potongan per periode (`payroll.loans.manage`) |
| Kas, bank, pengeluaran, anggaran | Seluruhnya | — |
| Tampilan untuk orang tua | API tagihan, kuitansi, dan riwayat bayar | Keluarga SQ menampilkan dan meneruskan aksi keluarga (K1) |
| WhatsApp | Menentukan kapan dan isi pesan | Kirim SQ mengirim |

Yang **tidak** dibangun pada R1–R4:

- bagan akun (COA), jurnal double-entry, buku besar, Neraca, Laba Rugi, dan Arus Kas versi akuntansi. Laporan memakai label operasional, seperti di SIPAYA;
- pajak, faktur pajak, dan e-meterai otomatis (§8 menjelaskan kewajiban meterai yang tetap harus dipenuhi);
- payment gateway, virtual account, dan sambungan API bank. Transfer manual dengan kode unik, sama seperti SPMB;
- POS, persediaan, pengadaan/PO, dan penyusutan aset;
- perhitungan payroll dan keputusan beasiswa.

## 3. Letak

Keuangan adalah **domain bisnis** dengan data miliknya sendiri, jadi mengikuti pola SPMB, bukan pola Kirim SQ atau Rapat SQ yang berupa kapabilitas lintas domain:

- aplikasi sendiri di `keuangan.sabilulquran.or.id`, repository usulan `sabilulquran/sq-keuangan`, stack mengikuti ADR-0006;
- database atau schema sendiri. Modul lain membaca dan menulis hanya lewat API Keuangan (ownership-and-integration, *Default integration rule*);
- ruang staf masuk dengan Akun SQ staf (`sq-staff`), dengan akses aplikasi lewat SQ Hub Application Access;
- tampilan untuk orang tua **tidak** dibangun di keuangan., tetapi di Keluarga SQ (pola "satu UI portal + BFF", Keluarga SQ §8). Keuangan menyediakan API untuk realm `sq-keluarga`;
- unit dibaca dari Organization Directory SQ Hub (ADR-0007), bukan dari tabel unit sendiri.

**Kapasitas Mi8:** aplikasi baru menambah satu proses API dan satu web. Ukur memori sebelum spesifikasi implementasi (§12).

## 4. Konsep dan entitas

```text
PENAGIHAN (R1)
Rujukan anak (Keluarga SQ) + Unit ──► Akun Tagihan ──► Tagihan ──► Baris tagihan (Jenis Tagihan)
                                                         ├─ Penyesuaian (potongan, beasiswa, koreksi)
                                                         ├─ Kesepakatan cicilan / potong gaji
                                                         └─ Alokasi ◄── Pembayaran ──► Kuitansi
                                                                            │
KAS & BANK (R2)                                                             ▼
Akun Keuangan (kas/bank) × Sumber Dana ──► Buku Kas (mutasi append-only) ◄─ penerimaan
                                            ├─ Transfer antar akun
                                            └─ Rekonsiliasi saldo
                                                                            ▲
PENGELUARAN (R3)                                                            │ pengeluaran
Permintaan ──► Persetujuan ──► Voucher ──► Bayar ───────────────────────────┘
Uang muka kegiatan ──► Pertanggungjawaban ──► Pengembalian / kekurangan
Pengembalian dana ke keluarga (refund)

ANGGARAN (R4)
Periode Anggaran × Unit × Sumber Dana × Pos ──► Pagu ──► Komitmen (saat disetujui) ──► Realisasi (saat dibayar)
Tutup kas harian (akun kas)
```

| Entitas | Isi utama | Asal di SIPAYA dan perbedaannya |
| --- | --- | --- |
| **Akun Tagihan** | Satu per anak per unit; rujukan anak dan akun keluarga pembayar | `dana_accounts` (Person + Unit). Di sini anak adalah rujukan ID Keluarga SQ, bukan Person lokal |
| **Jenis Tagihan** | Kode, nama, unit yang berlaku, pola `sekali / bulanan / tahunan / manual`, nominal bawaan, tenggat bawaan | Sama. Daftar jenis tidak di-hardcode |
| **Tagihan** | Header + satu atau lebih baris; `Draf → Diterbitkan → Dibayar sebagian → Lunas`, atau `Batal` bila belum ada pembayaran | Sama. Nominal baris tidak diubah setelah terbit; koreksi lewat Penyesuaian |
| **Penyesuaian** | Jenis `Potongan / Beasiswa / Dispensasi / Pembebasan / Koreksi`, nominal bertanda, alasan, **rujukan sumber** (mis. keputusan beasiswa SPMB) | Sama, ditambah rujukan sumber lintas modul |
| **Kesepakatan cicilan** | Jadwal angsuran untuk satu tagihan, disetujui Keuangan; termasuk potong gaji untuk anak pegawai | **Baru.** SIPAYA tidak punya. SPMB sudah mengenal status "Dicicil sesuai kesepakatan" |
| **Pembayaran, Alokasi, Kuitansi** | Satu pembayaran bisa menutup beberapa tagihan dalam satu akun keluarga; satu pembayaran satu kuitansi; batal tidak menghapus | Sama. Metode `Tunai / Transfer / Potong gaji / Lainnya` (potong gaji baru, §6.3) |
| **Akun Keuangan** | Kas atau bank, nomor rekening (data sensitif), unit pemilik atau seluruh yayasan | Sama |
| **Sumber Dana** | Peruntukan uang: SPP, uang masuk, dana OTA, operasional, dll. Bukan akun akuntansi | Sama |
| **Buku Kas** | Mutasi `Masuk / Keluar` append-only: saldo awal, penerimaan, pengeluaran, transfer, penyesuaian, pembalikan | Sama. Saldo = Σ masuk − Σ keluar; tidak boleh negatif |
| **Rekonsiliasi** | Saldo sistem vs saldo teramati per tanggal; selisih dicatat, tidak mengubah buku kas | Sama |
| **Permintaan Pengeluaran, Voucher** | Pemohon → satu penyetuju (orang berbeda) → kasir; voucher terbit saat disetujui | Sama |
| **Uang muka kegiatan** | Uang muka ke staf, wajib dipertanggungjawabkan; `pokok + kekurangan − realisasi − pengembalian = 0` | "Kasbon" SIPAYA, diganti nama |
| **Pengembalian dana** | Refund ke keluarga atas tagihan yang dibayar, dengan persetujuan yayasan | **Baru.** Dibutuhkan KAK: uang masuk bisa dikembalikan dengan persetujuan yayasan |
| **Periode dan Pos Anggaran, Pagu** | Pagu per periode × unit × sumber dana × pos; revisi dan transfer pagu append-only | Sama |
| **Tutup kas harian** | Hitung fisik vs saldo sistem per akun kas per hari; selisih wajib dijelaskan | Sama |

Aturan yang dibawa utuh dari SIPAYA:

- uang memakai **bilangan bulat rupiah**;
- dokumen dan mutasi yang sudah terbit **tidak pernah diubah atau dihapus**; koreksi selalu baris baru (pembalikan, penyesuaian, dokumen pengganti);
- tidak ada saldo yang disimpan sebagai angka yang bisa diedit; saldo selalu dihitung dari mutasi;
- penyetuju harus orang yang berbeda dari pemohon (dibandingkan per orang, bukan per akun), dan menyetujui tidak sama dengan berwenang membayar;
- aksi uang yang diulang (retry) tidak menggandakan mutasi.

## 5. Tahapan

| Rilis | Isi | Menggantikan |
| --- | --- | --- |
| **R1 · Penagihan** | Akun Tagihan, Jenis Tagihan, tagihan uang masuk dari serah terima SPMB, penyesuaian dari beasiswa, pembayaran manual + kuitansi resmi, kesepakatan cicilan, status pelunasan + **kursi pasti** ke SPMB (§6.1–6.2), API tagihan untuk Keluarga SQ | Pencatatan manual Petugas Keuangan di SPMB |
| **R2 · Kas & Bank** | Akun Keuangan, Sumber Dana, Buku Kas, saldo awal, transfer, rekonsiliasi; setiap pembayaran tagihan otomatis menjadi penerimaan; kuitansi biaya pendaftaran SPMB masuk sebagai penerimaan | `2026 Rekening Kas Operasional.xlsx` (bagian buku kas) |
| **R3 · Pengeluaran** | Permintaan, persetujuan, voucher, bukti privat, uang muka kegiatan + pertanggungjawaban, pengembalian dana ke keluarga, pembayaran gaji dari HCIS (§6.3) | `Voucher, Kuitansi & Kasbon.xlsx` |
| **R4 · Anggaran** | Periode, Pos, Pagu, komitmen, revisi/transfer pagu, mode OFF/TRACK/ENFORCE, tutup kas harian | Sheet PAGU, hitung fisik harian |
| **R5 · SPP rutin** | Generate tagihan bulanan per murid aktif, potong gaji anak pegawai ke HCIS, pengingat WA | `CHILD_EDU` yang diketik HC; sistem SPP lama |

R5 bergantung pada **daftar murid aktif**. Sekolah belum ada, jadi sumber sementaranya adalah pendaftar Terdaftar dari SPMB ditambah impor murid lama (§11).

Urutannya mengikuti kebutuhan paling dekat. Daftar ulang angkatan 2027/2028 jatuh di SPMB R2a (sekitar Januari–Maret 2027) dan butuh status pelunasan uang masuk. Sampai Keuangan R1 jalan, SPMB memakai jalur manual Petugas Keuangan, dengan tambahan nominal dibayar (§6.2.6).

## 6. Integrasi dengan modul lain

Prinsip semua integrasi di bawah:

- **Pemilik data yang menulis.** Keuangan tidak mengubah status pendaftaran; SPMB tidak mengubah tagihan. Masing-masing mengirim fakta lewat API pemiliknya.
- **Peristiwa membawa snapshot dan nomor versi.** Penerima mengabaikan versi yang lebih lama, sehingga urutan kedatangan tidak penting dan pengiriman ulang aman.
- **Kunci idempotensi stabil per peristiwa bisnis**, mis. `keu:tagihan-<id>:pelunasan:v7`.
- **Jalur manual sementara** di modul penerima selama API belum ada, seperti port `BillingProvider` di SPMB. Begitu adapter API aktif, jalur manual dimatikan.

### 6.1 SPMB → Keuangan: serah terima Diterima

1. Saat keputusan **Diterima** dipublikasikan, SPMB mengirim serah terima (isi sesuai SPMB-001 §7): rujukan anak dan akun keluarga, program dan pola, rincian biaya program termasuk komponen per jenis kelamin, beasiswa dan potongan yang disetujui, status pegawai, pilihan potong gaji, dan batas daftar ulang.
2. Keuangan membuat **tagihan uang masuk**:
   - satu baris per komponen biaya, dari `program_fee_items` berjenis `entry` (mis. uang masuk SDIT Rp10.250.000 + kerudung putri Rp150.000);
   - satu **Penyesuaian** per beasiswa atau potongan, dengan rujukan keputusan SPMB. Nominal asli tetap terlihat;
   - jatuh tempo = batas daftar ulang SPMB, kecuali ada kesepakatan cicilan.
3. Tagihan langsung **Diterbitkan**, karena besarnya sudah ditetapkan SPMB dan Tim Beasiswa. Keuangan tidak menghitung ulang potongan.
4. Bila SPMB mengubah data setelah serah terima, mis. **Pindah program** (fullday ↔ boarding) atau koreksi beasiswa setelah publikasi, SPMB mengirim serah terima versi baru. Keuangan:
   - membatalkan tagihan lama dan menerbitkan pengganti bila belum ada pembayaran;
   - memindahkan alokasi ke tagihan pengganti bila sudah ada pembayaran. Kuitansi lama tetap sah karena merujuk pembayaran, bukan tagihan.
5. Bila pendaftaran **Gugur** atau **Ditarik**: tagihan yang belum dibayar dibatalkan otomatis. Yang sudah dibayar masuk antrean **Pengembalian dana** (R3), yang menurut KAK harus disetujui yayasan. Biaya pendaftaran tidak pernah dikembalikan.
6. Cadangan belum ditagih. Tagihan baru terbit saat cadangan naik menjadi Diterima.

### 6.2 Keuangan → SPMB: status pelunasan dan kursi pasti

Ini permintaan Product Owner 2026-10-26: **pendaftar yang sudah daftar ulang, atau sudah membayar sejumlah tertentu, dihitung mengisi satu kuota secara pasti.**

#### 6.2.1 Pembagian tanggung jawab

- **Kuota tetap milik SPMB.** Ambang "sejumlah tertentu" adalah aturan penerimaan, jadi diatur di SPMB per program, bukan di Keuangan.
- **Keuangan hanya mengirim fakta pembayaran:** total tagihan setelah potongan, total dibayar, sisa, status pelunasan, kesepakatan cicilan bila ada, dan **tenggat pelunasan efektif** (§6.2.4).
- **SPMB yang menilai** apakah syarat kursi pasti terpenuhi, mencatatnya, dan memberi tahu keluarga.

Dengan begitu Keuangan tidak perlu tahu apa-apa soal kuota, dan aturan kuota bisa diubah tanpa menyentuh Keuangan.

#### 6.2.2 Tiga keadaan kursi

| Keadaan kursi | Kapan | Terhitung di kuota |
| --- | --- | --- |
| **Belum ada** | Sebelum Diterima, termasuk Cadangan | Tidak |
| **Dipesan** | Keputusan Diterima sudah dipublikasikan, syarat kursi pasti belum terpenuhi | Ya, sebagai *dipesan* |
| **Pasti** | Salah satu syarat §6.2.3 terpenuhi | Ya, sebagai *terisi pasti* |

Rumus per program × jenis kelamin (dan per gelombang bila kuota gelombang diisi):

```text
terisi pasti = jumlah kursi Pasti
dipesan      = jumlah kursi Dipesan
sisa         = kuota − terisi pasti − dipesan
```

- Keputusan **Diterima** baru hanya boleh bila `sisa > 0`, kecuali ada pengecualian kuota yang disetujui kepala unit (sudah ada di SPMB-001).
- **Status kuota publik** (`Tersedia / Hampir penuh / Penuh`) memakai `terisi pasti + dipesan`, supaya website tidak menawarkan kursi yang sedang dipegang pendaftar lain.
- **Capaian target** di laporan SPMB memakai `terisi pasti`, karena itulah murid yang sudah mengikat diri.
- Penghitung kuota SPMB saat ini masih kosong (`NO_REGISTRATIONS_YET` di `apps/api/src/public/service.ts`); rumus ini menjadi definisinya.

**Pembayaran tidak pernah berebut kursi.** Kursi sudah dipegang sejak keputusan Diterima. Pembayaran hanya mengubah kursi Dipesan menjadi Pasti. Dua keluarga yang membayar bersamaan untuk kursi terakhir tidak mungkin terjadi, karena kursi terakhir hanya pernah diberikan kepada satu pendaftar.

#### 6.2.3 Syarat kursi pasti

Kursi menjadi Pasti begitu **salah satu** syarat berikut terpenuhi, mana yang lebih dulu:

1. **Daftar ulang dikonfirmasi.** Panitia menekan Konfirmasi terdaftar dan pendaftaran menjadi Terdaftar (SPMB-001 §6.4).
2. **Pembayaran uang masuk mencapai ambang** program. Ambang diatur Admin SPMB Yayasan per program per tahun penerimaan, dalam salah satu bentuk:
   - nominal, mis. Rp5.000.000;
   - persen dari tagihan uang masuk **setelah potongan**, mis. 50%;
   - `lunas`. **Ini bawaan**, karena sesuai KAK 2026/2027. Nominal atau persen hanya dipakai bila KAK tahun penerimaan itu menyebutnya (§6.2.4).
3. **Kesepakatan potong gaji disetujui Keuangan** untuk anak pegawai. Pembayaran pertama baru terjadi saat gaji bulan berikutnya, padahal pegawai sudah mengikat diri lewat payroll. *(Usulan, §13 nomor 2.)*

Contoh bila KAK suatu tahun memakai ambang 50%: SDIT, uang masuk Rp10.250.000, beasiswa saudara kandung Rp1.000.000 → tagihan Rp9.250.000 → ambang Rp4.625.000. Keluarga membayar Rp5.000.000 pada tanggal 3. Keuangan mengirim status `Dibayar sebagian, dibayar Rp5.000.000`. SPMB melihat 5.000.000 ≥ 4.625.000, mengubah kursi menjadi Pasti, mencatat audit, dan mengirim WA "Kursi Aisyah di SDIT Tahfizh sudah pasti."

#### 6.2.4 Aturan Gugur dan KAK: otomatis, bisa diubah Keuangan per pendaftar

KAK 2026/2027 menyatakan pendaftar yang **tidak melunasi** uang masuk dalam jangka waktu yang ditentukan dianggap mengundurkan diri. Rancangan ini **tidak** melanggar aturan itu. Caranya, aturan dipisah menjadi tiga lapis:

| Lapis | Siapa yang mengatur | Isi |
| --- | --- | --- |
| **1. Aturan program** | Admin SPMB Yayasan, mengikuti KAK tahun itu | Syarat kursi pasti. **Bawaan `lunas`**, persis seperti KAK. Ambang nominal/persen hanya diaktifkan bila KAK tahun itu menuliskannya |
| **2. Penilaian otomatis** | Sistem (SPMB) | Setiap kali status dari Keuangan berubah, SPMB menilai kursi. Saat tenggat efektif lewat dan syarat belum terpenuhi, SPMB **mengusulkan** Gugur |
| **3. Kelonggaran per pendaftar** | **Keuangan** | Mengubah fakta pembayaran milik satu pendaftar, tanpa mengubah aturan program: perpanjangan tenggat, kesepakatan cicilan, atau kesepakatan potong gaji |

**Yang bisa diubah Keuangan per pendaftar:**

1. **Perpanjangan tenggat pelunasan.** Tanggal baru dan alasan wajib. Perpanjangan yang melewati batas tertentu (usulan: 30 hari dari tenggat awal) perlu persetujuan Kepala Keuangan.
2. **Kesepakatan cicilan.** Jadwal angsuran disetujui Keuangan. Selama tidak ada angsuran yang menunggak, status pelunasannya **Dicicil sesuai kesepakatan**, yang menurut SPMB-001 §5 sudah tidak memicu Gugur.
3. **Kesepakatan potong gaji** untuk anak pegawai, diperlakukan sama dengan kesepakatan cicilan.
4. **Potongan atau pembebasan** lewat Penyesuaian beralasan (§4), yang otomatis menurunkan nominal yang harus dilunasi.

Setiap perubahan itu tercatat di audit Keuangan, dikirim ke SPMB dalam snapshot berikutnya sebagai **tenggat efektif** dan status pelunasan, lalu SPMB langsung menilai ulang kursinya.

**Yang tidak bisa diubah Keuangan:** keadaan kursi dan keputusan penerimaan secara langsung, serta aturan program. Keduanya milik SPMB. Keuangan memengaruhi kursi hanya lewat fakta pembayaran.

**Alur bawaan, sesuai KAK:**

```text
Diterima ─► kursi Dipesan, tenggat efektif = batas daftar ulang
   │
   ├─ lunas sebelum tenggat ─────────────────────────────► kursi Pasti
   ├─ Keuangan menyetujui cicilan / potong gaji ─────────► kursi Pasti, sisa ditagih sesuai jadwal
   ├─ Keuangan memperpanjang tenggat ────────────────────► tetap Dipesan, tenggat efektif = tanggal baru
   └─ tenggat efektif lewat, syarat belum terpenuhi ──────► SPMB mengusulkan Gugur
                                                             └─ panitia mengonfirmasi ─► cadangan diusulkan naik
```

**Gugur tidak pernah terjadi tanpa konfirmasi panitia.** Sistem hanya mengusulkan. Sebelum mengonfirmasi, panitia melihat tenggat efektif dan riwayat kelonggaran dari Keuangan, jadi kasus yang sedang dibicarakan dengan Keuangan tidak terlewat.

**Bila suatu tahun memakai ambang di bawah lunas** (lapis 1 diubah lewat KAK), sisa tagihan setelah kursi Pasti menjadi piutang dengan tenggat sendiri. Bawaannya sebelum hari pertama tahun ajaran, sesuai KAK ("dibayar sebelum proses belajar-mengajar dimulai"), dan Keuangan tetap bisa mengubahnya per pendaftar. Sisa yang tidak dibayar menjadi urusan penagihan Keuangan, bukan pembatalan kursi otomatis.

**Usulan kalimat KAK tahun berikutnya**, supaya praktik yang sudah ada (cicilan dengan kesepakatan) tertulis:

> Calon peserta didik yang tidak melunasi biaya uang masuk, dan tidak memiliki kesepakatan cicilan atau perpanjangan waktu dari Bagian Keuangan, sampai batas waktu yang ditentukan dianggap mengundurkan diri dari proses SPMB.

Pembatalan kursi Pasti hanya lewat **Mengundurkan diri** yang dicatat panitia, lalu refund diproses Keuangan.

#### 6.2.5 Kasus tepi

| Kasus | Perilaku |
| --- | --- |
| Angsuran kesepakatan cicilan menunggak setelah kursi Pasti | Keuangan mengubah status pelunasan menjadi Menunggak. Kursi **tidak** turun otomatis; SPMB menandai "Kursi pasti perlu ditinjau", dan Keuangan menagih |
| Keuangan mencabut perpanjangan tenggat yang sudah diberikan | Tenggat efektif kembali ke tanggal sebelumnya; bila sudah lewat, SPMB mengusulkan Gugur dan panitia tetap harus mengonfirmasi |
| Pembayaran dibatalkan (salah catat) sehingga total turun di bawah ambang | Kursi **tidak** turun otomatis. SPMB menandai "Kursi pasti perlu ditinjau" di antrean panitia. Mencegah kursi berkedip naik-turun karena koreksi pembukuan |
| Potongan beasiswa disetujui **setelah** kursi Pasti | Tagihan turun, ambang persen ikut turun; kursi tetap Pasti |
| Ambang program diubah setelah ada kursi Pasti | Tidak berlaku surut. SPMB menyimpan snapshot ambang di setiap penilaian |
| Pindah program | Kursi dilepas di program lama dan dinilai ulang di program baru, dalam satu transaksi di SPMB; ditolak bila program baru tidak punya sisa. Pembayaran ikut pindah (§6.1 butir 4) |
| Pendaftar OTA menunggu hasil Sosial | Tetap Dipesan (sudah menempati kursi menurut SPMB-001 §5). Tagihan baru terbit setelah keputusan akhir, karena besarnya bergantung pada hasil OTA |
| Penerimaan pindahan (tanpa gelombang) | Aturan sama, dengan kuota per kelas tujuan |
| Pendaftar 2027/2028 hasil migrasi Google Form | Petugas Keuangan mencatat nominal yang sudah dibayar di jalur lama; aturan yang sama menilainya |
| Keuangan tidak bisa dihubungi | SPMB memakai status terakhir yang diterima, dengan waktu sinkron terlihat. Tidak ada kursi yang turun karena gangguan |

#### 6.2.6 Perubahan yang dibutuhkan di SPMB

Bagian ini mengubah SPMB-001, jadi perlu revisi dokumen SPMB setelah §13 diputuskan:

1. Entitas **Kursi** per pendaftaran: keadaan, waktu berubah, syarat yang memicu, snapshot ambang, versi status Keuangan yang dipakai.
2. Pengaturan program: **Syarat kursi pasti** (nominal / persen / lunas), bisa disalin dari tahun sebelumnya.
3. Implementasi penghitung kuota dengan rumus §6.2.2, termasuk saat keputusan massal (kepala unit memutuskan banyak pendaftar sekaligus; penolakan harus jelas per pendaftar bila sisa habis).
4. Aturan Gugur sesuai §6.2.4: usulan Gugur memakai **tenggat efektif dari Keuangan**, bukan batas daftar ulang gelombang secara langsung.
5. **Jalur manual sebelum Keuangan R1:** Petugas Keuangan mencatat **nominal dibayar**, kesepakatan cicilan, dan perpanjangan tenggat (dengan alasan), bukan hanya status, supaya penilaian otomatis sudah jalan sejak SPMB R2a.
6. Notifikasi keluarga "Kursi sudah pasti", dan butir antrean panitia "Kursi pasti perlu ditinjau".

### 6.3 HCIS: gaji, potong gaji, dan pinjaman pegawai

**Pembayaran gaji (R3).** ADR-0003 HCIS (masih PROPOSED) menaruh konfirmasi bayar di HCIS (`payroll.payments.confirm`, status `APPROVED → PAYMENT_CONFIRMED`). Agar uang yang keluar tercatat di Kas & Bank tanpa dikerjakan dua kali, usulannya:

1. Saat periode payroll **APPROVED**, HCIS mengirim ringkasan ke Keuangan: periode, total bersih, rekap per unit, dan jumlah penerima. **Tanpa** rincian rekening per pegawai; rincian itu tetap dibaca di laporan HCIS.
2. Keuangan membuat **Voucher gaji** yang sudah berstatus disetujui, karena pengesahan Direktur di HCIS adalah persetujuannya. Tidak ada persetujuan ulang di Keuangan.
3. Kasir membayar dari akun bank, lalu Keuangan mencatat pengeluaran di Buku Kas dan memanggil API HCIS untuk menandai **PAYMENT_CONFIRMED**. Konfirmasi dilakukan sekali, di Keuangan.

Ini mengubah satu langkah di payroll-calculation-v1 §6, jadi perlu dibahas bersama ADR-0003 HCIS sebelum ACCEPTED (§13 nomor 3).

**Potong gaji untuk biaya pendidikan anak pegawai (R5).**

1. Keuangan menyusun daftar **potongan per pegawai per periode** dari kesepakatan cicilan berjenis potong gaji: uang masuk, SPP, dan biaya lain yang disepakati.
2. HCIS membaca daftar itu sebagai input komponen `CHILD_EDU`, menggantikan entri manual HC (payroll-calculation-v1 §4). Rincian per tagihan tetap di Keuangan; HCIS hanya menerima total per pegawai beserta rujukan.
3. Setelah periode payroll **PAYMENT_CONFIRMED**, Keuangan mencatat pembayaran bermetode **Potong gaji** dan mengalokasikannya ke tagihan. Kuitansi terbit seperti biasa.
4. Potong gaji **tidak** menghasilkan penerimaan di Buku Kas, karena uangnya tidak pernah berpindah. Yang tercatat di Buku Kas adalah gaji bersih yang lebih kecil. Laporan penagihan menampilkan potong gaji sebagai jalur pelunasan tersendiri.
5. Bila HCIS mengubah nilai yang benar-benar dipotong (mis. reopen periode), HCIS mengirim versi baru dan Keuangan membalik atau menambah pembayaran sesuai selisihnya.

**Pinjaman pegawai (kasbon HCIS).** Saldo dan potongannya tetap milik HCIS (`LOAN`). Keuangan hanya mencairkan pokoknya sebagai pengeluaran (R3) dengan rujukan pinjaman HCIS. Pelunasannya terjadi lewat potongan gaji, jadi tidak ada penerimaan kas.

### 6.4 Keluarga SQ

- Keluarga SQ K1 membaca dari API Keuangan: tagihan per keluarga dan per anak, rincian setelah potongan, jadwal cicilan, riwayat bayar, dan PDF kuitansi.
- Butir **Perlu tindakan** dibuat dari tagihan jatuh tempo, dengan nama anak dan unit.
- Keluarga **membayar di luar sistem** (transfer manual dengan kode unik atau tunai di loket). Unggahan bukti transfer masuk antrean konfirmasi kasir, seperti biaya pendaftaran SPMB.
- **Halaman verifikasi publik** memakai jalur yang sama dengan SPMB, `keluarga.sabilulquran.or.id/v/<kode>`, hanya menampilkan nomor, tanggal, jumlah, status, dan nama tersamar.

### 6.5 Sosial (beasiswa OTA)

- Potongan uang masuk OTA datang lewat serah terima SPMB (§6.1). Potongan **SPP** OTA dan evaluasi tahunannya diputuskan Sosial; sampai Sosial punya aplikasi, Keuangan menerima keputusannya lewat entri staf beralasan, dengan rujukan dokumen keputusan.
- Dana donatur OTA dicatat sebagai **Sumber Dana** tersendiri di Kas & Bank, supaya pemakaian dana OTA bisa dilaporkan terpisah dari SPP biasa.

### 6.6 Kirim SQ

- Pesan: tagihan terbit, pengingat H-3 dan H-1 jatuh tempo, pembayaran dikonfirmasi + tautan kuitansi, kesepakatan cicilan disetujui.
- Lewat port `WhatsAppSender` dengan adapter `log` dan `kirim` (pola SPMB-001 §8). Keuangan tidak memanggil JalurPesan langsung.
- Nominal hanya disebut untuk tagihan milik penerima pesan itu sendiri. Tidak ada rincian potongan, nomor rekening pribadi, atau data anak lain.
- Kirim SQ merencanakan **nomor sendiri** untuk Keuangan. Setiap nomor memakan sekitar 170 MiB di Mi8, jadi sampai memori cukup, Keuangan memakai adapter `log` dan pemberitahuan di portal saja (§13 nomor 6).

### 6.7 SQ Hub

- **Organization Directory:** unit pemilik tagihan, akun keuangan, pagu, dan permintaan pengeluaran.
- **Application Access:** siapa boleh membuka keuangan.; peran di dalam aplikasi diatur Keuangan.
- **Ringkasan Yayasan (ADR-0009):** Keuangan menerbitkan kontrak ringkasan untuk Organ Yayasan, misalnya total tagihan terbit, terbayar, dan tunggakan per unit; saldo kas dan bank; realisasi anggaran. Hanya angka agregat.

### 6.8 Sekolah (kelak)

Sekolah akan menjadi sumber **murid aktif, kelas, dan status keluar/pindah** untuk SPP rutin (R5). Sampai itu ada, daftar murid diambil dari pendaftar Terdaftar SPMB ditambah impor murid lama, dan Keuangan menyediakan aksi staf "nonaktifkan Akun Tagihan" untuk murid yang keluar.

## 7. Peran

| Peran | Kewenangan | Tidak bisa |
| --- | --- | --- |
| Kepala Keuangan | Melihat semua unit, menyetujui pengembalian dana, kesepakatan cicilan, dan perpanjangan tenggat di atas batas, rekonsiliasi | Menyetujui permintaannya sendiri |
| Bendahara Yayasan | Mengelola akun keuangan tingkat yayasan, transfer antar akun, saldo awal | — |
| Kasir (per unit atau yayasan) | Mengonfirmasi pembayaran, mencatat tunai, membayar voucher, tutup kas harian | Menyetujui pengeluaran yang dibayarnya sendiri bila ia juga pemohon |
| Petugas Penagihan | Jenis tagihan, generate tagihan, penyesuaian koreksi, kesepakatan cicilan dan perpanjangan tenggat sampai batas | Mengonfirmasi pembayaran |
| Penyetuju pengeluaran | Menyetujui permintaan dan pertanggungjawaban uang muka di unitnya (mis. kepala unit, Direktur) | Membayar |
| Pengelola anggaran | Menyusun periode, pos, dan pagu | Menyetujui pagu, revisi, atau transfer |
| Penyetuju anggaran | Mengesahkan pagu, revisi, dan transfer | — |
| Pengamat (Pengurus, Pengawas) | Membaca laporan dan ringkasan | Mengubah apa pun |

Setiap peran punya **lingkup unit**, mengikuti pola SPMB. Pemisahan wewenang dibawa dari SIPAYA: mengelola ≠ menyetujui ≠ membayar, dan pengelola kas ≠ penyetuju anggaran. Peran dengan akses data keuangan orang lain wajib MFA (`staff-authentication-policy.md`).

## 8. Dokumen resmi

Memakai standar tagihan dan kuitansi SPMB-001 §7.1, yang memang diusulkan menjadi standar Keuangan, supaya semua dokumen yang diterima keluarga sama bentuknya.

| Dokumen | Nomor usulan |
| --- | --- |
| Tagihan | `INV/KEU/<tahun ajaran>/<urut>` |
| Kuitansi | `KWT/KEU/<tahun ajaran>/<urut>` |
| Voucher pengeluaran | `VCR/KEU/<tahun anggaran>/<urut>` |
| Bukti pengembalian dana | `RFD/KEU/<tahun ajaran>/<urut>` |

- Urutan tanpa lompatan per jenis per periode, dijamin database. SIPAYA sengaja tidak mewajibkan urutan sequential; di sini diwajibkan karena standar SPMB §7.1 sudah memintanya.
- PDF dibuat sekali saat terbit, disimpan dengan checksum, ber-QR verifikasi.
- **Bea meterai:** kuitansi di atas Rp5.000.000 terutang meterai Rp10.000 (UU 10/2020). Uang masuk SDIT dan PTSQ melewati batas ini, jadi R1 sudah harus menjawab caranya (§13 nomor 5).
- Status pajak jasa pendidikan dan barang seperti seragam perlu dikonfirmasi ke konsultan pajak yayasan (catatan yang sama di SPMB-001 §7.1).

## 9. Privasi, keamanan, audit

- Nomor rekening, data penghasilan, dan rincian potongan disamarkan di daftar dan tidak masuk log atau payload audit umum.
- Bukti pembayaran dan bukti pengeluaran disimpan privat dengan tautan sementara; PDF, JPEG, PNG, maks. 5 MiB (aturan SIPAYA).
- Audit mencatat setiap terbit/batal tagihan, penyesuaian, pembayaran, pembalikan, persetujuan, voucher, mutasi kas, rekonsiliasi, perubahan pagu, tutup kas, dan setiap peristiwa yang dikirim atau diterima dari modul lain beserta versinya.
- Data keuangan disimpan selamanya.

## 10. Tampilan

Mengikuti SQ Core design system C dan app shell. Teks antarmuka tidak menyingkat Sabilul Qur'an menjadi "SQ".

Navigasi ruang staf: **Ringkasan**, **Penagihan** (Tagihan, Pembayaran, Piutang & tunggakan, Kuitansi), **Kas & Bank** (Buku kas, Transfer, Rekonsiliasi, Tutup kas harian), **Pengeluaran** (Permintaan, Voucher, Uang muka kegiatan, Pengembalian dana), **Anggaran**, **Laporan**, **Pengaturan**.

Pola interaksi dari SIPAYA: daftar dulu, buat/ubah lewat dialog atau sheet, satu aksi utama per layar, pratinjau nominal sebelum aksi uang yang tidak bisa dibatalkan, dan sheet layar penuh di ponsel.

Aksen kategori Keuangan: belum dipilih (biru dipakai SPMB, oranye dipakai Karir).

## 11. Migrasi

- **Saldo awal** per akun kas/bank per sumber dana, satu kali, beralasan, dari spreadsheet kas operasional.
- **Piutang lama** (SPP dan uang masuk murid yang sudah bersekolah) dimigrasikan sebagai tagihan berstatus terbit dengan baris "Saldo awal piutang", bukan direkonstruksi per bulan, kecuali bagian keuangan punya data per bulan yang rapi.
- **Murid aktif** untuk Akun Tagihan: dari data yang dipegang bagian keuangan atau sekolah. Anak yang tidak punya NIK atau keluarga tanpa KK tidak bisa masuk Keluarga SQ (keputusan SPMB 2026-10-22), jadi perlu antrean pelengkapan seperti migrasi SPMB.
- **Status pelunasan manual di SPMB** (jalur Petugas Keuangan) diimpor menjadi pembayaran dengan rujukan catatan manual, lalu jalur manual dimatikan.
- Data produksi tidak masuk repository, log, atau lingkungan uji.

## 12. Risiko

| Risiko | Penanganan |
| --- | --- |
| Memori Mi8 tidak cukup untuk satu aplikasi lagi | Ukur sebelum spesifikasi implementasi; opsi menunda R2–R4 sampai server lain tersedia |
| Aturan kursi pasti bertentangan dengan KAK ("tidak melunasi = mengundurkan diri") | Bawaan `lunas` sesuai KAK; kelonggaran hanya per pendaftar oleh Keuangan; Gugur selalu dikonfirmasi panitia (§6.2.4) |
| Kelonggaran Keuangan dipakai terlalu longgar sehingga kursi tertahan lama | Batas perpanjangan yang butuh Kepala Keuangan; laporan SPMB menampilkan kursi Dipesan dengan tenggat yang sudah diperpanjang |
| Keuangan R1 belum siap saat daftar ulang 2027/2028 | Jalur manual SPMB dengan nominal dibayar (§6.2.6 butir 5) |
| Konfirmasi bayar gaji dikerjakan di dua tempat | Satu konfirmasi di Keuangan yang memanggil HCIS (§6.3), diputuskan bersama ADR-0003 HCIS |
| Modul melebar menjadi sistem akuntansi | COA, jurnal, dan laporan akuntansi resmi hanya lewat keputusan PO terpisah (§13 nomor 7) |
| Kode SIPAYA tergoda disalin mentah | Ambil aturan domain dan uji kasusnya; lapisan multi-tenant SIPAYA tidak dibawa |

## 13. Keputusan terbuka

| # | Pertanyaan | Saran |
| --- | --- | --- |
| 1 | Cara menyelaraskan Gugur dengan KAK (§6.2.4) | **Tiga lapis:** aturan program bawaan `lunas` sesuai KAK, penilaian otomatis oleh SPMB, kelonggaran per pendaftar oleh Keuangan (perpanjangan tenggat, cicilan, potong gaji). Gugur tetap dikonfirmasi panitia. KAK tahun berikutnya memakai kalimat usulan §6.2.4 |
| 1a | Batas perpanjangan tenggat yang boleh diberikan Petugas Penagihan tanpa Kepala Keuangan | 30 hari dari tenggat awal |
| 2 | Kesepakatan potong gaji yang disetujui langsung membuat kursi pasti? | **Ya**, karena pegawai sudah terikat lewat payroll |
| 3 | Konfirmasi bayar gaji di Keuangan, yang lalu menandai HCIS (§6.3)? | **Ya**, dibahas sebelum ADR-0003 HCIS ACCEPTED |
| 4 | Nama untuk uang muka kegiatan | **Uang muka kegiatan**; "kasbon" tetap berarti pinjaman pegawai di HCIS |
| 5 | Meterai kuitansi di atas Rp5.000.000 | Mulai dengan meterai fisik di kuitansi cetak yang diminta keluarga; e-meterai diputuskan setelah biaya per dokumen diketahui |
| 6 | Nomor WhatsApp Keuangan | Tunda sampai memori Mi8 cukup; sementara notifikasi di portal saja |
| 7 | COA dan laporan akuntansi resmi | Di luar R1–R4; dinilai ulang setelah R2 berjalan satu semester |
| 8 | Ambang kursi pasti bawaan per program | **`lunas`**, sesuai KAK. Ambang persen (mis. 50%) hanya bila KAK tahun itu menuliskannya |
| 9 | Biaya pendaftaran tetap ditagih SPMB atau pindah ke Keuangan | **Tetap di SPMB**; Keuangan hanya menerima kuitansinya sebagai penerimaan kas (R2) |

## 14. Langkah berikutnya

1. Product Owner memutuskan §13 nomor 1, 1a, 2, dan 8, karena semuanya menentukan revisi SPMB-001 untuk R2a.
2. Revisi SPMB-001 (§6.2.6) di repository `sq-spmb`, termasuk jalur manual nominal dibayar.
3. Wawancara singkat bagian keuangan: spreadsheet yang benar-benar dipakai, di mana SPP murid lama dicatat, rekening resmi yang aktif, dan siapa memegang peran §7. Hasilnya mengganti catatan DISCOVERY di §1.1.
4. Bahas §6.3 bersama ADR-0003 HCIS.
5. Ukur kapasitas Mi8 untuk satu aplikasi lagi.
6. Baru setelah itu: ADR bila diperlukan, lalu spesifikasi implementasi `KEU-IMPL-001` untuk R1 saja.

Sebelum langkah 1–5 selesai, tidak ada kode yang ditulis.
