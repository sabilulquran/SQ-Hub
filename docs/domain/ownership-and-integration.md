# Data Ownership and Integration

**Status:** ACCEPTED. Owner names aligned to ADR-0014 on 2026-11-16; the ownership rules are unchanged.

## Principle
SQ Hub mendorong integrasi kuat tanpa mengaburkan ownership data dan business logic. Di dokumen ini "platform SQ Hub" atau "Hub" berarti bagian platform (Akun SQ, Admin SQ, Beranda, Direktori Organisasi); daftar aplikasi dan statusnya ada di [`docs/product/struktur-sq-hub.md`](../product/struktur-sq-hub.md).

Setiap data penting harus memiliki satu system of record yang jelas. Aplikasi lain boleh membaca atau menggunakan data tersebut melalui integration contract yang disepakati, tetapi tidak mengambil alih ownership secara diam-diam.

## Target ownership
| Data/capability | Owner |
|---|---|
| Staff global identity | Akun SQ / SQ Identity (platform SQ Hub) |
| Workforce organization authoring (unit, posisi/jabatan, penempatan, atasan, effective dates) | HCIS |
| Shared Organization Directory projection/distribution | Platform SQ Hub (Direktori Organisasi) |
| Approval/workflow policy dan decision audit | masing-masing aplikasi |
| Application Registry | Platform SQ Hub (Admin SQ) |
| Application Access | Platform SQ Hub (Admin SQ) |
| Organ Yayasan membership | Platform SQ Hub (Admin SQ), HUB-IMPL-021 |
| Employee master | HCIS |
| Attendance | HCIS |
| Leave | HCIS |
| Payroll/payslip | HCIS |
| Student admission/selection (penerimaan murid baru) | SPMB SQ |
| Job applicants and recruitment | Karir SQ |
| Assets and handovers | Aset SQ |
| Family accounts and the family portal | Keluarga SQ |
| WhatsApp numbers, sending queue, and conversations | Kirim SQ (runs in the Hub process, ADR-0011) |
| Work/project records (rooms, boards, cards) | Kerja SQ (runs in the Hub process, ADR-0014 D6 reason 3) |
| Letter numbering, incoming mail, SK archive | Sekretariat SQ (runs in the Hub process, ADR-0014 D6 reason 3) |
| Meetings, minutes, decision register | Rapat SQ (design RAPAT-001) |
| Finance business records (billing, SPP, cash/bank, budget) | Keuangan (design KEU-001) |
| Donations, scholarships, aid | Sosial & Dakwah (design SOS-001) |
| Student academic records | Sekolah (named only; no design yet) |
| Governance summaries shown to the organs | each application (its Laporan face); Portal Organ only displays them and stores no domain data (ADR-0009, ADR-0012) |

Which of these applications already run is recorded in STRUKTUR-001 §5, not here. An application that runs inside the Hub process still owns its tables (own prefix), rules, and release flag; other applications reach it only through a contract (ADR-0014 D6).

## Organization authoring dan shared directory
HCIS adalah **system of authority** dan tempat authoring untuk workforce organization, termasuk unit organisasi, posisi/jabatan, penempatan pegawai, hubungan atasan, effective dates, dan data ketenagakerjaan terkait.

Platform SQ Hub memiliki **Organization Directory** sebagai projection/read model dan distribution layer lintas aplikasi. Hub menerima data dari HCIS melalui authenticated integration contract dan tidak menyediakan edit path untuk fakta organisasi milik HCIS.

Boundary wajib:
- tidak ada direct database coupling ke database HCIS untuk shared organization reads;
- tidak ada dual-write HCIS dan Hub;
- tidak ada master organisasi paralel;
- Keycloak bukan organization master;
- aplikasi lain seperti Keuangan dan Kerja SQ membaca shared Organization Directory dari Hub sebagai default distribution path;
- last-known-good projection boleh dilayani saat HCIS sementara tidak tersedia, tetapi source/version/synchronized_at atau as_of/staleness harus terlihat;
- Kontrak v1 identifier, pull full snapshot, reconciliation, dan freshness ditetapkan HUB-IMPL-018 **ACCEPTED**; SLA deployment dan retention/history tetap TBD.

### Approval/workflow boundary
Platform SQ Hub bukan central approval engine. Hub hanya menyediakan fakta organisasi yang dapat dipakai domain app untuk menentukan kandidat approver atau scope.

Masing-masing aplikasi domain tetap memiliki approval policy, workflow state, delegation, escalation, authorization, dan audit keputusan. Ketika transaksi diajukan, domain app menyimpan resolved approver snapshot beserta organization version/effective time yang digunakan. Perubahan struktur organisasi berikutnya tidak boleh diam-diam menulis ulang approval yang sedang berjalan tanpa aturan domain eksplisit.

## Cross-domain workflow
Cross-domain workflow adalah expected behavior, bukan exception. Contoh:
- Aplikasi menggunakan Organization Directory platform SQ Hub untuk shared organization reads yang diperlukan, sementara HCIS tetap meng-author data sumber.
- SPMB SQ dapat meminta Keuangan membuat tagihan.
- HCIS dapat mengirim atau menerima finance-related contract sesuai workflow yang disetujui.
- SPMB SQ dapat membuat work item pada Kerja SQ melalui contract.
- Aplikasi mengirim WhatsApp lewat Kirim SQ, tidak langsung ke mesin WhatsApp (ADR-0011).
- applicant yang menyelesaikan proses penerimaan dapat menjadi input untuk Sekolah melalui explicit handoff.

## Default integration rule
Untuk cross-domain write, gunakan API/contract yang dimiliki target domain sebagai default. Jangan menulis langsung ke tabel milik domain lain hanya untuk mempercepat implementasi.

Cross-domain read dapat memakai API, cached/read model, reporting store, atau mekanisme lain sesuai kebutuhan. Pilihan yang menyimpang dari direct API untuk operational write harus memiliki alasan dan ADR jika berdampak arsitektural.

## Shared database
Dokumen ini tidak mewajibkan setiap aplikasi memiliki server database fisik terpisah. Beberapa database/schema dapat berjalan di PostgreSQL/VPS yang sama selama ownership, credential, migration, dan boundary tetap jelas.

## Universal Person Registry
Tidak dibuat pada Foundation v1. Identity, Employee, Applicant, Guardian, dan Student tetap konsep berbeda sampai ada kasus lintas domain nyata yang membuktikan kebutuhan master person bersama.
