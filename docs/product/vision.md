# SQ Hub Vision

**Status:** ACCEPTED. Terms and the ecosystem section aligned to ADR-0014 on 2026-11-16; the boundaries below are unchanged.

## Vision
SQ Hub adalah ekosistem aplikasi Yayasan Sabilul Qur'an: satu nama payung, satu akun per orang per portal, dan aplikasi-aplikasi yang berdiri berdampingan.

Yang menyatukannya adalah **bagian platform SQ Hub**: pengguna memakai berbagai aplikasi dengan identitas yang sama, struktur organisasi yang konsisten, kontrol akses aplikasi yang terpusat, dan pengalaman antarmuka yang senada.

## Terms
SQ Hub = seluruh ekosistem. Portal = pintu masuk satu kelompok pengguna. Aplikasi = sistem yang mengurus satu bidang dan memegang data serta aturannya. Modul = bagian di dalam satu aplikasi. Definisi lengkap: [`docs/domain/glossary.md`](../domain/glossary.md) dan ADR-0014.

## The platform part of SQ Hub is
- **Akun SQ**: fondasi identitas dan Single Sign-On;
- **Admin SQ**: registry aplikasi, Application Access, dan (target) satu konsol peran;
- **Beranda**: halaman awal yang menampilkan aplikasi yang boleh dibuka seseorang;
- **Direktori Organisasi**: shared Organization Directory yang memproyeksikan workforce organization dari HCIS;
- shared design system, app-shell conventions, dan (target) bilah atas bersama di semua aplikasi;
- tempat shared capability lintas aplikasi bila kebutuhan nyata terbukti (misalnya Kirim SQ untuk WhatsApp);
- titik integrasi yang memungkinkan aplikasi tetap independen tetapi interoperable.

## SQ Hub is not
- ERP monolith;
- satu program yang memuat aturan HCIS, SPMB SQ, Keuangan, Sekolah, atau aplikasi lain. Bagian platform tidak memegang business logic aplikasi; aplikasi yang berjalan di dalam proses Hub (ADR-0014 D6) tetap memiliki data, aturan, dan flag rilisnya sendiri;
- authoring system/master untuk workforce organization milik HCIS;
- central approval engine untuk transaksi domain;
- satu universal database untuk semua business domain;
- universal Person Registry pada fase awal;
- alasan untuk membuat microservice atau abstraction sebelum ada kebutuhan nyata.

## Product principles
1. One identity per person per portal, many applications.
2. Clear data ownership, strong integration.
3. Shared only when truly shared.
4. Applications remain independently maintainable.
5. Consistent experience across applications.
6. Security-sensitive behavior is explicit, testable, and never invented by AI.
7. Documentation and contracts precede implementation.
8. Every application that holds foundation data provides a Laporan face for the foundation's organs; organ members never operate an application (ADR-0014 D4).

## Ecosystem
The portals, the applications, where each runs, and their current status are kept in one place: [`docs/product/struktur-sq-hub.md`](struktur-sq-hub.md) (STRUKTUR-001). This document does not keep its own list. A new application is added there first (STRUKTUR-001 §9) when justified by an actual need.
