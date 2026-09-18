# Data Ownership and Integration

**Status:** ACCEPTED

## Principle
SQ Hub mendorong integrasi kuat tanpa mengaburkan ownership data dan business logic.

Setiap data penting harus memiliki satu system of record yang jelas. Aplikasi lain boleh membaca atau menggunakan data tersebut melalui integration contract yang disepakati, tetapi tidak mengambil alih ownership secara diam-diam.

## Target ownership
| Data/capability | Owner |
|---|---|
| Staff global identity | SQ Identity (SQ Hub capability) |
| Workforce organization authoring (unit, posisi/jabatan, penempatan, atasan, effective dates) | HCIS |
| Shared Organization Directory projection/distribution | SQ Hub |
| Approval/workflow policy dan decision audit | masing-masing aplikasi domain |
| Application Registry | SQ Hub |
| Application Access | SQ Hub |
| Employee master | HCIS |
| Attendance | HCIS |
| Leave | HCIS |
| Payroll/payslip | HCIS |
| Applicant/admission/selection | SPMB |
| Finance business records | Finance (future) |
| Work/project records | Workspace (future) |
| Student academic records | Academic (future) |

## Organization authoring dan shared directory
HCIS adalah **system of authority** dan tempat authoring untuk workforce organization, termasuk unit organisasi, posisi/jabatan, penempatan pegawai, hubungan atasan, effective dates, dan data ketenagakerjaan terkait.

SQ Hub memiliki **Organization Directory** sebagai projection/read model dan distribution layer lintas aplikasi. Hub menerima data dari HCIS melalui authenticated integration contract dan tidak menyediakan edit path untuk fakta organisasi milik HCIS.

Boundary wajib:
- tidak ada direct database coupling ke database HCIS untuk shared organization reads;
- tidak ada dual-write HCIS dan Hub;
- tidak ada master organisasi paralel;
- Keycloak bukan organization master;
- aplikasi lain seperti Finance dan Workspace membaca shared Organization Directory dari Hub sebagai default distribution path;
- last-known-good projection boleh dilayani saat HCIS sementara tidak tersedia, tetapi source/version/synchronized_at atau as_of/staleness harus terlihat;
- SLA, global identifier, snapshot/delta, conflict handling, dan retention tetap DISCOVERY/TBD pada HUB-IMPL-018.

### Approval/workflow boundary
SQ Hub bukan central approval engine. Hub hanya menyediakan fakta organisasi yang dapat dipakai domain app untuk menentukan kandidat approver atau scope.

Masing-masing aplikasi domain tetap memiliki approval policy, workflow state, delegation, escalation, authorization, dan audit keputusan. Ketika transaksi diajukan, domain app menyimpan resolved approver snapshot beserta organization version/effective time yang digunakan. Perubahan struktur organisasi berikutnya tidak boleh diam-diam menulis ulang approval yang sedang berjalan tanpa aturan domain eksplisit.

## Cross-domain workflow
Cross-domain workflow adalah expected behavior, bukan exception. Contoh:
- Aplikasi domain menggunakan Organization Directory SQ Hub untuk shared organization reads yang diperlukan, sementara HCIS tetap meng-author data sumber.
- SPMB dapat meminta Finance membuat tagihan.
- HCIS dapat mengirim atau menerima finance-related contract sesuai workflow yang disetujui.
- SPMB dapat membuat work item pada Workspace melalui contract.
- applicant yang menyelesaikan proses penerimaan dapat menjadi input untuk Academic melalui explicit handoff.

## Default integration rule
Untuk cross-domain write, gunakan API/contract yang dimiliki target domain sebagai default. Jangan menulis langsung ke tabel milik domain lain hanya untuk mempercepat implementasi.

Cross-domain read dapat memakai API, cached/read model, reporting store, atau mekanisme lain sesuai kebutuhan. Pilihan yang menyimpang dari direct API untuk operational write harus memiliki alasan dan ADR jika berdampak arsitektural.

## Shared database
Dokumen ini tidak mewajibkan setiap aplikasi memiliki server database fisik terpisah. Beberapa database/schema dapat berjalan di PostgreSQL/VPS yang sama selama ownership, credential, migration, dan boundary tetap jelas.

## Universal Person Registry
Tidak dibuat pada Foundation v1. Identity, Employee, Applicant, Guardian, dan Student tetap konsep berbeda sampai ada kasus lintas domain nyata yang membuktikan kebutuhan master person bersama.
