# SQ Hub Operational Baseline

**Status:** DRAFT

## Goal
Menetapkan minimum operational safety agar sistem yang banyak dikembangkan dengan AI tetap dapat didiagnosis, dipulihkan, dan dipisahkan dari production secara aman tanpa membutuhkan infrastruktur enterprise.

## Environment separation
- Development/staging dan production harus terpisah secara logis.
- Keduanya boleh berjalan pada VPS fisik yang sama pada fase awal.
- Database, credential, configuration, dan storage production tidak boleh dipakai sebagai playground development.
- AI agent tidak mendapat unrestricted production write access secara default.

## Minimum observability
Setiap service production nantinya minimum menyediakan:
- health/readiness signal yang dapat diperiksa;
- structured application log untuk error dan kejadian operasional penting;
- request/correlation identifier pada flow lintas service bila relevan;
- audit log terpisah untuk tindakan user/admin yang sensitif;
- kemampuan menemukan penyebab kegagalan integrasi tanpa menampilkan secret atau data sensitif berlebihan.

Tool monitoring/error-tracking spesifik belum dipilih dan tidak wajib sebelum ada kebutuhan nyata.

## Logging safety
- Jangan log password, session token, access/refresh token, client secret, atau credential.
- Hindari menyalin payload data pribadi secara utuh ke log.
- Error log harus cukup untuk diagnosis tetapi mengikuti prinsip data minimization.

## Backup and recovery
Sebelum production launch:
- data production yang bersifat authoritative harus memiliki backup terjadwal;
- restore procedure harus didokumentasikan dan pernah diuji;
- destructive migration atau operasi berisiko harus memiliki recovery plan;
- backup tidak dianggap valid hanya karena job backup melaporkan sukses; kemampuan restore harus dibuktikan.

Target RPO/RTO, retention backup, dan storage backup final adalah keputusan deployment/operations berikutnya.

## Deployment principle
Independent application lifecycle adalah tujuan: maintenance atau deployment satu aplikasi tidak seharusnya mewajibkan seluruh aplikasi SQ Hub berhenti, kecuali shared dependency yang memang terkena perubahan.
