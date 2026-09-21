import {
  AppWindow,
  BadgeCheck,
  ChevronRight,
  KeyRound,
  Laptop,
  Link2,
  LogOut,
  Mail,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Unlink,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { GlobalHeader } from "@/components/GlobalHeader";
import { MobileNavigation } from "@/components/MobileNavigation";
import type {
  AccountCredentialType,
  AccountDevice,
  AccountIdentityApplication,
  AccountLinkedIdentity,
  AccountProfileField,
  AccountSnapshot,
  WorkspaceSnapshot,
} from "@/types";

type AccountSection =
  | "profile"
  | "security"
  | "sessions"
  | "applications"
  | "linked"
  | "groups";

interface AccountPageProps {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  previewAccount?: AccountSnapshot;
  previewSection?: AccountSection;
}

type AccountState =
  | { status: "loading" }
  | { status: "ready"; account: AccountSnapshot }
  | { status: "error"; message: string };

type MutationState =
  | { status: "idle" }
  | { status: "working"; label: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function sectionFromLocation(): AccountSection {
  if (typeof window === "undefined") return "profile";
  const section = new URLSearchParams(window.location.search).get("section");
  if (
    section === "security" ||
    section === "sessions" ||
    section === "applications" ||
    section === "linked" ||
    section === "groups"
  ) {
    return section;
  }
  return "profile";
}

function friendlyProfileLabel(field: AccountProfileField): string {
  const mapping: Record<string, string> = {
    username: "NIP / ID masuk",
    email: "Email",
    firstName: "Nama depan",
    lastName: "Nama belakang",
    locale: "Bahasa",
  };
  if (mapping[field.name]) return mapping[field.name]!;
  const raw = field.label.replace(/^\$\{(.+)\}$/, "$1");
  return mapping[raw] ?? raw.replace(/[_-]+/g, " ");
}

function credentialLabel(item: AccountCredentialType): string {
  const type = item.type.toLowerCase();
  if (type === "password") return "Kata sandi";
  if (type === "otp" || type.includes("totp")) return "Verifikasi dua langkah";
  if (type.includes("recovery")) return "Kode pemulihan";
  if (type.includes("webauthn") || type.includes("passkey")) return "Passkey";
  return item.label.replace(/^\$\{(.+)\}$/, "$1");
}

function credentialDescription(item: AccountCredentialType): string {
  const type = item.type.toLowerCase();
  if (type === "password") {
    return "Perbarui kata sandi yang digunakan untuk masuk ke Akun SQ.";
  }
  if (type === "otp" || type.includes("totp")) {
    return "Kelola aplikasi authenticator untuk verifikasi dua langkah.";
  }
  if (type.includes("recovery")) {
    return "Kelola kode cadangan untuk memulihkan akses saat authenticator tidak tersedia.";
  }
  if (type.includes("webauthn") || type.includes("passkey")) {
    return "Kelola passkey atau kunci keamanan yang terdaftar pada akun.";
  }
  return item.helpText && !item.helpText.includes("${")
    ? item.helpText
    : "Kelola metode keamanan yang tersedia untuk akun ini.";
}

function formatDate(value: number | null): string {
  if (!value) return "Belum tersedia";
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return "Belum tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function managementNeedsReauth(account: AccountSnapshot): boolean {
  return !account.management.available && account.management.reauthRequired;
}

export function AccountPage({
  workspace,
  onLogout,
  previewAccount,
  previewSection,
}: AccountPageProps) {
  const [section, setSection] = useState<AccountSection>(
    previewSection ?? sectionFromLocation(),
  );
  const [state, setState] = useState<AccountState>(
    previewAccount
      ? { status: "ready", account: previewAccount }
      : { status: "loading" },
  );
  const [mutation, setMutation] = useState<MutationState>({ status: "idle" });

  const loadAccount = useCallback(async (quiet = false) => {
    if (previewAccount) return;
    if (!quiet) setState({ status: "loading" });
    try {
      const response = await fetch("/api/account", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        window.location.assign("/api/auth/oidc/start?returnTo=account");
        return;
      }
      if (!response.ok) {
        throw new Error(`account request failed: ${response.status}`);
      }
      setState({
        status: "ready",
        account: (await response.json()) as AccountSnapshot,
      });
    } catch {
      setState({
        status: "error",
        message: "Akun SQ belum dapat memuat informasi akun Anda. Silakan coba lagi.",
      });
    }
  }, [previewAccount]);

  useEffect(() => {
    if (!previewAccount) void loadAccount();
  }, [loadAccount, previewAccount]);

  const changeSection = (next: AccountSection) => {
    setSection(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "profile") url.searchParams.delete("section");
      else url.searchParams.set("section", next);
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  };

  const mutate = useCallback(
    async (
      label: string,
      input: { url: string; method?: string; body?: unknown; redirect?: boolean },
    ) => {
      if (previewAccount) return;
      setMutation({ status: "working", label });
      try {
        const response = await fetch(input.url, {
          method: input.method ?? "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            ...(input.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          authorizationUrl?: string;
        };
        if (response.status === 401) {
          window.location.assign("/api/auth/oidc/start?returnTo=account");
          return;
        }
        if (response.status === 428 || body.error === "ACCOUNT_REAUTH_REQUIRED") {
          window.location.assign("/api/auth/oidc/start?returnTo=account");
          return;
        }
        if (!response.ok) {
          throw new Error(body.error ?? "ACCOUNT_ACTION_FAILED");
        }
        if (input.redirect && body.authorizationUrl) {
          window.location.assign(body.authorizationUrl);
          return;
        }
        setMutation({ status: "success", message: "Perubahan berhasil disimpan." });
        await loadAccount(true);
      } catch {
        setMutation({
          status: "error",
          message: "Perubahan belum dapat diproses. Silakan coba lagi.",
        });
      }
    },
    [loadAccount, previewAccount],
  );

  return (
    <div className="min-h-screen bg-surface text-foreground">
      <GlobalHeader workspace={workspace} onLogout={onLogout} />
      <main className="mx-auto w-full max-w-7xl px-4 pb-32 pt-8 sm:px-6 sm:pt-10 lg:px-8 lg:pb-14">
        <header className="mb-6 sm:mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-primary-deep">
            Akun SQ
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.035em] text-brand-heading sm:text-4xl">
            Akun Anda
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Kelola profil, keamanan, sesi, aplikasi, dan akun terhubung dalam satu tempat.
          </p>
        </header>

        {state.status === "loading" ? <AccountLoading /> : null}
        {state.status === "error" ? (
          <AccountError message={state.message} onRetry={() => loadAccount()} />
        ) : null}
        {state.status === "ready" ? (
          <AccountContent
            account={state.account}
            section={section}
            onSectionChange={changeSection}
            mutation={mutation}
            onMutate={mutate}
          />
        ) : null}
      </main>
      <MobileNavigation
        active="account"
        platformAdministration={workspace.capabilities.platformAdministration}
      />
    </div>
  );
}

function AccountLoading() {
  return (
    <section className="rounded-2xl border border-border/80 bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
      <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Memuat informasi Akun SQ...
      </div>
    </section>
  );
}

function AccountError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void | Promise<void>;
}) {
  return (
    <section className="rounded-2xl border border-border/80 bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
      <h2 className="font-display text-xl font-bold text-brand-heading">Akun belum dapat dimuat</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>
      <button type="button" onClick={() => void onRetry()} className={primaryButtonClass}>
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Coba lagi
      </button>
    </section>
  );
}

