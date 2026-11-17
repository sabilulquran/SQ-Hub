import { Plus } from "lucide-react";
import { useState } from "react";

import { DetailDialog } from "@/components/DetailDialog";
import { errorMessage, formatTanggal, sekretariatAdminFetch, STATUS_MAILBOX, type Mailbox, type MailboxDaftar } from "@/sekretariat/api";
import { dangerButton, ErrorNote, Field, Link, PageHeader, Panel, primaryButton, secondaryButton, StateCard, StatusBadge, useLoad } from "@/sekretariat/ui";

const PORT_BAWAAN = "993";

/** The add/edit form. `sandi` is write-only (SEK-IMPL-002 M-3): it starts empty, also when editing. */
interface FormState {
  id: string | null;
  alamat: string;
  host: string;
  port: string;
  pengguna: string;
  /** While false the user field follows the address, which is its default (§4). */
  penggunaDisentuh: boolean;
  sandi: string;
  kotakId: string;
}

function formBaru(kotakId: string): FormState {
  return { id: null, alamat: "", host: "", port: PORT_BAWAAN, pengguna: "", penggunaDisentuh: false, sandi: "", kotakId };
}

function formUbah(mailbox: Mailbox): FormState {
  return {
    id: mailbox.id,
    alamat: mailbox.alamat,
    host: mailbox.host,
    port: String(mailbox.port),
    pengguna: mailbox.pengguna,
    penggunaDisentuh: mailbox.pengguna !== mailbox.alamat,
    sandi: "",
    kotakId: mailbox.kotak_id,
  };
}

function statusTone(status: Mailbox["status"]): "biasa" | "baik" | "bahaya" {
  return status === "aktif" ? "baik" : status === "auth_gagal" ? "bahaya" : "biasa";
}

/**
 * SEK-IMPL-002 §4 Pengaturan › Kotak masuk: the admin connects an existing mailbox by typing its
 * IMAP settings. The server tests the login and only stores the row when it succeeds (M-4), so the
 * only save button is "Uji dan simpan" and it may take a few seconds.
 */
