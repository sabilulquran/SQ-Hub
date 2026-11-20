import { useState, type ReactNode } from "react";

/**
 * ADR-0011 amendment 2026-11-17: the API guide for portals and applications outside Sabilul Qur'an
 * Suite, served by Kirim at /dokumentasi-api without sign-in. Endpoint names, fields, limits and
 * error codes follow the running implementation (routes-internal.ts, service.ts, gateway.ts).
 * The pattern follows provider docs developers already know: request line, parameter tables,
 * examples in curl, PHP and Node, then the answer.
 */

const TOC: Array<{ group: string; items: Array<{ id: string; label: string }> }> = [
  { group: "Mulai", items: [{ id: "mulai", label: "Dua langkah" }, { id: "autentikasi", label: "Autentikasi" }, { id: "alamat", label: "Alamat dasar" }, { id: "bentuk", label: "Bentuk jawaban" }] },
  { group: "Endpoint", items: [{ id: "sambungan", label: "Baca sambungan" }, { id: "kirim", label: "Kirim pesan" }, { id: "media", label: "Kirim media" }, { id: "status", label: "Status pesan" }, { id: "optout", label: "Jangan hubungi" }] },
  { group: "Terima", items: [{ id: "webhook", label: "Webhook" }, { id: "tandatangan", label: "Verifikasi tanda tangan" }] },
  { group: "Acuan", items: [{ id: "batas", label: "Batas dan jam kirim" }, { id: "galat", label: "Kode galat" }, { id: "otp", label: "Contoh: OTP" }] },
];

