# Satu langkah per layar

**Status:** ACCEPTED oleh Product Owner pada 2026-11-20 (keputusan di chat hari itu: "tetapkan untuk semua di SQ Suite, jangan ada yang menempatkan langkah selanjutnya di bawahnya").
**Specification:** UX-FLOW-001
**Berlaku untuk:** setiap aplikasi dan portal di SQ Suite (daftar di [STRUKTUR-001](../product/struktur-sq-suite.md)), termasuk halaman platform SQ Hub sendiri.
**Bagian dari:** [SQ Suite design system, direction C](sq-core-design-system-c.md) dan [app shell](sq-core-app-shell.md).
**Implementasi rujukan:** HCIS LEAVE-UX-001, pengajuan cuti (`apps/web/src/lib/useWizardStep.ts`, `components/leave/WizardSteps.tsx`, `components/leave/WizardDone.tsx` di repository `hcisysq`).

## Istilah

| Istilah | Arti |
| --- | --- |
| **Satu langkah per layar** (*one step per screen*, *one thing per page*) | Pola yang diwajibkan. Setiap langkah alur tampil sendiri dan **menggantikan** layar langkah sebelumnya. |
| **Wizard / stepper / multi-step form** | Nama komponen untuk alur bertahap dengan penanda langkah. |
| **Langkah bertumpuk** (*stacked steps*, *inline step reveal*) | Pola yang **dilarang**: menekan `Lanjutkan` membuat langkah berikutnya (ringkasan, form lanjutan, tombol kirim) muncul di bawah langkah yang masih terlihat, sehingga semuanya menumpuk jadi satu halaman panjang. |
| **Progressive disclosure** | Prinsip menampilkan hanya yang relevan. Di SQ Suite prinsip ini dijalankan **antar layar**, tidak dengan memanjangkan satu halaman. |

## Kapan aturan berlaku

Aturan berlaku untuk setiap alur yang punya lebih dari satu langkah sebelum sebuah aksi dikirim. Contohnya pilih jenis lalu isi data, isi data lalu periksa ringkasan, atau unggah berkas lalu pratinjau impor lalu konfirmasi. Aturan ini berlaku untuk portal pegawai maupun portal admin, dan di halaman penuh maupun di dalam dialog.

Yang tidak termasuk:

- form satu langkah yang langsung dikirim;
- konfirmasi kecil di tempat yang **menggantikan** tombolnya sendiri (misalnya `Batalkan` berubah menjadi `Ya, batalkan / Tidak`);
- filter, pencarian, dan panel detail sebuah baris daftar;
- pesan validasi dan error.

## Aturan

1. **Langkah berikutnya menggantikan langkah sekarang.** Setelah `Lanjutkan`, input langkah sebelumnya tidak lagi terlihat. Ringkasan di langkah periksa menampilkan ulang nilainya sebagai teks.
2. **Langkah ada di URL.** Alur di halaman penuh menyimpan langkah di query (`?langkah=<nama>`), sehingga tombol Kembali browser atau Android mundur satu langkah dan isian tidak hilang. Langkah pertama tidak menulis query. Alur di dalam dialog boleh menyimpan langkah di state dialog, tetapi tetap menampilkan satu langkah saja.
3. **Penanda langkah.** Di atas langkah ada penanda bernomor. Di layar sempit hanya label langkah aktif yang ditulis, dan langkah yang sudah selesai diberi centang.
4. **Mulai dari atas.** Setiap pergantian langkah membuka layar dari atas. Error validasi atau API ditampilkan di bawah penanda langkah, dan halaman digulir ke sana.
5. **Satu aksi utama per langkah.** Tombol utama ada di bawah langkah (lebar penuh di ponsel). Langkah periksa punya tombol kembali (`Ubah data`/`Ubah tanggal`) di samping atau di bawah tombol kirim.
6. **Layar selesai.** Setelah aksi terkirim, layar konfirmasi menggantikan langkah periksa (`replace` pada riwayat browser), sehingga tombol Kembali tidak pernah membuka lagi ringkasan yang bisa dikirim ulang. Layar ini memberi jalan ke status atau riwayat.
7. **Langkah lanjutan tidak bisa dibuka tanpa datanya.** Membuka `?langkah=periksa` lewat refresh atau tautan tanpa data langkah sebelumnya kembali ke langkah pertama yang relevan. Isian tidak disimpan di luar memori halaman kecuali sebuah spesifikasi mengatur draft.
8. **Daftar dan riwayat tidak berada di bawah form.** Riwayat pengajuan beserta aksinya tampil di halaman induk atau di langkah pertama, tidak di bawah langkah isi atau periksa.
9. **Pilihan jenis adalah langkah sendiri.** Kartu pilihan jenis tidak tetap terlihat di atas form setelah dipilih. Mengganti jenis berarti kembali ke langkah pilih.

## Kriteria penerimaan

- UX-FLOW-001-A: setelah `Lanjutkan`, input langkah sebelumnya tidak ada di DOM halaman.
- UX-FLOW-001-B: tombol Kembali browser dari langkah periksa kembali ke langkah isi dengan isian utuh.
- UX-FLOW-001-C: setelah kirim, layar selesai tampil, dan tombol Kembali tidak membuka ringkasan yang bisa dikirim ulang.
- UX-FLOW-001-D: membuka langkah lanjutan langsung tanpa data kembali ke langkah pertama.
- UX-FLOW-001-E: pemeriksaan tampilan mobile (lebar sekitar 390 px) menunjukkan tombol utama tiap langkah terlihat tanpa harus melewati form langkah lain.

## Penerapan

- Alur baru wajib mengikuti aturan ini sejak spesifikasinya ditulis. Spesifikasi alur bertahap mencantumkan nama langkah dan nilai `?langkah=`.
- Alur lama yang masih bertumpuk dicatat oleh aplikasinya masing-masing dan diperbaiki ketika alur itu disentuh, atau lebih cepat bila diminta Product Owner. Pengecualian hanya sah bila ditulis di spesifikasi alur beserta alasannya.
- Komponen bersama (penanda langkah, layar selesai, hook langkah) dipindahkan ke design system di repository ini setelah aplikasi kedua memakainya (AGENTS §8). Sampai itu, implementasi rujukan HCIS di atas menjadi acuan perilakunya.

## Status penerapan (audit 2026-11-20)

"Diperbaiki" artinya sudah diubah di branch. Status ini bukan berarti sudah dirilis.

| Aplikasi | Alur | Langkah (`?langkah=`) |
| --- | --- | --- |
| Admin SQ (Organ Yayasan) | Tambah anggota | pilih (tanpa query) → `isi` → `periksa` → `selesai` |
| Admin SQ (Organ Yayasan) | Akhiri keanggotaan (dialog) | layar akhiri menggantikan detail di dalam dialog (state dialog) |
| Kirim SQ | Impor dari berkas ekspor chat | unggah (tanpa query) → `pratinjau` → `selesai` |
| Sekretariat SQ | Asisten Surat (SEK-IMPL-004) | konteks (tanpa query) → `lengkapi` → `periksa` → `selesai` |
| HCIS | lihat `docs/development/step-flow-audit-2026-11-20.md` di repository `hcisysq` | — |

Implementasi platform: `apps/web/src/components/useWizardStep.ts` (memakai `pushState`/`popstate` seperti `useDialogParam`, karena aplikasi web Hub tidak memakai router) dan `apps/web/src/components/WizardSteps.tsx`.
