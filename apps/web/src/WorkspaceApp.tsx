import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AdminCenterPage } from "@/AdminCenterPage";
import { WorkspaceShell } from "@/WorkspaceShell";
import { BrandLockup } from "@/components/BrandLockup";
import type { WorkspaceSnapshot } from "@/types";

type RuntimeState =
  | { status: "loading" }
  | { status: "ready"; workspace: WorkspaceSnapshot }
  | { status: "error"; message: string };

function startupError(): string | null {
  const category = new URLSearchParams(window.location.search).get("authError");
  if (category === "identity_unavailable") {
    return "SQ Identity belum dapat dihubungi. Coba lagi beberapa saat.";
  }
  if (category === "oidc_failed") {
    return "Proses masuk melalui SQ Identity belum dapat diselesaikan. Silakan coba lagi.";
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
    if (adminRoute()) {
      return <AdminCenterPage workspace={state.workspace} onLogout={logout} />;
    }
    return <WorkspaceShell workspace={state.workspace} onLogout={logout} />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-xl rounded-[2rem] border border-border/75 bg-white p-6 text-center shadow-[var(--shadow-raised)] sm:p-9">
        <div className="flex justify-center">
          <BrandLockup />
        </div>

        {state.status === "loading" ? (
          <>
            <div className="mx-auto mt-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-primary-pale text-brand-primary-deep">
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading sm:text-3xl">
              Menyiapkan ruang kerja Anda
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              SQ Hub sedang memeriksa sesi dan akses aplikasi Anda.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mt-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-yellow/25 text-foreground">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading sm:text-3xl">
              SQ Hub belum dapat dibuka
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              {state.message}
            </p>
            <button
              type="button"
              onClick={() => {
                window.history.replaceState({}, "", "/");
                void loadWorkspace();
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
