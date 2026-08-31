import {
  ArrowLeft,
  Boxes,
  LockKeyhole,
  RefreshCw,
  ShieldEllipsis,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AccountMenu } from "@/components/AccountMenu";
import { BrandLockup } from "@/components/BrandLockup";
import type { AdminApplication, WorkspaceSnapshot } from "@/types";

interface AdminCenterPageProps {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
}

type AdminState =
  | { status: "loading" }
  | { status: "ready"; applications: AdminApplication[] }
  | { status: "forbidden" }
  | { status: "reauth" }
  | { status: "error" };

export function AdminCenterPage({ workspace, onLogout }: AdminCenterPageProps) {
  const [state, setState] = useState<AdminState>({ status: "loading" });

  const loadAdmin = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const contextResponse = await fetch("/api/admin/context", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });

      if (contextResponse.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (contextResponse.status === 403) {
        const body = (await contextResponse.json().catch(() => ({}))) as { error?: string };
        setState(body.error === "ADMIN_REAUTH_REQUIRED" ? { status: "reauth" } : { status: "forbidden" });
        return;
      }
      if (!contextResponse.ok) throw new Error("admin context unavailable");

      const applicationsResponse = await fetch("/api/admin/applications", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (applicationsResponse.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (applicationsResponse.status === 403) {
        const body = (await applicationsResponse.json().catch(() => ({}))) as { error?: string };
        setState(body.error === "ADMIN_REAUTH_REQUIRED" ? { status: "reauth" } : { status: "forbidden" });
        return;
      }
      if (!applicationsResponse.ok) throw new Error("admin applications unavailable");

      const body = (await applicationsResponse.json()) as { applications: AdminApplication[] };
      setState({ status: "ready", applications: body.applications });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-border/65 bg-sidebar/95 px-5 py-6 backdrop-blur-xl lg:flex lg:flex-col">
        <BrandLockup />

        <nav className="mt-9 space-y-1.5" aria-label="Navigasi Administrasi SQ">
          <a
            href="/"
            className="flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-white hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
            Kembali ke SQ Hub
          </a>
          <div
            className="flex items-center gap-3 rounded-2xl bg-brand-primary-pale px-3.5 py-3 text-sm font-bold text-brand-primary-deep ring-1 ring-brand-primary/10"
            aria-current="page"
          >
            <ShieldEllipsis className="h-[18px] w-[18px]" aria-hidden="true" />
            Administrasi SQ
          </div>
        </nav>

        <div className="mt-auto pt-6">
          <div className="mb-3 rounded-2xl bg-brand-primary-pale/65 px-3.5 py-3 text-[11px] leading-5 text-brand-primary-deep">
            <span className="flex items-center gap-2 font-bold">
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              Area terbatas
            </span>
            <span className="mt-1 block text-brand-primary-deep/75">
              Kewenangan platform tidak memberikan izin bisnis di aplikasi domain.
            </span>
          </div>
          <AccountMenu user={workspace.user} variant="sidebar" onLogout={onLogout} />
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-border/55 bg-background/88 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="lg:hidden">
              <BrandLockup compact />
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Platform</p>
              <h1 className="truncate font-display text-xl font-bold tracking-[-0.02em] text-brand-heading">Administrasi SQ</h1>
            </div>
            <AccountMenu user={workspace.user} variant="header" onLogout={onLogout} />
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
          <div className="mb-6 lg:hidden">
            <a href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-primary-deep">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              SQ Hub
            </a>
          </div>

          <section className="rounded-[2rem] border border-brand-primary/15 bg-white p-6 shadow-[var(--shadow-soft)] sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-3xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-primary-deep">SQ Admin Center · Go 5A</p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.03em] text-brand-heading sm:text-4xl">
                  Administrasi SQ
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  Area ini hanya untuk administrasi lintas aplikasi yang dimiliki platform. Hak payroll, kepegawaian, keuangan, penerimaan, dan kewenangan bisnis lain tetap berada di aplikasi masing-masing.
                </p>
              </div>
              <span className="inline-flex self-start items-center gap-2 rounded-2xl bg-brand-primary-pale px-3.5 py-2.5 text-xs font-bold text-brand-primary-deep">
                <ShieldEllipsis className="h-4 w-4" aria-hidden="true" />
                Platform Administrator
              </span>
            </div>
          </section>

          {state.status === "loading" ? (
            <section className="mt-6 rounded-3xl border border-border/70 bg-white p-8 text-center shadow-[var(--shadow-soft)]">
              <RefreshCw className="mx-auto h-5 w-5 animate-spin text-brand-primary-deep" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-muted-foreground">Memeriksa kewenangan administrasi...</p>
            </section>
          ) : null}

          {state.status === "forbidden" ? (
            <AdminMessage
              title="Administrasi SQ tidak tersedia"
              body="Sesi Anda tidak memiliki kewenangan Platform Administrator untuk membuka area ini."
            />
          ) : null}

          {state.status === "reauth" ? (
            <AdminMessage
              title="Masuk ulang diperlukan"
              body="Kewenangan administrator diberikan setelah sesi ini dibuat. Keluar lalu masuk kembali melalui SQ Identity untuk membentuk sesi administratif yang baru."
              action={onLogout ? { label: "Keluar dan masuk kembali", onClick: onLogout } : undefined}
            />
          ) : null}

          {state.status === "error" ? (
            <AdminMessage
              title="Administrasi SQ belum dapat dimuat"
              body="Verifikasi kewenangan platform sedang tidak tersedia. Tidak ada data administrasi yang ditampilkan."
              action={{ label: "Coba lagi", onClick: loadAdmin }}
            />
          ) : null}

          {state.status === "ready" ? (
            <section className="mt-8" aria-labelledby="registry-heading">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-primary-deep">Read-only</p>
                  <h2 id="registry-heading" className="mt-1 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading sm:text-3xl">
                    Application Registry
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    Go 5A hanya menampilkan registry milik SQ Hub. Pengubahan aplikasi dan Application Access belum diaktifkan dari UI.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 self-start rounded-2xl border border-border/70 bg-white px-3.5 py-2.5 text-xs font-semibold text-muted-foreground shadow-[var(--shadow-soft)] sm:self-auto">
                  <Boxes className="h-4 w-4 text-brand-primary-deep" aria-hidden="true" />
                  {state.applications.length} aplikasi terdaftar
                </div>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {state.applications.map((application) => (
                  <article key={application.key} className="rounded-3xl border border-border/70 bg-white p-5 shadow-[var(--shadow-soft)]">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-lg font-bold text-brand-heading">{application.name}</h3>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{application.key}</p>
                      </div>
                      <span className={application.status === "active" ? "rounded-full bg-brand-primary-pale px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-primary-deep" : "rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"}>
                        {application.status === "active" ? "Aktif" : "Nonaktif"}
                      </span>
                    </div>
                    <p className="mt-4 break-all text-xs leading-5 text-muted-foreground">{application.canonicalUrl}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function AdminMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void | Promise<void> };
}) {
  return (
    <section className="mt-6 rounded-3xl border border-border/70 bg-white p-7 text-center shadow-[var(--shadow-soft)] sm:p-9">
      <ShieldEllipsis className="mx-auto h-6 w-6 text-brand-primary-deep" aria-hidden="true" />
      <h2 className="mt-4 font-display text-2xl font-bold text-brand-heading">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{body}</p>
      {action ? (
        <button
          type="button"
          onClick={() => void action.onClick()}
          className="mt-5 rounded-2xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {action.label}
        </button>
      ) : (
        <a href="/" className="mt-5 inline-flex rounded-2xl border border-border px-4 py-2.5 text-sm font-bold text-brand-primary-deep">
          Kembali ke SQ Hub
        </a>
      )}
    </section>
  );
}
