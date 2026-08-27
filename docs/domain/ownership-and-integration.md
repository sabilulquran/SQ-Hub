# Data Ownership and Integration

**Status:** ACCEPTED

## Principle
SQ Hub mendorong integrasi kuat tanpa mengaburkan ownership data dan business logic.

Setiap data penting harus memiliki satu system of record yang jelas. Aplikasi lain boleh membaca atau menggunakan data tersebut melalui integration contract yang disepakati, tetapi tidak mengambil alih ownership secara diam-diam.

## Target ownership
| Data/capability | Owner |
|---|---|
| Staff global identity | SQ Identity (SQ Hub capability) |
| Organizational Unit | SQ Hub |
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

## Organizational Unit transition
HCIS sudah memiliki konsep `organizational_units`. Foundation v1 menetapkan **target ownership** Organizational Unit pada SQ Hub, tetapi cutover tidak boleh diasumsikan terjadi hanya karena dokumen ini diterima.

Sebelum SQ Hub menjadi system of record aktif untuk Organizational Unit:
- inventaris dan petakan unit HCIS yang sudah ada;
- tentukan stable identifier/mapping untuk integrasi;
- tentukan migration/cutover plan;
- hindari periode dual-write tanpa aturan sinkronisasi yang eksplisit;
- pastikan HCIS tetap berjalan normal sampai cutover dinyatakan selesai.

Setelah cutover, aplikasi domain tidak membuat master unit paralel sebagai source of truth baru.

## Cross-domain workflow
Cross-domain workflow adalah expected behavior, bukan exception. Contoh:
- SPMB menggunakan Organizational Unit dari SQ Hub.
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
