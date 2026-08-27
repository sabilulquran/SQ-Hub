# SQ Hub Glossary

**Status:** ACCEPTED

Gunakan istilah ini secara konsisten. Jangan membuat sinonim baru tanpa kebutuhan nyata.

- **SQ Hub** — shared digital platform foundation Sabilul Qur'an.
- **SQ Identity** — capability identity dan authentication staf yang dipercaya oleh aplikasi SQ Hub.
- **Identity** — representasi global akun staf yang dapat melakukan authentication. Memiliki technical UUID.
- **Staff** — manusia internal Sabilul Qur'an yang dapat memperoleh identity dan akses aplikasi. Staff tidak identik dengan Employee record.
- **Employee** — data kepegawaian milik HCIS.
- **Application** — sistem domain yang bergabung dengan SQ Hub, misalnya HCIS atau SPMB.
- **Application Registry** — daftar resmi aplikasi yang dikenali SQ Hub.
- **Application Access** — izin sebuah Identity untuk membuka Application tertentu.
- **Role** — sekumpulan tanggung jawab/permission dalam konteks aplikasi domain tertentu, kecuali dinyatakan lain.
- **Permission** — kemampuan spesifik yang diberikan oleh aplikasi/domain.
- **Authentication** — proses membuktikan siapa pengguna yang sedang masuk.
- **Authorization** — proses menentukan apa yang boleh dilakukan pengguna setelah identity diketahui.
- **SSO / Single Sign-On** — pengalaman ketika staff cukup melakukan authentication sekali dan dapat berpindah ke aplikasi lain yang diizinkan tanpa memasukkan credential lagi.
- **Organizational Unit** — unit organisasi resmi Sabilul Qur'an yang menjadi shared master SQ Hub.
- **Domain** — area bisnis dengan ownership aturan dan data yang jelas, misalnya Human Capital, Admissions, atau Finance.
- **Data Owner / System of Record** — domain/sistem yang berwenang membuat dan mengubah data resmi tertentu.
- **Integration Contract** — interface yang disepakati untuk pertukaran data atau tindakan lintas domain, biasanya API/schema/event contract sesuai kebutuhan.
- **Design System** — prinsip, tokens, komponen, dan pola UI bersama yang membuat aplikasi SQ Hub konsisten.
- **Hub Launcher** — antarmuka utama untuk melihat dan membuka aplikasi yang dapat diakses staff.

## Reserved distinctions
- Identity != Employee.
- Application Access != domain permission.
- Authentication != authorization.
- Organizational Unit != arbitrary label/string unit di aplikasi lokal.
- Shared capability != business logic yang kebetulan dipakai di dua file.
