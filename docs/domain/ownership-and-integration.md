# Data Ownership and Integration

**Status:** ACCEPTED

## Principle
SQ Hub mendorong integrasi kuat tanpa mengaburkan ownership data dan business logic.

Setiap data penting harus memiliki satu system of record yang jelas. Aplikasi lain boleh membaca atau menggunakan data tersebut melalui integration contract yang disepakati, tetapi tidak mengambil alih ownership secara diam-diam.

## Initial ownership
| Data/capability | Owner |
|---|---|
| Staff global identity | SQ Identity / SQ Hub |
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