function AccountContent({
  account,
  section,
  onSectionChange,
  mutation,
  onMutate,
}: {
  account: AccountSnapshot;
  section: AccountSection;
  onSectionChange: (section: AccountSection) => void;
  mutation: MutationState;
  onMutate: (
    label: string,
    input: { url: string; method?: string; body?: unknown; redirect?: boolean },
  ) => void | Promise<void>;
}) {
  const items = [
    { key: "profile" as const, label: "Profil Saya", icon: UserRound },
    { key: "security" as const, label: "Keamanan", icon: ShieldCheck },
    { key: "sessions" as const, label: "Sesi & Perangkat", icon: Smartphone },
    { key: "applications" as const, label: "Aplikasi", icon: AppWindow },
    { key: "linked" as const, label: "Akun Terhubung", icon: Link2 },
    ...(account.management.groups.length > 0
      ? [{ key: "groups" as const, label: "Keanggotaan", icon: UsersRound }]
      : []),
  ];

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-7">
      <nav
        aria-label="Navigasi Akun SQ"
        className="min-w-0 lg:sticky lg:top-24 lg:self-start"
      >
        <div className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0 lg:pb-0">
          {items.map((item) => {
            const Icon = item.icon;
            const active = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSectionChange(item.key)}
                className={[
                  "inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex lg:w-full",
                  active
                    ? "bg-brand-primary-pale text-brand-primary-deep"
                    : "bg-white text-muted-foreground hover:bg-muted hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0">
        {managementNeedsReauth(account) ? <ReauthBanner /> : null}
        {!account.management.available && !account.management.reauthRequired ? (
          <UnavailableBanner />
        ) : null}
        {mutation.status === "working" ? (
          <Notice>{mutation.label} sedang diproses...</Notice>
        ) : null}
        {mutation.status === "success" ? <Notice positive>{mutation.message}</Notice> : null}
        {mutation.status === "error" ? <Notice>{mutation.message}</Notice> : null}

        {section === "profile" ? (
          <ProfileSection account={account} onMutate={onMutate} />
        ) : null}
        {section === "security" ? (
          <SecuritySection account={account} onMutate={onMutate} />
        ) : null}
        {section === "sessions" ? (
          <SessionsSection account={account} onMutate={onMutate} />
        ) : null}
        {section === "applications" ? (
          <ApplicationsSection account={account} onMutate={onMutate} />
        ) : null}
        {section === "linked" ? (
          <LinkedAccountsSection account={account} onMutate={onMutate} />
        ) : null}
        {section === "groups" ? <GroupsSection account={account} /> : null}
      </div>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof UserRound;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/80 bg-white shadow-[var(--shadow-soft)]">
      <header className="flex items-start gap-3 border-b border-border/70 px-5 py-5 sm:px-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold text-brand-heading">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function ProfileSection({
  account,
  onMutate,
}: {
  account: AccountSnapshot;
  onMutate: AccountContentProps["onMutate"];
}) {
  const fields = account.profile.fields;
  const editable = fields.filter((field) => !field.readOnly);
  const initial = useMemo(
    () => Object.fromEntries(fields.map((field) => [field.name, field.values.join("\n")])),
    [fields],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);

  useEffect(() => setValues(initial), [initial]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const payload = Object.fromEntries(
      editable.map((field) => [
        field.name,
        field.multivalued
          ? (values[field.name] ?? "").split("\n").map((value) => value.trim()).filter(Boolean)
          : [(values[field.name] ?? "").trim()],
      ]),
    );
    void onMutate("Menyimpan profil", {
      url: "/api/account/profile",
      body: { fields: payload },
    });
  };

  if (fields.length === 0) {
    return (
      <SectionCard
        icon={UserRound}
        title="Profil Saya"
        description="Informasi dasar yang digunakan untuk mengenali akun Anda."
      >
        <dl className="divide-y divide-border/70">
          <ProfileRow label="Nama" value={account.profile.displayName} />
          <ProfileRow label="NIP / ID masuk" value={account.profile.username} />
          <ProfileRow label="Email" value={account.profile.email} />
        </dl>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      icon={UserRound}
      title="Profil Saya"
      description="Tinjau dan perbarui informasi akun yang memang boleh Anda ubah."
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.name} className="min-w-0">
              <span className="mb-1.5 flex items-center gap-1 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {friendlyProfileLabel(field)}
                {field.required ? <span aria-label="wajib">*</span> : null}
              </span>
              {field.multivalued ? (
                <textarea
                  rows={3}
                  readOnly={field.readOnly}
                  value={values[field.name] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                  className={inputClass(field.readOnly)}
                />
              ) : (
                <input
                  type={field.name === "email" ? "email" : "text"}
                  readOnly={field.readOnly}
                  value={values[field.name] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.value }))
                  }
                  className={inputClass(field.readOnly)}
                />
              )}
              {field.readOnly ? (
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  Dikelola oleh sistem.
                </span>
              ) : null}
            </label>
          ))}
        </div>
        {editable.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButtonClass}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Simpan perubahan
            </button>
            <button
              type="button"
              onClick={() => setValues(initial)}
              className={secondaryButtonClass}
            >
              Batal
            </button>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}

function SecuritySection({
  account,
  onMutate,
}: {
  account: AccountSnapshot;
  onMutate: AccountContentProps["onMutate"];
}) {
  const credentials = account.management.credentials;
  return (
    <SectionCard
      icon={ShieldCheck}
      title="Keamanan"
      description="Kelola cara masuk, verifikasi dua langkah, dan metode pemulihan akun."
    >
      {credentials.length === 0 ? (
        <FallbackSecurity account={account} />
      ) : (
        <div className="space-y-4">
          {credentials.map((container) => (
            <div key={container.type} className="rounded-xl border border-border/70 p-4">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  {container.type === "password" ? (
                    <KeyRound className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-foreground">
                    {credentialLabel(container)}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {credentialDescription(container)}
                  </p>
                  {container.credentials.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {container.credentials.map((credential) => (
                        <div
                          key={credential.id}
                          className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted/70 px-3 py-2.5 sm:flex-row sm:items-center"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold">
                              {credential.label || "Sudah dikonfigurasi"}
                            </p>
                            {credential.createdAt ? (
                              <p className="mt-0.5 text-[11px] text-muted-foreground">
                                Dibuat {formatDate(credential.createdAt)}
                              </p>
                            ) : null}
                          </div>
                          {container.removeable ? (
                            <button
                              type="button"
                              onClick={() =>
                                void onMutate("Membuka konfirmasi penghapusan", {
                                  url: `/api/account/credentials/${encodeURIComponent(credential.id)}/delete`,
                                  body: {},
                                  redirect: true,
                                })
                              }
                              className={dangerButtonClass}
                            >
                              Hapus
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs font-semibold text-muted-foreground">
                      Belum dikonfigurasi.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {container.createAction ? (
                    <button
                      type="button"
                      onClick={() =>
                        void onMutate("Membuka pengaturan keamanan", {
                          url: `/api/account/credentials/${encodeURIComponent(container.type)}/create`,
                          body: {},
                          redirect: true,
                        })
                      }
                      className={secondaryButtonClass}
                    >
                      Tambah
                    </button>
                  ) : null}
                  {container.updateAction ? (
                    <button
                      type="button"
                      onClick={() =>
                        void onMutate("Membuka pengaturan keamanan", {
                          url: `/api/account/credentials/${encodeURIComponent(container.type)}/update`,
                          body: {},
                          redirect: true,
                        })
                      }
                      className={secondaryButtonClass}
                    >
                      Kelola
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function FallbackSecurity({ account }: { account: AccountSnapshot }) {
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
        Detail metode keamanan belum tersedia pada sesi ini. Masuk ulang melalui Akun SQ untuk
        membuka pengelolaan lengkap.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <a href="/api/auth/oidc/action/password" className={secondaryButtonClass}>
          Ganti kata sandi
        </a>
        <a href="/api/auth/oidc/action/totp" className={secondaryButtonClass}>
          {account.security.totpConfigured ? "Kelola OTP" : "Aktifkan OTP"}
        </a>
        <a href="/api/auth/oidc/action/recovery-codes" className={secondaryButtonClass}>
          Kelola kode pemulihan
        </a>
      </div>
    </div>
  );
}

function SessionsSection({
  account,
  onMutate,
}: {
  account: AccountSnapshot;
  onMutate: AccountContentProps["onMutate"];
}) {
  const devices = account.management.devices;
  return (
    <SectionCard
      icon={Smartphone}
      title="Sesi & Perangkat"
      description="Tinjau perangkat yang sedang menggunakan Akun SQ dan akhiri sesi yang tidak dikenali."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-5 text-muted-foreground">
          Sesi saat ini ditandai agar tidak terputus tanpa sengaja.
        </p>
        {devices.some((device) => device.sessions.some((session) => !session.current)) ? (
          <button
            type="button"
            onClick={() =>
              void onMutate("Mengakhiri sesi lain", {
                url: "/api/account/sessions",
                method: "DELETE",
              })
            }
            className={dangerButtonClass}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Keluar dari semua sesi lain
          </button>
        ) : null}
      </div>
      {devices.length > 0 ? (
        <div className="mt-4 space-y-3">
          {devices.map((device, index) => (
            <DeviceCard
              key={device.id || `${device.os}-${index}`}
              device={device}
              onMutate={onMutate}
            />
          ))}
        </div>
      ) : (
        <EmptyState>Tidak ada detail sesi lain yang dapat ditampilkan.</EmptyState>
      )}
    </SectionCard>
  );
}

function DeviceCard({
  device,
  onMutate,
}: {
  device: AccountDevice;
  onMutate: AccountContentProps["onMutate"];
}) {
  return (
    <div className="rounded-xl border border-border/70 p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {device.mobile ? (
            <Smartphone className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Laptop className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">
              {device.device || device.os || "Perangkat"}
            </h3>
            {device.current ? (
              <span className="rounded-full bg-brand-primary-pale px-2 py-1 text-[11px] font-bold text-brand-primary-deep">
                Perangkat saat ini
              </span>
            ) : null}
          </div>
          <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
            {[device.browser, device.os, device.osVersion].filter(Boolean).join(" · ") ||
              "Detail perangkat tidak tersedia"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Aktivitas terakhir: {formatDate(device.lastAccessAt)}
          </p>
        </div>
      </div>
      <div className="mt-3 divide-y divide-border/70 rounded-lg bg-muted/50 px-3">
        {device.sessions.map((session) => (
          <div
            key={session.id}
            className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold">
                {session.browser || "Sesi browser"}
                {session.current ? " · sesi saat ini" : ""}
              </p>
              <p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">
                {session.clients.length > 0
                  ? `Digunakan oleh: ${session.clients.join(", ")}`
                  : "Tidak ada detail aplikasi."}
              </p>
            </div>
            {!session.current ? (
              <button
                type="button"
                onClick={() =>
                  void onMutate("Mengakhiri sesi", {
                    url: `/api/account/sessions/${encodeURIComponent(session.id)}`,
                    method: "DELETE",
                  })
                }
                className={dangerButtonClass}
              >
                Keluar
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ApplicationsSection({
  account,
  onMutate,
}: {
  account: AccountSnapshot;
  onMutate: AccountContentProps["onMutate"];
}) {
  return (
    <div className="space-y-5">
      <SectionCard
        icon={AppWindow}
        title="Aplikasi SQ yang dapat Anda buka"
        description="Akses aplikasi yang diberikan melalui SQ Hub."
      >
        <div className="space-y-2">
          {account.applications.length > 0 ? (
            account.applications.map((application) => (
              <a
                key={application.key}
                href={application.canonicalUrl}
                className="flex min-h-12 min-w-0 items-center gap-3 rounded-xl border border-border/70 px-3.5 py-3 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{application.name}</span>
                  {application.description ? (
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      {application.description}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            ))
          ) : (
            <EmptyState>Belum ada aplikasi yang diberikan untuk akun ini.</EmptyState>
          )}
        </div>
      </SectionCard>

      <SectionCard
        icon={Link2}
        title="Aplikasi yang terhubung ke Akun SQ"
        description="Aplikasi yang pernah menggunakan identitas Akun SQ atau memiliki persetujuan akses."
      >
        {account.management.applications.length > 0 ? (
          <div className="space-y-3">
            {account.management.applications.map((application) => (
              <IdentityApplicationCard
                key={application.clientId}
                application={application}
                onMutate={onMutate}
              />
            ))}
          </div>
        ) : (
          <EmptyState>Belum ada detail aplikasi identitas yang dapat ditampilkan.</EmptyState>
        )}
      </SectionCard>
    </div>
  );
}

function IdentityApplicationCard({
  application,
  onMutate,
}: {
  application: AccountIdentityApplication;
  onMutate: AccountContentProps["onMutate"];
}) {
  return (
    <div className="rounded-xl border border-border/70 p-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">{application.name}</h3>
            <span className={[
              "rounded-full px-2 py-1 text-[11px] font-bold",
              application.inUse
                ? "bg-brand-primary-pale text-brand-primary-deep"
                : "bg-muted text-muted-foreground",
            ].join(" ")}>
              {application.inUse ? "Sedang digunakan" : "Tidak aktif"}
            </span>
          </div>
          {application.description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {application.description}
            </p>
          ) : null}
          {application.consent?.scopes.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {application.consent.scopes.map((scope) => (
                <span
                  key={scope.id}
                  className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground"
                >
                  {scope.label || scope.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {application.consent || application.offlineAccess ? (
          <button
            type="button"
            onClick={() =>
              void onMutate("Mencabut persetujuan aplikasi", {
                url: `/api/account/applications/${encodeURIComponent(application.clientId)}/consent`,
                method: "DELETE",
              })
            }
            className={dangerButtonClass}
          >
            Cabut akses
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LinkedAccountsSection({
  account,
  onMutate,
}: {
  account: AccountSnapshot;
  onMutate: AccountContentProps["onMutate"];
}) {
  return (
    <SectionCard
      icon={Link2}
      title="Akun Terhubung"
      description="Hubungkan atau putuskan akun eksternal yang dapat digunakan untuk masuk ke Akun SQ."
    >
      {account.management.linkedAccounts.length > 0 ? (
        <div className="space-y-3">
          {account.management.linkedAccounts.map((linked) => (
            <LinkedRow
              key={linked.providerAlias}
              account={linked}
              action={
                <button
                  type="button"
                  onClick={() =>
                    void onMutate("Memutus akun terhubung", {
                      url: `/api/account/linked-accounts/${encodeURIComponent(linked.providerAlias)}`,
                      method: "DELETE",
                    })
                  }
                  className={dangerButtonClass}
                >
                  <Unlink className="h-4 w-4" aria-hidden="true" />
                  Putuskan
                </button>
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState>Belum ada akun eksternal yang terhubung.</EmptyState>
      )}

      {account.management.availableAccountLinks.length > 0 ? (
        <div className="mt-6 border-t border-border/70 pt-5">
          <h3 className="text-sm font-bold">Tersedia untuk dihubungkan</h3>
          <div className="mt-3 space-y-3">
            {account.management.availableAccountLinks.map((available) => (
              <LinkedRow
                key={available.providerAlias}
                account={available}
                action={
                  <button
                    type="button"
                    onClick={() =>
                      void onMutate("Membuka proses penghubungan akun", {
                        url: `/api/account/linked-accounts/${encodeURIComponent(available.providerAlias)}/link`,
                        body: {},
                        redirect: true,
                      })
                    }
                    className={secondaryButtonClass}
                  >
                    <Link2 className="h-4 w-4" aria-hidden="true" />
                    Hubungkan
                  </button>
                }
              />
            ))}
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}

function LinkedRow({
  account,
  action,
}: {
  account: AccountLinkedIdentity;
  action: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold">{account.displayName}</h3>
        <p className="mt-1 break-all text-xs text-muted-foreground">
          {account.linkedUsername || (account.connected ? "Terhubung" : "Belum terhubung")}
        </p>
      </div>
      {action}
    </div>
  );
}

function GroupsSection({ account }: { account: AccountSnapshot }) {
  return (
    <SectionCard
      icon={UsersRound}
      title="Keanggotaan"
      description="Kelompok identitas yang tercatat pada Akun SQ."
    >
      <div className="space-y-2">
        {account.management.groups.map((group) => (
          <div key={group.path} className="rounded-xl border border-border/70 px-4 py-3">
            <p className="text-sm font-bold">{group.name}</p>
            <p className="mt-1 break-all text-xs text-muted-foreground">{group.path}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function ReauthBanner() {
  return (
    <div className="mb-5 rounded-2xl border border-brand-primary/20 bg-brand-primary-pale p-4">
      <p className="text-sm font-bold text-brand-primary-deep">Kelola akun perlu masuk ulang sekali</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Sesi Anda dibuat sebelum fitur pengelolaan Akun SQ lengkap tersedia. Masuk ulang untuk
        mengaktifkan pengelolaan profil, sesi, aplikasi, dan akun terhubung.
      </p>
      <a href="/api/auth/oidc/start?returnTo=account" className={primaryButtonClass}>
        Masuk ulang untuk kelola akun
      </a>
    </div>
  );
}

function UnavailableBanner() {
  return (
    <div className="mb-5 rounded-2xl border border-border/70 bg-muted p-4">
      <p className="text-sm font-bold">Pengelolaan lengkap belum dapat dihubungi</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Informasi dasar tetap ditampilkan. Tindakan yang memerlukan layanan identitas akan tersedia
        lagi setelah koneksi pulih.
      </p>
    </div>
  );
}

function Notice({
  children,
  positive = false,
}: {
  children: ReactNode;
  positive?: boolean;
}) {
  return (
    <div
      className={[
        "mb-5 rounded-xl px-4 py-3 text-xs font-semibold",
        positive
          ? "bg-brand-primary-pale text-brand-primary-deep"
          : "bg-muted text-muted-foreground",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid min-w-0 gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-semibold">
        {value ?? "Belum tersedia"}
      </dd>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  );
}

interface AccountContentProps {
  onMutate: (
    label: string,
    input: { url: string; method?: string; body?: unknown; redirect?: boolean },
  ) => void | Promise<void>;
}

function inputClass(readOnly: boolean): string {
  return [
    "min-h-11 w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/15",
    readOnly
      ? "border-border/60 bg-muted text-muted-foreground"
      : "border-border bg-white text-foreground",
  ].join(" ");
}

const primaryButtonClass =
  "mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const secondaryButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3.5 py-2 text-xs font-bold text-brand-primary-deep transition hover:bg-brand-primary-pale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const dangerButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3.5 py-2 text-xs font-bold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300";