export function MailboxPage() {
  const { state, reload } = useLoad(() => sekretariatAdminFetch<MailboxDaftar>("/mailbox"), "mailbox");
  const [form, setForm] = useState<FormState | null>(null);
  const [hapus, setHapus] = useState<Mailbox | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  if (state.status === "loading") return <StateCard kind="loading" title="Memuat kotak masuk" />;
  if (state.status === "error") {
    return state.code === "sekretariat_admin_required"
      ? <StateCard kind="forbidden" title="Anda belum ditetapkan sebagai pengelola Sekretariat" body="Hubungi Kepala HCM bila Anda seharusnya menyambungkan kotak masuk." />
      : <StateCard kind="error" title="Daftar kotak masuk belum dapat dimuat" body={state.message} />;
  }
  const data = state.data;

  const run = (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    work().then(() => reload()).catch((failure) => setError(errorMessage(failure))).finally(() => setBusy(false));
  };

  const simpan = (nilai: FormState) => {
    setBusy(true);
    setFormError(null);
    const body = {
      alamat: nilai.alamat.trim(),
      host: nilai.host.trim(),
      port: Number(nilai.port),
      pengguna: (nilai.penggunaDisentuh ? nilai.pengguna : nilai.alamat).trim(),
      kotak_id: nilai.kotakId,
      ...(nilai.sandi ? { sandi: nilai.sandi } : {}),
    };
    const kirim = nilai.id
      ? sekretariatAdminFetch<Mailbox>(`/mailbox/${nilai.id}`, { method: "PUT", body })
      : sekretariatAdminFetch<Mailbox>("/mailbox", { method: "POST", body });
    kirim
      .then(() => {
        setForm(null);
        return reload();
      })
      // The typed values stay on screen: a rejected password or an unreachable host is worth another try.
      .catch((failure) => setFormError(errorMessage(failure, "Sambungan ke mailbox gagal. Periksa isian lalu coba lagi.")))
      .finally(() => setBusy(false));
  };

  const bisaTambah = data.tersedia && data.kotak.length > 0;
  const tombolTambah = (
    <button type="button" className={primaryButton} disabled={!bisaTambah || busy} onClick={() => { setFormError(null); setForm(formBaru(data.kotak[0]?.id ?? "")); }}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      Tambah kotak masuk
    </button>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Kotak masuk" eyebrow="Pengaturan Sekretariat" actions={bisaTambah ? tombolTambah : null}>
        <p className="mt-1 text-sm text-muted-foreground">
          Sambungkan alamat email yang sudah ada agar suratnya tercatat otomatis. Modul hanya membaca; email di penyedia tidak pernah dihapus atau dipindahkan.
        </p>
      </PageHeader>
      <ErrorNote message={error} />

      {!data.tersedia ? (
        <Panel>
          <h2 className="font-display text-base font-bold text-brand-heading">Kunci penyimpanan belum disiapkan</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Sandi mailbox hanya boleh tersimpan dalam keadaan terenkripsi, dan kunci enkripsinya belum dipasang di server. Formulir ini tertutup sampai kunci itu dipasang. Mintakan pemasangannya kepada pengelola server, lalu buka layar ini lagi.
          </p>
        </Panel>
      ) : null}

      {data.tersedia && data.kotak.length === 0 ? (
        <Panel>
          <h2 className="font-display text-base font-bold text-brand-heading">Belum ada kotak tujuan</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Setiap mailbox menaruh suratnya ke satu kotak di Sekretariat, dan belum ada kotak yang dapat dipilih. Siapkan penerbit dan petugasnya dulu di Pengaturan.
          </p>
          <Link href="/pengaturan" className={`${secondaryButton} mt-3`}>Ke Pengaturan</Link>
        </Panel>
      ) : null}

      {data.mailbox.length === 0 ? (
        data.tersedia && data.kotak.length > 0 ? (
          <StateCard
            kind="empty"
            title="Belum ada kotak masuk tersambung"
            body="Surat email baru tercatat setelah satu alamat tersambung. Siapkan alamat, host, dan sandinya, lalu modul menguji loginnya sebelum menyimpan."
            action={tombolTambah}
          />
        ) : null
      ) : (
        <ul className="space-y-3">
          {data.mailbox.map((mailbox) => (
            <li key={mailbox.id}>
              <Panel>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate font-display text-base font-bold text-brand-heading">{mailbox.alamat}</h2>
                      <StatusBadge label={STATUS_MAILBOX[mailbox.status]} tone={statusTone(mailbox.status)} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Masuk ke {mailbox.kotak_nama} · {mailbox.host}:{mailbox.port} · pengguna {mailbox.pengguna}
                    </p>
                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">Tarikan terakhir</dt>
                        <dd className="font-semibold">{formatTanggal(mailbox.tarik_terakhir_pada)}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-muted-foreground">Surat tercatat</dt>
                        <dd className="font-semibold">{mailbox.surat_masuk}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <button type="button" className={secondaryButton} disabled={busy} onClick={() => { setFormError(null); setForm(formUbah(mailbox)); }}>
                      {mailbox.status === "auth_gagal" ? "Perbarui sandi" : "Ubah"}
                    </button>
                    {mailbox.status === "nonaktif" ? (
                      <button type="button" className={secondaryButton} disabled={busy} onClick={() => run(() => sekretariatAdminFetch(`/mailbox/${mailbox.id}/status`, { method: "POST", body: { status: "aktif" } }))}>
                        Aktifkan
                      </button>
                    ) : (
                      <button type="button" className={secondaryButton} disabled={busy} onClick={() => run(() => sekretariatAdminFetch(`/mailbox/${mailbox.id}/status`, { method: "POST", body: { status: "nonaktif" } }))}>
                        Nonaktifkan
                      </button>
                    )}
                    <button type="button" className={dangerButton} disabled={busy} onClick={() => { setError(null); setHapus(mailbox); }}>Hapus</button>
                  </div>
                </div>
                {mailbox.status === "auth_gagal" ? (
                  <p className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-sm leading-6 text-warning-ink">
                    Sandi ditolak {mailbox.gagal_berturut} kali berturut-turut, jadi penarikan dihentikan dulu agar mailbox tidak dikunci penyedia. Simpan kembali alamat ini dengan sandi yang benar, dan penarikan langsung berjalan lagi.
                  </p>
                ) : null}
                {mailbox.galat_terakhir ? (
                  <p className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-sm leading-6 text-danger-ink">
                    Galat terakhir {formatTanggal(mailbox.galat_pada)}: {mailbox.galat_terakhir}
                  </p>
                ) : null}
              </Panel>
            </li>
          ))}
        </ul>
      )}

      <Panel>
        <h2 className="font-display text-base font-bold text-brand-heading">Siapa yang membaca</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Surat dari mailbox ini dibaca oleh petugas kotak tujuannya dan pemegang disposisi. Keduanya diatur di Pengaturan, bukan di layar ini.
        </p>
        <Link href="/pengaturan" className={`${secondaryButton} mt-3`}>Atur petugas dan pemegang disposisi</Link>
      </Panel>

      {form ? (
        <MailboxDialog
          form={form}
          kotak={data.kotak}
          busy={busy}
          error={formError}
          onChange={setForm}
          onSimpan={() => simpan(form)}
          onClose={() => { if (!busy) setForm(null); }}
        />
      ) : null}

      {hapus ? (
        <DetailDialog title={`Hapus ${hapus.alamat}?`} onClose={() => { if (!busy) setHapus(null); }}>
          <p className="text-sm leading-6 text-muted-foreground">
            Penarikan untuk alamat ini berhenti dan sandinya dihapus dari penyimpanan. Surat yang sudah tercatat tetap ada di kotak masuk, karena surat yang sudah masuk adalah catatan tersendiri.
          </p>
          <ErrorNote message={error} />
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => setHapus(null)}>Batal</button>
            <button
              type="button"
              className={dangerButton}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                sekretariatAdminFetch(`/mailbox/${hapus.id}`, { method: "DELETE" })
                  .then(() => {
                    setHapus(null);
                    return reload();
                  })
                  .catch((failure) => setError(errorMessage(failure)))
                  .finally(() => setBusy(false));
              }}
            >
              Hapus kotak masuk
            </button>
          </div>
        </DetailDialog>
      ) : null}
    </div>
  );
}

