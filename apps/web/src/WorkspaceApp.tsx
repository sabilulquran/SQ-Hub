import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { AccountTransitionPage } from "@/AccountTransitionPage";\nimport { AdminCenterPage } from "@/AdminCenterPage";
import { WorkspaceShell } from "@/WorkspaceShell";
import { BrandLockup } from "@/components/BrandLockup";
import { adminRouteStateFromResponse, type AdminRouteState } from "@/admin-route-state";
import { resolveHubRoute } from "@/routes";\nimport type { WorkspaceSnapshot } from "@/types";

type RuntimeState =
  | { status: "loading" }
  | { status: "ready"; workspace: WorkspaceSnapshot }
  | { status: "error"; message: string };

function startupError(): string | null {
  const category = new URLSearchParams(window.location.search).get("authError");
  if (category === "identity_unavailable") {
    return "Akun SQ belum dapat dihubungi. Coba lagi beberapa saat.";
  }
  if (category === "oidc_failed") {
    return "Proses masuk melalui Akun SQ belum dapat diselesaikan. Silakan coba lagi.";
  }
  return null;
}

function adminRoute(): boolean {
  return window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
}

export function WorkspaceApp() {
  const [state, setState] = useState<RuntimeState>(() => {
    const error = startupError();
    return error ? { status: "error", message: error } : { status: "loading" };
  });

  const loadWorkspace = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/workspace", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });

      if (response.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (!response.ok) {
        throw new Error(`workspace request failed: ${response.status}`);
      }

      const workspace = (await response.json()) as WorkspaceSnapshot;
      setState({ status: "ready", workspace });
    } catch {
      setState({
        status: "error",
        message: "SQ Hub belum dapat memuat ruang kerja Anda. Silakan coba lagi.",
      });
    }
  }, []);

  useEffect(() => {
    if (startupError()) return;
    void loadWorkspace();
  }, [loadWorkspace]);

  const logout = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        window.location.assign("/");
        return;
      }
      const body = (await response.json()) as { logoutUrl?: string | null };
      window.location.assign(body.logoutUrl || "/");
    } catch {
      window.location.assign("/");
    }
  }, []);

  if (state.status === "ready") {
    const route = resolveHubRoute(window.location.pathname);
    if (route === "admin") {
      return <AdminRoute workspace={state.workspace} onLogout={logout} />;
    }
    if (route === "account") {
      return <AccountTransitionPage workspace={state.workspace} onLogout={logout} />;
    }
    if (route === "home" || route === "apps") {
      return <WorkspaceShell workspace={state.workspace} route={route} onLogout={logout} />;
    }
    return <NotFoundPage />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-border/75 bg-white p-6 text-center shadow-[var(--shadow-raised)] sm:p-8">
        <div className="flex justify-center">
          <BrandLockup />
        </div>

        {state.status === "loading" ? (
          <>
            <div className="mx-auto mt-7 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            </div>
            <h1 className="mt-4 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">
              Menyiapkan ruang kerja Anda
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              SQ Hub sedang memeriksa sesi dan akses aplikasi Anda.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mt-7 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-yellow/25 text-foreground">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-4 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">
              SQ Hub belum dapat dibuka
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              {state.message}
            </p>
            <button
              type="button"
              onClick={() => {
                window.history.replaceState({}, "", "/");
                void loadWorkspace();
              }}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Coba lagi
            </button>
          </>
        )}
      </div>
    </main>
  );
}

function AdminRoute({
  workspace,
  onLogout,
}: {
  workspace: WorkspaceSnapshot;
  onLogout: () => void | Promise<void>;
}) {
  const [state, setState] = useState<AdminRouteState>("loading");

  const verifyAuthorization = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/admin/context", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });

      if (response.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }

      const body = response.status === 403
        ? (await response.json().catch(() => ({}))) as { error?: string }
        : undefined;
      setState(adminRouteStateFromResponse(response.status, body?.error));
    } catch {
      setState("unavailable");
    }
  }, []);

  useEffect(() => {
    void verifyAuthorization();
  }, [verifyAuthorization]);

  if (state === "authorized") {
    return (
      <AdminCenterPage
        workspace={workspace}
        onLogout={onLogout}
        onAuthorizationDenied={(reason) => setState(reason)}
      />
    );
  }

  if (state === "forbidden") return <NotFoundPage />;
  if (state === "reauth") return <ReauthenticationPage onLogout={onLogout} />;
  if (state === "unavailable") return <UnavailablePage onRetry={verifyAuthorization} />;
  return <LoadingPage />;
}

function NeutralPage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-border/75 bg-white p-6 text-center shadow-[var(--shadow-raised)] sm:p-8">
        <div className="flex justify-center">
          <BrandLockup />
        </div>
        {children}
      </div>
    </main>
  );
}

function LoadingPage() {
  return (
    <NeutralPage>
      <div className="mx-auto mt-7 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
      </div>
      <h1 className="mt-4 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">Memuat halaman</h1>
    </NeutralPage>
  );
}

export function NotFoundPage() {
  return (
    <NeutralPage>
      <p className="mt-7 text-sm font-bold uppercase tracking-[0.16em] text-muted-foreground">404</p>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">Halaman tidak ditemukan</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Halaman yang Anda cari tidak tersedia.</p>
      <a href="/" className="mt-5 inline-flex rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)]">Kembali ke SQ Hub</a>
    </NeutralPage>
  );
}

function ReauthenticationPage({ onLogout }: { onLogout: () => void | Promise<void> }) {
  return (
    <NeutralPage>
      <h1 className="mt-7 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">Masuk ulang diperlukan</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Keluar lalu masuk kembali melalui Akun SQ untuk memperbarui sesi Anda.</p>
      <button type="button" onClick={() => void onLogout()} className="mt-5 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)]">Keluar dan masuk kembali</button>
    </NeutralPage>
  );
}

function UnavailablePage({ onRetry }: { onRetry: () => void | Promise<void> }) {
  return (
    <NeutralPage>
      <h1 className="mt-7 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">Halaman belum dapat dibuka</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Coba lagi beberapa saat.</p>
      <button type="button" onClick={() => void onRetry()} className="mt-5 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)]">Coba lagi</button>
    </NeutralPage>
  );
}
