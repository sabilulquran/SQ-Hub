# SQ Hub Glossary

**Status:** ACCEPTED

Gunakan istilah ini secara konsisten. Jangan membuat sinonim baru tanpa kebutuhan nyata.

- **SQ Hub** — shared digital platform foundation Sabilul Qur'an.
- **SQ Identity** — capability identity dan authentication staf pada SQ Hub, yang nantinya menggunakan mature self-hosted Identity Provider sebagai mesin autentikasi/SSO.
- **Identity** — representasi global seorang pengguna internal pada ekosistem SQ Hub. Identity memiliki technical identifier yang stabil dan diperlakukan sebagai opaque identifier oleh aplikasi domain.
- **Staff** — manusia internal Sabilul Qur'an yang dapat memperoleh Identity dan akses aplikasi. Staff tidak identik dengan Employee record; tidak semua Staff harus memiliki Employee record atau NIP.
- **Staff Identifier** — identifier yang mudah digunakan manusia untuk proses login/administrasi. Untuk Employee, gunakan kembali NIP/nomor pegawai bila tersedia; jangan membuat nomor identitas paralel tanpa kebutuhan nyata. Policy fallback untuk Staff tanpa NIP ditentukan pada specification identity.
- **Employee** — data kepegawaian milik HCIS.
- **Application** — sistem domain yang bergabung dengan SQ Hub, misalnya HCIS atau SPMB.
- **Application Registry** — daftar resmi aplikasi yang dikenali SQ Hub.
- **Application Access** — izin sebuah Identity untuk membuka Application tertentu.
- **Role** — sekumpulan tanggung jawab/permission dalam konteks aplikasi domain tertentu, kecuali dinyatakan lain.
- **Permission** — kemampuan spesifik yang diberikan oleh aplikasi/domain.
- **Authentication** — proses membuktikan siapa pengguna yang sedang masuk.
- **Authorization** — proses menentukan apa yang boleh dilakukan pengguna setelah identity diketahui.
- **SSO / Single Sign-On** — pengalaman ketika staff cukup melakukan authentication sekali dan dapat berpindah ke aplikasi lain yang diizinkan tanpa memasukkan credential lagi.
- **Organizational Unit** — unit organisasi resmi Sabilul Qur'an yang target shared master-nya berada di SQ Hub.
- **Domain** — area bisnis dengan ownership aturan dan data yang jelas, misalnya Human Capital, Admissions, atau Finance.
- **Data Owner / System of Record** — domain/sistem yang berwenang membuat dan mengubah data resmi tertentu.
- **Integration Contract** — interface yang disepakati untuk pertukaran data atau tindakan lintas domain, biasanya API/schema/event contract sesuai kebutuhan.
- **Design System** — prinsip, tokens, komponen, dan pola UI bersama yang membuat aplikasi SQ Hub konsisten.
- **Hub Launcher** — antarmuka utama untuk melihat dan membuka aplikasi yang dapat diakses staff.

## Reserved distinctions
- Identity != Employee.
- Staff != Employee.
- Staff Identifier != technical Identity identifier.
- Application Access != domain permission.
- Authentication != authorization.
- Organizational Unit != arbitrary label/string unit di aplikasi lokal.
- Shared capability != business logic yang kebetulan dipakai di dua file.