/** Pop-up, never a side panel: the page behind it keeps its layout (aturan SQ Suite 2026-11-13). */
function MailboxDialog({ form, kotak, busy, error, onChange, onSimpan, onClose }: {
  form: FormState;
  kotak: Array<{ id: string; nama: string }>;
  busy: boolean;
  error: string | null;
  onChange: (value: FormState) => void;
  onSimpan: () => void;
  onClose: () => void;
}) {
  const ubah = form.id !== null;
  const pengguna = form.penggunaDisentuh ? form.pengguna : form.alamat;
  const lengkap = form.alamat.trim() !== "" && form.host.trim() !== "" && form.port !== "" && form.kotakId !== "" && (ubah || form.sandi !== "");
  return (
    <DetailDialog
      title={ubah ? "Ubah kotak masuk" : "Tambah kotak masuk"}
      description="Alamat email yang sudah ada, bukan alamat baru. Modul mencoba masuk ke mailbox sebelum menyimpan."
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && lengkap) onSimpan();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Alamat email" helper="Alamat yang suratnya ditarik, misalnya sekretariat@sabilulquran.or.id">
            <input
              className="sq-admin-input"
              type="email"
              autoComplete="off"
              value={form.alamat}
              onChange={(event) => onChange({ ...form, alamat: event.target.value.trim() })}
            />
          </Field>
          <Field label="Kotak tujuan" helper="Surat dari mailbox ini masuk ke kotak tersebut">
            <select className="sq-admin-input" value={form.kotakId} onChange={(event) => onChange({ ...form, kotakId: event.target.value })}>
              <option value="">— pilih —</option>
              {kotak.map((item) => <option key={item.id} value={item.id}>{item.nama}</option>)}
            </select>
          </Field>
          <Field label="Host IMAP" helper="Nama server penyedia email, misalnya mail.sabilulquran.or.id">
            <input className="sq-admin-input" autoComplete="off" value={form.host} onChange={(event) => onChange({ ...form, host: event.target.value.trim() })} />
          </Field>
          <Field label="Port" helper="993 terenkripsi sejak awal. 143 hanya bila penyedia menuntutnya; sambungannya tetap wajib naik ke terenkripsi.">
            <select className="sq-admin-input" value={form.port} onChange={(event) => onChange({ ...form, port: event.target.value })}>
              <option value="993">993</option>
              <option value="143">143</option>
            </select>
          </Field>
          <Field label="Pengguna" helper="Bawaannya sama dengan alamat; ubah hanya bila penyedia memakai nama lain">
            <input
              className="sq-admin-input"
              autoComplete="off"
              value={pengguna}
              onChange={(event) => onChange({ ...form, pengguna: event.target.value.trim(), penggunaDisentuh: true })}
            />
          </Field>
          <Field
            label="Sandi mailbox"
            helper={ubah ? "Biarkan kosong untuk tetap memakai sandi yang tersimpan." : "Sandi tersimpan terenkripsi dan tidak pernah ditampilkan lagi."}
          >
            <input
              className="sq-admin-input"
              type="password"
              autoComplete="new-password"
              value={form.sandi}
              onChange={(event) => onChange({ ...form, sandi: event.target.value })}
            />
          </Field>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Menyimpan berarti modul menyambung ke mailbox dan masuk dengan isian ini. Bila loginnya ditolak, tidak ada yang tersimpan dan sebabnya ditampilkan di sini. Prosesnya bisa memakan beberapa detik.
        </p>
        <ErrorNote message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={secondaryButton} disabled={busy} onClick={onClose}>Batal</button>
          <button type="submit" className={primaryButton} disabled={busy || !lengkap}>
            {busy ? "Menguji sambungan…" : "Uji dan simpan"}
          </button>
        </div>
      </form>
    </DetailDialog>
  );
}
