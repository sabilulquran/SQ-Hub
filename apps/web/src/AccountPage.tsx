import {
  AppWindow,
  BadgeCheck,
  ChevronRight,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { GlobalHeader } from "@/components/GlobalHeader";
import { MobileNavigation } from "@/components/MobileNavigation";
import type { AccountSnapshot, WorkspaceSnapshot } from "@/types";

interface AccountPageProps {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  previewAccount?: AccountSnapshot;
}

type AccountState =
  | { status: "loading" }
  | { status: "ready"; account: AccountSnapshot }
  | { status: "error"; message: string };

function securityLabel(value: boolean | null, positive: string, negative: string): string {
  if (value === true) return positive;
  if (value === false) return negative;
  return "Status belum dapat diverifikasi";
}

function statusClass(value: boolean | null): string {
  if (value === true) return "bg-brand-primary-pale text-brand-primary-deep";
  if (value === false) return "bg-brand-yellow/25 text-foreground";
  return "bg-muted text-muted-foreground";
}

export function AccountPage({
  workspace,
  onLogout,
  previewAccount,
}: AccountPageProps) {
  const [state, setState] = useState<AccountState>(
    previewAccount
      ? { status: "ready", account: previewAccount }
      : { status: "loading" },
  );

  const loadAccount = useCallback(async () => {
    if (previewAccount) return;
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/account", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        window.location.assign("/api/auth/oidc/start");
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
            Kelola profil, keamanan, dan akses aplikasi Anda dalam satu tempat.
          </p>
        </header>

        {state.status === "loading" ? <AccountLoading /> : null}
        {state.status === "error" ? (
          <AccountError message={state.message} onRetry={loadAccount} />
        ) : null}
        {state.status === "ready" ? (
          <AccountContent account={state.account} />
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
      <button
        type="button"
        onClick={() => void onRetry()}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Coba lagi
      </button>
    </section>
  );
}

function AccountContent({ account }: { account: AccountSnapshot }) {
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.85fr)] lg:gap-6">
      <div className="min-w-0 space-y-5">
        <section className="overflow-hidden rounded-2xl border border-border/80 bg-white shadow-[var(--shadow-soft)]">
          <div className="flex items-start gap-3 border-b border-border/70 px-5 py-5 sm:px-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
              <UserRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-brand-heading">Profil Saya</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Informasi dasar yang digunakan untuk mengenali akun Anda.
              </p>
            </div>
          </div>
          <dl className="divide-y divide-border/70 px-5 sm:px-6">
            <ProfileRow label="Nama" value={account.profile.displayName} />
            <ProfileRow label="NIP / ID masuk" value={account.profile.username} />
            <div className="grid min-w-0 gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Email
              </dt>
              <dd className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 break-all text-sm font-semibold text-foreground">
                    {account.profile.email ?? "Belum tersedia"}
                  </span>
                  {account.profile.email ? (
                    <span
                      className={[
                        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold",
                        account.profile.emailVerified
                          ? "bg-brand-primary-pale text-brand-primary-deep"
                          : "bg-brand-yellow/25 text-foreground",
                      ].join(" ")}
                    >
                      {account.profile.emailVerified ? (
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {account.profile.emailVerified ? "Terverifikasi" : "Belum terverifikasi"}
                    </span>
                  ) : null}
                </div>
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-border/80 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-brand-heading">Keamanan</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Atur kata sandi dan verifikasi tambahan untuk melindungi akun.
              </p>
            </div>
          </div>

          <div className="mt-5 divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70">
            <SecurityAction
              icon={KeyRound}
              title="Kata sandi"
              description="Buat kata sandi baru melalui proses aman Akun SQ."
              href="/api/auth/oidc/action/password"
              actionLabel="Ganti kata sandi"
            />
            <SecurityAction
              icon={Smartphone}
              title="Verifikasi dua langkah"
              description={securityLabel(
                account.security.totpConfigured,
                "Authenticator sudah aktif pada akun ini.",
                "Authenticator belum diaktifkan.",
              )}
              status={account.security.totpConfigured}
              href={account.security.totpConfigured ? undefined : "/api/auth/oidc/action/totp"}
              actionLabel={account.security.totpConfigured ? undefined : "Aktifkan"}
            />
            <SecurityAction
              icon={ShieldCheck}
              title="Kode pemulihan"
              description={securityLabel(
                account.security.recoveryCodesConfigured,
                "Kode pemulihan telah dikonfigurasi.",
                "Kode pemulihan belum dikonfigurasi.",
              )}
              status={account.security.recoveryCodesConfigured}
              href="/api/auth/oidc/action/recovery-codes"
              actionLabel="Kelola kode"
            />
          </div>
        </section>

        <section className="rounded-2xl border border-border/80 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
              <Smartphone className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-brand-heading">Login & perangkat</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Perangkat yang Anda percayai dapat melewati kode OTP sesuai kebijakan keamanan.
                Anda tetap diminta masuk ulang saat sesi berakhir atau keamanan akun berubah.
              </p>
            </div>
          </div>
        </section>
      </div>

      <aside className="min-w-0">
        <section className="rounded-2xl border border-border/80 bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6 lg:sticky lg:top-24">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
              <AppWindow className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-brand-heading">Aplikasi Saya</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">
                Aplikasi yang saat ini dapat Anda buka.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {account.applications.length > 0 ? (
              account.applications.map((application) => (
                <a
                  key={application.key}
                  href={application.canonicalUrl}
                  className="flex min-h-12 min-w-0 items-center gap-3 rounded-xl border border-border/70 px-3.5 py-3 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">
                      {application.name}
                    </span>
                    {application.description ? (
                      <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {application.description}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </a>
              ))
            ) : (
              <p className="rounded-xl bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
                Belum ada aplikasi yang diberikan untuk akun ini.
              </p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function SecurityAction({
  icon: Icon,
  title,
  description,
  status,
  href,
  actionLabel,
}: {
  icon: typeof KeyRound;
  title: string;
  description: string;
  status?: boolean | null;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          {status !== undefined ? (
            <span className={["rounded-full px-2 py-1 text-[11px] font-bold", statusClass(status)].join(" ")}>
              {status === true ? "Aktif" : status === false ? "Belum aktif" : "Belum diverifikasi"}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {href && actionLabel ? (
        <a
          href={href}
          className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-border px-3.5 py-2 text-xs font-bold text-brand-primary-deep transition hover:bg-brand-primary-pale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {actionLabel}
        </a>
      ) : null}
    </div>
  );
}
