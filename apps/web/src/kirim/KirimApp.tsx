import { useCallback, useEffect, useState } from "react";

import { AktivitasPage, type AktivitasState } from "@/kirim/AktivitasPage";
import { AntreanPage, type AntreanState } from "@/kirim/AntreanPage";
import { ImporPage, type ImporState } from "@/kirim/ImporPage";
import { JanganHubungiPage, type JanganHubungiState } from "@/kirim/JanganHubungiPage";
import { kirimFetch, KirimRequestError, loadKirimLauncher, type KirimContext } from "@/kirim/api";
import { KirimShell, secondaryButton, StateCard } from "@/kirim/KirimShell";
import { resolveKirimRoute } from "@/kirim/routes";
import { NomorPage, type NomorState } from "@/kirim/NomorPage";
import type { WorkspaceApplication } from "@/types";

type AppState =
  | { status: "loading" }
  | { status: "ready"; context: KirimContext }
  | { status: "forbidden"; code: string }
  | { status: "error"; message: string };

const FORBIDDEN_TEXT: Record<string, string> = {
  kirim_admin_required: "Anda belum ditetapkan sebagai pengelola Kirim SQ",
  kirim_access_denied: "Anda belum punya akses aplikasi Kirim SQ",
};

function startupError(): string | null {
  const category = new URLSearchParams(window.location.search).get("authError");
  if (category === "identity_unavailable") return "Akun SQ belum dapat dihubungi. Coba lagi beberapa saat.";
  if (category === "oidc_failed") return "Proses masuk melalui Akun SQ belum dapat diselesaikan. Silakan coba lagi.";
  return null;
}

/** Kirim SQ on `kirim.sabilulquran.or.id`: Application Access `kirim-sq` plus `kirim_admin` (§7.2). */
export function KirimApp() {
  const [state, setState] = useState<AppState>(() => {
    const error = startupError();
    return error ? { status: "error", message: error } : { status: "loading" };
  });
  const route = resolveKirimRoute(window.location.pathname);
  const [launcherApplications, setLauncherApplications] = useState<WorkspaceApplication[] | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", context: await kirimFetch<KirimContext>("/context") });
    } catch (failure) {
      if (failure instanceof KirimRequestError && failure.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (failure instanceof KirimRequestError && failure.status === 403) {
        setState({ status: "forbidden", code: failure.code });
        return;
      }
      setState({ status: "error", message: "Kirim SQ belum dapat dibuka. Silakan coba lagi." });
    }
  }, []);

  useEffect(() => {
    document.title = "Kirim SQ · Yayasan Sabilul Qur'an";
    if (startupError()) return;
    void load();
    // HUB-IMPL-022: independent of the access check, so the way back to SQ Hub shows on every screen.
    void loadKirimLauncher().then(setLauncherApplications);
  }, [load]);

  const logout = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      const body = response.ok ? ((await response.json()) as { logoutUrl?: string | null }) : {};
      window.location.assign(body.logoutUrl || "/");
    } catch {
      window.location.assign("/");
    }
  }, []);

  return (
    <KirimAppView
      state={state}
      route={route}
      launcherApplications={launcherApplications}
      onLogout={logout}
      onRetry={() => {
        window.history.replaceState({}, "", window.location.pathname);
        void load();
      }}
    />
  );
}

export function KirimAppView({
  state,
  route,
  launcherApplications,
  onLogout,
  onRetry,
  preview,
}: {
  state: AppState;
  route: ReturnType<typeof resolveKirimRoute>;
  launcherApplications?: WorkspaceApplication[] | null;
  onLogout?: () => void | Promise<void>;
  onRetry?: () => void;
  preview?: { nomor?: NomorState; antrean?: AntreanState; janganHubungi?: JanganHubungiState; aktivitas?: AktivitasState; impor?: ImporState };
}) {
  const displayName = state.status === "ready" ? state.context.displayName : undefined;
  return (
    <KirimShell active={route} launcherApplications={launcherApplications ?? null} {...(displayName ? { displayName } : {})} {...(state.status === "ready" && onLogout ? { onLogout } : {})}>
      {state.status === "loading" ? <StateCard kind="loading" title="Memeriksa akses Kirim SQ" /> : null}
      {state.status === "forbidden" ? (
        <StateCard kind="forbidden" title={FORBIDDEN_TEXT[state.code] ?? "Akses Kirim SQ ditolak"} body="Hubungi Kepala HCM bila Anda perlu mengelola nomor WhatsApp yayasan." />
      ) : null}
      {state.status === "error" ? (
        <StateCard kind="error" title="Kirim SQ belum dapat dibuka" body={state.message} action={onRetry ? <button type="button" className={secondaryButton} onClick={onRetry}>Coba lagi</button> : undefined} />
      ) : null}
      {state.status === "ready" && route === "nomor" ? <NomorPage {...(preview?.nomor ? { preview: preview.nomor } : {})} /> : null}
      {state.status === "ready" && route === "antrean" ? <AntreanPage {...(preview?.antrean ? { preview: preview.antrean } : {})} /> : null}
      {state.status === "ready" && route === "jangan-hubungi" ? <JanganHubungiPage {...(preview?.janganHubungi ? { preview: preview.janganHubungi } : {})} /> : null}
      {state.status === "ready" && route === "aktivitas" ? <AktivitasPage {...(preview?.aktivitas ? { preview: preview.aktivitas } : {})} /> : null}
      {state.status === "ready" && route === "impor" ? <ImporPage {...(preview?.impor ? { preview: preview.impor } : {})} /> : null}
      {state.status === "ready" && route === "not-found" ? <StateCard kind="empty" title="Halaman tidak ditemukan" action={<a className={secondaryButton} href="/nomor">Ke Nomor</a>} /> : null}
    </KirimShell>
  );
}