export function DokumentasiApiPage() {
  return (
    <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start">
      <header className="lg:col-span-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-brand-primary-deep">Sabilul Qur'an Suite · Kirim</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading sm:text-3xl">Gerbang API Kirim</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          REST API WhatsApp untuk portal dan aplikasi di luar Sabilul Qur'an Suite. Aplikasi memanggil Kirim; Kirim yang mengurus nomor, antrean, batas laju, jam kirim, daftar jangan hubungi, status terkirim, dan audit.
        </p>
      </header>

      <nav aria-label="Daftar isi" className="hidden lg:sticky lg:top-32 lg:block">
        {TOC.map((group) => (
          <div key={group.group} className="mb-4">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{group.group}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.id}><a href={`#${item.id}`} className="block rounded-lg px-2.5 py-1.5 text-sm text-foreground hover:bg-muted">{item.label}</a></li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <main className="min-w-0 space-y-12">
        <Section id="mulai" title="Dua langkah sebelum memanggil API">
          <div className="grid gap-3 sm:grid-cols-2">
            <Step n={1} title="Sambungkan nomor">Pengelola Kirim membuka kartu <b>Aplikasi luar</b>, menekan <i>Sambungkan nomor baru</i>, lalu memindai QR dari HP nomor yang akan dipakai. Satu kartu menampung beberapa nomor; tiap nomor langsung punya kunci API sendiri.</Step>
            <Step n={2} title="Salin kunci nomor itu ke aplikasi Anda">Di pop-up kartu, tekan <i>Tampilkan</i> atau <i>Salin</i> pada nomor yang dipakai, lalu taruh kunci <code>krm_…</code> di berkas env server aplikasi (misalnya <code>KIRIM_API_KEY</code>). Jangan di kode frontend, repositori, atau tiket.</Step>
          </div>
          <Note>Kirim tidak perlu tahu nama aplikasi Anda: tidak ada pendaftaran aplikasi dan tidak ada akun mesin yang harus dibuat. Kunci melekat pada nomor, seperti kunci device di penyedia WhatsApp lain. Aplikasi tidak pernah menyebut kode nomor saat mengirim; Kirim memakai nomor pemilik kunci. Kunci bisa diputar ulang atau dicabut dari kartu tanpa memutus WhatsApp.</Note>
        </Section>

        <Section id="autentikasi" title="Autentikasi">
          <p>Setiap permintaan membawa kunci API di header <code>Authorization</code>. Tidak ada token yang perlu diperbarui, tidak ada alur OAuth, dan tidak ada rahasia lain yang disalin ke aplikasi.</p>
          <Table head={["Header", "Wajib", "Isi"]} rows={[
            [<code>Authorization</code>, <Req />, <><code>Bearer krm_…</code>, kunci nomor Anda dari kartu Aplikasi luar</>],
            [<code>Content-Type</code>, <Req />, <><code>application/json</code>, kecuali unggah berkas yang memakai <code>multipart/form-data</code></>],
            [<code>Idempotency-Key</code>, <Req label="wajib di POST pesan" />, "1–200 karakter, milik aplikasi sendiri; mencegah pesan ganda saat permintaan diulang. Berlaku per nomor, jadi dua nomor boleh memakai nilai yang sama."],
          ]} />
          <Note>Kunci API setara kata sandi. Kunci yang bocor diputar ulang atau dicabut dari kartu Aplikasi luar tanpa memutus nomor; kunci lama lalu dijawab <code>401 unauthenticated</code>.</Note>
        </Section>

        <Section id="alamat" title="Alamat dasar">
          <Table head={["Aplikasi berjalan di", "Alamat dasar", "Keadaan"]} rows={[
            ["Server yang sama dengan Kirim (Mi8)", <code>http://127.0.0.1:3302/internal/kirim</code>, <Chip live>berjalan</Chip>],
            ["Server lain atau hosting luar", <code>https://kirim.sabilulquran.or.id/api/v1</code>, <Chip>rancangan</Chip>],
          ]} />
          <p>Alamat <code>/internal/*</code> hanya bisa dicapai dari host yang sama; edge publik menjawab 404. Contoh di halaman ini memakai variabel <code>$KIRIM</code> sebagai alamat dasar dan <code>$KUNCI</code> sebagai kunci API.</p>
        </Section>

        <Section id="bentuk" title="Bentuk jawaban">
          <p>Jawaban sukses mengembalikan objek sumber daya itu sendiri. Jawaban galat selalu satu bentuk, dan tidak pernah memuat isi pesan atau nomor utuh orang lain.</p>
          <Code>{`{
  "error": {
    "code": "device_not_connected",
    "message": "Aplikasi ini belum tersambung ke WhatsApp. Sambungkan di kartu aplikasinya di Kirim SQ.",
    "fields": ["device"]
  }
}`}</Code>
        </Section>

        <Section id="sambungan" title="Baca sambungan">
          <Endpoint method="GET" path="$KIRIM/sambungan">
            <p>Memberi tahu nomor pemilik kunci, jenis pesan yang boleh dikirim, dan alamat webhook beserta rahasianya. Panggil sekali saat aplikasi start, bukan tiap mengirim.</p>
            <Tabs tabs={[
              { label: "curl", code: `curl -s "$KIRIM/sambungan" \\
  -H "Authorization: Bearer $KUNCI"` },
              { label: "respon", code: `{
  "nomor": { "kode": "luar", "status": "tersambung", "nomor_tersamar": "+62 812-••••-7890" },
  "jenis": ["notifikasi", "kode"],
  "webhook": null
}` },
            ]} />
            <p className="text-xs text-muted-foreground">status: belum_dipasang · menunggu_pairing · tersambung · terputus · nonaktif. <code>webhook</code> terisi <code>{"{ url, secret }"}</code> setelah Anda mendaftarkan webhook.</p>
          </Endpoint>
        </Section>

        <Section id="kirim" title="Kirim pesan">
          <Endpoint method="POST" path="$KIRIM/messages">
            <p>Menerima pesan ke antrean Kirim dan menjawab <code>202</code> seketika. Pengiriman sesungguhnya terjadi setelah itu; hasilnya dibaca lewat status atau webhook.</p>
            <h4 className="text-sm font-bold text-brand-heading">Parameter body</h4>
            <Table head={["Parameter", "Wajib", "Keterangan"]} rows={[
              [<code>jenis</code>, <Req />, <><code>kode</code> untuk OTP dan kode verifikasi, atau <code>notifikasi</code> untuk pesan otomatis lain. Lihat <a href="#batas">batas dan jam kirim</a>.</>],
              [<code>to</code>, <Req />, <>Nomor tujuan. Boleh <code>+62…</code>, <code>62…</code>, atau <code>08…</code>; spasi, tanda hubung, dan kurung diabaikan.</>],
              [<code>text</code>, <Req label="salah satu" />, <>1–4096 karakter. Pakai ini <b>atau</b> <code>media_id</code>, tidak keduanya.</>],
              [<code>media_id</code>, <Req label="salah satu" />, <>ID dari unggahan di <a href="#media">kirim media</a>, dengan <code>caption</code> opsional.</>],
              [<code>prioritas</code>, <Opt />, <><code>normal</code> (bawaan) atau <code>tinggi</code>.</>],
              [<code>kedaluwarsa</code>, <Opt />, <>ISO 8601 dengan zona waktu. Pesan yang belum terkirim sampai saat itu menjadi gagal. Untuk <code>kode</code> paling lama 10 menit.</>],
              [<code>ref</code>, <Opt />, <>Rujukan milik aplikasi, maksimal 200 karakter, ikut dikembalikan di status dan webhook. <b>Tanpa data pribadi</b>: bukan nomor, bukan nama.</>],
              [<code>device</code>, <Opt label="jangan dikirim" />, "Kunci API selalu memakai nomornya sendiri; field ini dijawab 400."],
            ]} />
            <Tabs tabs={[
              { label: "curl", code: `curl -s -X POST "$KIRIM/messages" \\
  -H "Authorization: Bearer $KUNCI" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: otp:9f1c2d" \\
  -d '{
    "jenis": "kode",
    "to": "08123456789",
    "text": "Kode masuk Anda: 123456. Berlaku 10 menit.",
    "ref": "otp:9f1c2d"
  }'` },
              { label: "PHP", code: `<?php
$pesan = [
  "jenis" => "kode",
  "to"    => "08123456789",
  "text"  => "Kode masuk Anda: 123456. Berlaku 10 menit.",
  "ref"   => "otp:9f1c2d",
];

$curl = curl_init();
curl_setopt_array($curl, [
  CURLOPT_URL            => getenv("KIRIM_BASE_URL") . "/messages",
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CUSTOMREQUEST  => "POST",
  CURLOPT_POSTFIELDS     => json_encode($pesan),
  CURLOPT_HTTPHEADER     => [
    "Content-Type: application/json",
    "Authorization: Bearer " . getenv("KIRIM_API_KEY"),
    "Idempotency-Key: otp:9f1c2d",
  ],
]);

$response = curl_exec($curl);
$status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
curl_close($curl);
if ($status !== 202) throw new RuntimeException("Kirim menolak: $status $response");
echo $response;` },
              { label: "Node", code: `const res = await fetch(\`\${process.env.KIRIM_BASE_URL}/messages\`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': \`Bearer \${process.env.KIRIM_API_KEY}\`,
    'Idempotency-Key': 'otp:9f1c2d',
  },
  body: JSON.stringify({
    jenis: 'kode',
    to: '08123456789',
    text: 'Kode masuk Anda: 123456. Berlaku 10 menit.',
    ref: 'otp:9f1c2d',
  }),
});

if (res.status !== 202) throw new Error(\`Kirim menolak: \${res.status}\`);
const { id } = await res.json();` },
              { label: "respon", code: `202 Accepted

{
  "id": "4a1f8c20-6b1e-4f2a-9d33-7c0e5b2a1d44",
  "status": "antre"
}` },
            ]} />
            <Note><b>Aturan pengulangan.</b> Ulangi <code>POST</code> hanya bila Anda tidak mendapat <code>202</code> (galat 5xx, timeout, jaringan putus), dengan <code>Idempotency-Key</code> yang sama. Kunci sama dengan isi berbeda dijawab <code>409</code>. Setelah <code>202</code>, kegagalan datang lewat status atau webhook; jangan kirim ulang otomatis.</Note>
          </Endpoint>
        </Section>

        <Section id="media" title="Kirim media">
          <Endpoint method="POST" path="$KIRIM/media">
            <p>Unggah berkas dulu, lalu sebut <code>media_id</code>-nya saat mengirim pesan. Kirim tidak pernah mengambil berkas dari URL luar. Jenis berkas diperiksa dari isinya, bukan dari namanya.</p>
            <Table head={["Ketentuan", "Nilai"]} rows={[
              ["Tipe yang diterima", <><code>application/pdf</code>, <code>image/jpeg</code>, <code>image/png</code></>],
              ["Ukuran maksimum", "5 MiB, satu berkas per unggahan"],
              ["Masa simpan bila tidak dipakai", "24 jam"],
            ]} />
            <Code>{`curl -s -X POST "$KIRIM/media" \\
  -H "Authorization: Bearer $KUNCI" \\
  -F "file=@struk.pdf;type=application/pdf"
# → 201 { "media_id": "7c0e…", "sha256": "…", "ukuran": 48213 }

curl -s -X POST "$KIRIM/messages" \\
  -H "Authorization: Bearer $KUNCI" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: struk:SJ1" \\
  -d '{ "jenis": "notifikasi", "to": "08123456789",
        "media_id": "7c0e…", "caption": "Struk pesanan SJ1", "ref": "struk:SJ1" }'`}</Code>
          </Endpoint>
        </Section>

        <Section id="status" title="Status pesan">
          <Endpoint method="GET" path="$KIRIM/messages/{id}">
            <p>Membaca status satu pesan yang dikirim lewat nomor ini. Pesan nomor lain dijawab <code>404</code>. Status hanya bergerak maju.</p>
            <Code>{`curl -s "$KIRIM/messages/4a1f8c20-6b1e-4f2a-9d33-7c0e5b2a1d44" \\
  -H "Authorization: Bearer $KUNCI"

{
  "id": "4a1f8c20-6b1e-4f2a-9d33-7c0e5b2a1d44",
  "ref": "otp:9f1c2d",
  "status": "terkirim",
  "error_code": null,
  "dry_run": false,
  "updated_at": "2026-11-17T07:00:12.000Z"
}`}</Code>
            <Table head={["Status", "Arti"]} rows={[
              [<code>antre</code>, "Diterima Kirim, menunggu giliran: jam kirim, batas laju, atau nomor sedang terputus"],
              [<code>diserahkan</code>, <>Sudah diserahkan ke WhatsApp. Bila <code>dry_run</code> true, nomor masih memakai mode uji dan tidak ada yang benar-benar terkirim</>],
              [<code>terkirim</code>, "Sampai di HP penerima"],
              [<code>dibaca</code>, "Dibaca penerima"],
              [<code>gagal</code>, <>Tidak terkirim; <code>error_code</code> terisi (lihat <a href="#galat">kode galat</a>)</>],
              [<code>dibatalkan</code>, "Dibatalkan pengelola dari layar Antrean sebelum diserahkan"],
            ]} />
          </Endpoint>
        </Section>

        <Section id="optout" title="Jangan hubungi">
          <Endpoint method="POST" path="$KIRIM/optouts" second={{ method: "DELETE", path: "$KIRIM/optouts" }}>
            <p>Saat seseorang minta berhenti dihubungi, catat lewat endpoint ini. Pesan <code>notifikasi</code> ke nomor itu berhenti; pesan <code>kode</code> tetap lewat karena diminta orang itu sendiri. Keduanya idempoten.</p>
            <Table head={["Parameter", "Wajib", "Keterangan"]} rows={[
              [<code>nomor</code>, <Req />, "Nomor orang yang minta berhenti"],
              [<code>cakupan</code>, <Req />, <><code>consumer</code>: berlaku untuk pesan dari gerbang ini. <code>device</code> (dengan field <code>device</code> berisi kode nomor Anda): berlaku untuk semua pesan otomatis lewat nomor itu.</>],
              [<code>alasan</code>, <Req />, "1–500 karakter, untuk audit"],
            ]} />
            <Code>{`curl -s -X POST "$KIRIM/optouts" \\
  -H "Authorization: Bearer $KUNCI" -H "Content-Type: application/json" \\
  -d '{ "nomor": "08123456789", "cakupan": "consumer", "alasan": "Minta berhenti lewat chat 2026-11-17" }'

curl -s -X DELETE "$KIRIM/optouts" \\
  -H "Authorization: Bearer $KUNCI" -H "Content-Type: application/json" \\
  -d '{ "nomor": "08123456789", "cakupan": "consumer", "alasan": "Minta dihubungi lagi" }'`}</Code>
            <p className="text-xs text-muted-foreground">Opt-out yang dibuat pengelola atau aplikasi lain tidak bisa dicabut lewat sini; jawabannya 404.</p>
          </Endpoint>
        </Section>

        <Section id="webhook" title="Webhook">
          <Endpoint method="PUT" path="$KIRIM/sambungan/webhook">
            <p>Daftarkan alamat Anda sendiri untuk menerima status dan pesan masuk di nomor Anda. Kirim membuat rahasia 32 byte sekali, menyimpannya terenkripsi, dan mengembalikannya di jawaban. Rahasia itu yang dipakai memverifikasi tanda tangan. Alamat boleh <code>https://</code> mana pun, atau <code>http://127.0.0.1:&lt;port&gt;/…</code> bila aplikasi berjalan di host yang sama.</p>
            <Code>{`curl -s -X PUT "$KIRIM/sambungan/webhook" \\
  -H "Authorization: Bearer $KUNCI" -H "Content-Type: application/json" \\
  -d '{ "url": "https://toko.example/api/kirim/webhook" }'
# → { "nomor": { … }, "jenis": [ … ],
#     "webhook": { "url": "https://toko.example/api/kirim/webhook", "secret": "…" } }`}</Code>
            <Table head={["Header tiap event", "Isi"]} rows={[
              [<code>X-Kirim-Event-Id</code>, "ID event, sama di tiap percobaan ulang. Abaikan ID yang sudah Anda proses"],
              [<code>X-Kirim-Timestamp</code>, "Detik Unix saat pengiriman. Tolak bila selisihnya lebih dari 5 menit"],
              [<code>X-Kirim-Signature</code>, <>Hex HMAC-SHA256 dari rahasia atas <code>timestamp + "." + body mentah</code></>],
            ]} />
            <Table head={["Tipe event", "Kapan dikirim"]} rows={[
              [<code>message.status</code>, <>Status pesan Anda berubah. Memuat <code>id</code>, <code>ref</code>, <code>status</code>, <code>error_code</code></>],
              [<code>message.received</code>, "Pesan masuk ke nomor Anda. Memuat pengirim, tipe, dan cuplikan maksimal 200 karakter"],
              [<code>message.sent</code>, "Pesan keluar di nomor Anda yang tidak dibuat lewat API, misalnya diketik langsung dari HP"],
              [<code>device.status</code>, "Nomor tersambung atau terputus. Pakai ini untuk memperingatkan petugas"],
            ]} />
            <p>Jawab <code>2xx</code> secepatnya (timeout 10 detik), lalu proses isinya. Selain <code>2xx</code>, Kirim mengulang dengan jeda 30 detik, 1, 2, 4 menit, dan seterusnya sampai maksimum 1 jam, paling banyak 8 percobaan. Tipe event yang tidak Anda kenal tetap dijawab <code>2xx</code> dan diabaikan.</p>
            <Note>Aplikasi yang hanya mengirim OTP tidak perlu webhook. Cukup baca <a href="#status">status pesan</a> bila ingin tahu hasilnya.</Note>
          </Endpoint>
        </Section>

        <Section id="tandatangan" title="Verifikasi tanda tangan">
          <p>Hitung tanda tangan dari <b>body mentah</b>, jadi baca body sebagai teks sebelum di-parse. Bandingkan dengan perbandingan waktu tetap, bukan dengan <code>==</code>.</p>
          <Tabs tabs={[
            { label: "Node", code: `const crypto = require('node:crypto');

function webhookSah(rahasia, headers, bodyMentah, sekarang = Math.floor(Date.now() / 1000)) {
  const waktu = Number(headers['x-kirim-timestamp']);
  const tanda = String(headers['x-kirim-signature'] || '');
  if (!Number.isInteger(waktu) || Math.abs(sekarang - waktu) > 300) return false;

  const harapan = crypto.createHmac('sha256', rahasia)
    .update(\`\${waktu}.\${bodyMentah}\`, 'utf8')
    .digest('hex');

  if (harapan.length !== tanda.length) return false;
  return crypto.timingSafeEqual(Buffer.from(harapan, 'hex'), Buffer.from(tanda, 'hex'));
}` },
            { label: "PHP", code: `<?php
function webhook_sah(string $rahasia, array $headers, string $bodyMentah): bool {
    $waktu = (int) ($headers['X-Kirim-Timestamp'] ?? 0);
    $tanda = (string) ($headers['X-Kirim-Signature'] ?? '');
    if ($waktu === 0 || abs(time() - $waktu) > 300) {
        return false;
    }
    $harapan = hash_hmac('sha256', $waktu . '.' . $bodyMentah, $rahasia);
    return hash_equals($harapan, $tanda);
}` },
          ]} />
        </Section>

        <Section id="batas" title="Batas dan jam kirim">
          <Table head={["", <code>kode</code>, <code>notifikasi</code>]} rows={[
            ["Untuk apa", "OTP dan kode verifikasi", "Pesan otomatis lain: struk, pengingat, pemberitahuan"],
            ["Jam kirim", "Kapan saja", "06.00–21.00 WIB (bawaan); di luar itu menunggu di antrean"],
            ["Daftar jangan hubungi", "Tidak berlaku", "Dihormati"],
            ["Kedaluwarsa bawaan", "10 menit", "24 jam"],
            ["Penyimpanan isi", "Disamarkan", "Disimpan terenkripsi"],
          ]} />
          <Table head={["Batas", "Nilai"]} rows={[
            ["Kuota harian gerbang (semua aplikasi luar, semua jenis)", "bawaan 500 pesan per hari WIB; diatur pengelola Kirim"],
            ["Laju per nomor", "bawaan 10 pesan per menit, jeda acak 2–6 detik antar kiriman"],
            ["Ulang kirim bila WhatsApp gagal", "1, 5, lalu 30 menit; setelah itu gagal"],
            ["Teks dan ref", "teks 1–4096 karakter, ref ≤ 200 karakter"],
          ]} />
          <p>Saat batas laju tercapai, pesan tetap diterima dan menunggu di antrean, bukan ditolak. Kuota harian yang habis dijawab <code>422 quota_exceeded</code>; simpan permintaan di sisi Anda dan coba lagi setelah pukul 00.00 WIB. Jangan membuat antrean agresif sendiri di aplikasi.</p>
        </Section>

        <Section id="galat" title="Kode galat">
          <Table head={["HTTP", "Kode", "Artinya dan apa yang harus dilakukan"]} rows={[
            ["400", <code>invalid_request</code>, <>Body tidak sesuai skema; <code>fields</code> menyebut field yang salah. Juga bila kunci API mengirim field <code>device</code></>],
            ["400", <code>idempotency_key_required</code>, <>Header <code>Idempotency-Key</code> tidak ada atau bukan 1–200 karakter</>],
            ["401", <code>unauthenticated</code>, "Kunci tidak ada, tidak dikenal, atau sudah dicabut. Periksa header; jangan ulangi otomatis"],
            ["403", <code>consumer_unknown</code>, "Gerbang dinonaktifkan pengelola Kirim. Hubungi pengelola"],
            ["403", <code>api_key_not_allowed</code>, "Endpoint percakapan, grup, dan profil bisnis bukan untuk kunci API"],
            ["403", <code>not_owner</code>, "Jangan hubungi cakupan device menyebut nomor yang bukan milik kunci ini"],
            ["404", <code>not_found</code>, "Pesan atau opt-out tidak ada, atau milik aplikasi lain"],
            ["409", <code>idempotency_key_conflict</code>, "Kunci idempotensi sama dipakai untuk isi berbeda. Pakai kunci baru"],
            ["413", <code>body_too_large</code>, "Body melewati batas rute"],
            ["422", <code>device_not_connected</code>, "Nomor pada kunci belum tersambung. Pengelola perlu memindai QR"],
            ["422", <code>device_inactive</code>, "Nomor dinonaktifkan pengelola"],
            ["422", <code>invalid_number</code>, <><code>to</code> bukan nomor telepon yang sah</>],
            ["422", <code>optout</code>, <>Orang itu minta tidak dihubungi (hanya <code>notifikasi</code>)</>],
            ["422", <code>quota_exceeded</code>, "Kuota harian habis"],
            ["422", <code>media_invalid</code>, <>Bukan PDF/JPEG/PNG, lebih dari 5 MiB, atau <code>media_id</code> bukan milik nomor ini</>],
            ["422", <code>webhook_url_invalid</code>, "Alamat webhook bukan https:// atau loopback, atau membawa kredensial"],
          ]} />
          <p><code>error_code</code> pada status <code>gagal</code> dan webhook <code>message.status</code>: <code>optout</code>, <code>route_denied</code>, <code>quota_exceeded</code>, <code>device_inactive</code>, <code>invalid_number</code>, <code>media_invalid</code>, <code>expired</code> (kedaluwarsa sebelum terkirim, termasuk kode lewat 10 menit), <code>engine_unavailable</code>, <code>engine_rejected</code>, <code>engine_conflict</code>, <code>cancelled</code>.</p>
        </Section>

        <Section id="otp" title="Contoh: kirim OTP dari aplikasi Anda">
          <p>Alur terkecil yang berguna. Simpan kode di sisi Anda, kirim lewat Kirim, dan jangan tunggu status sebelum menjawab pengguna.</p>
          <Code>{`async function kirimOtp(nomor, kode, idPermintaan) {
  const res = await fetch(\`\${process.env.KIRIM_BASE_URL}/messages\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': \`Bearer \${process.env.KIRIM_API_KEY}\`,
      'Idempotency-Key': \`otp:\${idPermintaan}\`,
    },
    body: JSON.stringify({
      jenis: 'kode',
      to: nomor,
      text: \`Kode masuk Anda: \${kode}. Berlaku 10 menit. Jangan berikan kepada siapa pun.\`,
      ref: \`otp:\${idPermintaan}\`,
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (res.status === 202) return (await res.json()).id;

  const { error } = await res.json().catch(() => ({ error: null }));
  if (error?.code === 'device_not_connected') {
    // Nomor sedang terputus: beri tahu petugas, tawarkan cara masuk lain.
    throw new Error('WHATSAPP_PUTUS');
  }
  throw new Error(error?.code ?? \`KIRIM_\${res.status}\`);
}`}</Code>
          <Note>Isi pesan <code>kode</code> sebaiknya menyebut nama layanan, masa berlaku, dan peringatan jangan membagikan kode. Jangan memasukkan nama atau nomor orang ke dalam <code>ref</code>.</Note>
        </Section>

        <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
          Berlaku sejak 17 November 2026 (ADR-0011, amandemen 2026-11-17). Pengelola Kirim: kartu Aplikasi luar di halaman Aplikasi; tiap nomor punya kunci sendiri. Developer SQ Suite: lihat panduan di repositori SQ-Hub, <code>docs/kirim/panduan-api-gateway-aplikasi-luar.md</code>.
        </footer>
      </main>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-32 space-y-3">
      <h2 className="font-display text-xl font-bold tracking-[-0.02em] text-brand-heading">{title}</h2>
      {children}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-surface-raised p-4 shadow-[var(--shadow-soft)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-primary-deep">Langkah {n}</p>
      <h3 className="mt-1 font-display text-base font-bold text-brand-heading">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border-l-4 border-brand-primary bg-brand-primary-pale px-4 py-3 text-sm leading-6 text-brand-primary-deep">{children}</p>;
}

function Req({ label = "wajib" }: { label?: string }) {
  return <span className="font-mono text-[11px] font-bold text-brand-primary-deep">{label}</span>;
}

function Opt({ label = "opsional" }: { label?: string }) {
  return <span className="font-mono text-[11px] text-muted-foreground">{label}</span>;
}

function Chip({ live = false, children }: { live?: boolean; children: ReactNode }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${live ? "bg-success-soft text-success-ink" : "bg-warning-soft text-warning-ink"}`}>{children}</span>;
}

function Table({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border/70 bg-surface-raised">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          <tr>{head.map((cell, index) => <th key={index} className="px-3 py-2 font-bold">{cell}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-border/70 align-top">
              {row.map((cell, index) => <td key={index} className="px-3 py-2 leading-6">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Endpoint({ method, path, second, children }: { method: string; path: string; second?: { method: string; path: string }; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-surface-raised p-4 shadow-[var(--shadow-soft)]">
      <RequestLine method={method} path={path} />
      {second ? <RequestLine method={second.method} path={second.path} /> : null}
      {children}
    </div>
  );
}

function RequestLine({ method, path }: { method: string; path: string }) {
  const tone = method === "GET" ? "bg-muted text-foreground" : method === "DELETE" ? "bg-danger-soft text-danger-ink" : "bg-brand-primary text-brand-foreground";
  return (
    <p className="flex flex-wrap items-center gap-2">
      <span className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${tone}`}>{method}</span>
      <code className="break-all font-mono text-sm">{path}</code>
    </p>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl bg-brand-heading px-4 py-3 font-mono text-[12px] leading-6 text-brand-foreground"><code>{children}</code></pre>;
}

export function Tabs({ tabs }: { tabs: Array<{ label: string; code: string }> }) {
  const [active, setActive] = useState(0);
  const current = tabs[Math.min(active, tabs.length - 1)];
  return (
    <div className="space-y-2">
      <div role="tablist" className="flex flex-wrap gap-1">
        {tabs.map((tab, index) => (
          <button key={tab.label} type="button" role="tab" aria-selected={index === active} onClick={() => setActive(index)}
            className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold ${index === active ? "border-brand-primary bg-brand-primary-pale text-brand-primary-deep" : "border-border bg-surface text-muted-foreground"}`}>
            {tab.label}
          </button>
        ))}
      </div>
      {current ? <Code>{current.code}</Code> : null}
    </div>
  );
}
