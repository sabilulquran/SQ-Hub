import { useCallback, useEffect, useState } from "react";

import { AdminPage } from "@/kerja/AdminPage";
import { kerjaFetch, KerjaRequestError, loadKerjaLauncher, type KerjaContext } from "@/kerja/api";
import { KartuRedirect } from "@/kerja/KartuRedirect";
import { KerjaShell } from "@/kerja/KerjaShell";
import { PapanPage, RuangRedirect } from "@/kerja/PapanPage";
import { PengaturanPage } from "@/kerja/PengaturanPage";
import { resolveKerjaRoute, type KerjaRoute } from "@/kerja/routes";
import { ArsipPage, BerkasPage, CariPage } from "@/kerja/RuangPages";
import { RuangListPage, TugasPage } from "@/kerja/TugasPage";
import { Link, secondaryButton, StateCard, ViewerContext } from "@/kerja/ui";
import type { WorkspaceApplication } from "@/types";

type AppState =
  | { status: "loading" }
  | { status: "ready"; context: KerjaContext }
  | { status: "forbidden"; code: string; message: string }
  | { status: "error"; message: string };

function startupError(): string | null {
  const category = new URLSearchParams(window.location.search).get("authError");
  if (category === "identity_unavailable") return "Akun Sabilul Qur'an belum dapat dihubungi. Coba lagi beberapa saat.";
  if (category === "oidc_failed") return "Proses masuk melalui Akun Sabilul Qur'an belum dapat diselesaikan. Silakan coba lagi.";
  return null;
}

/** Kerja on `kerja.sabilulquran.or.id`: Application Access `kerja-sq` and a Directory person (§7.2). */
export function KerjaApp() {
  const [state, setState] = useState<AppState>(() => {
    const error = startupError();
    return error ? { status: "error", message: error } : { status: "loading" };
  });
  const [route, setRoute] = useState<KerjaRoute>(() => resolveKerjaRoute(window.location.pathname));
  const [launcherApplications, setLauncherApplications] = useState<WorkspaceApplication[] | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", context: await kerjaFetch<KerjaContext>("/context") });
    } catch (failure) {
      if (failure instanceof KerjaRequestError && failure.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (failure instanceof KerjaRequestError && failure.status === 403) {
        setState({ status: "forbidden", code: failure.code, message: failure.message });
        return;
      }
      setState({ status: "error", message: "Kerja belum dapat dibuka. Silakan coba lagi." });
    }
  }, []);

  useEffect(() => {
    document.title = "Kerja · Yayasan Sabilul Qur'an";
    let path = window.location.pathname;
    const sync = () => {
      if (window.location.pathname === path) return;
      path = window.location.pathname;
      setRoute(resolveKerjaRoute(path));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", sync);
    if (!startupError()) {
      void load();
      void loadKerjaLauncher().then(setLauncherApplications);
    }
    return () => window.removeEventListener("popstate", sync);
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

  return <KerjaAppView state={state} route={route} launcherApplications={launcherApplications} onLogout={logout} onRetry={() => { window.history.replaceState({}, "", window.location.pathname); void load(); }} />;
}

export function KerjaAppView({
  state,
  route,
  launcherApplications,
  onLogout,
  onRetry,
}: {
  state: AppState;
  route: KerjaRoute;
  launcherApplications?: WorkspaceApplication[] | null;
  onLogout?: () => void | Promise<void>;
  onRetry?: () => void;
}) {
  const ready = state.status === "ready" ? state.context : null;
  // Someone with access but no Directory person can sign out, but has no tasks or rooms.
  const usable = ready !== null && ready.orang !== null;
  return (
    <KerjaShell
      route={route}
      pengelola={ready?.pengelola ?? false}
      launcherApplications={launcherApplications ?? null}
      showNotifications={usable}
      {...(ready ? { displayName: ready.displayName } : {})}
      {...(ready && onLogout ? { onLogout } : {})}
    >
      {state.status === "loading" ? <StateCard kind="loading" title="Memeriksa akses Kerja" /> : null}
      {state.status === "forbidden" ? <StateCard kind="forbidden" title={state.code === "kerja_access_denied" ? "Anda belum punya akses aplikasi Kerja" : "Akses Kerja ditolak"} body={state.code === "kerja_access_denied" ? "Hubungi Kepala HCM bila Anda seharusnya memakai Kerja." : state.message} /> : null}
      {state.status === "error" ? <StateCard kind="error" title="Kerja belum dapat dibuka" body={state.message} action={onRetry ? <button type="button" className={secondaryButton} onClick={onRetry}>Coba lagi</button> : undefined} /> : null}
      {ready && !usable && route.name !== "admin" ? (
        <StateCard kind="forbidden" title="Akun Anda belum tercatat di Organization Directory" body={ready.directoryTersedia ? "Kerja memakai data pegawai dari HCIS. Hubungi HCM agar akun Anda ditautkan ke data kepegawaian Anda." : "Organization Directory belum tersedia. Coba lagi beberapa saat."} />
      ) : null}
      {usable || (ready && route.name === "admin") ? <ViewerContext.Provider value={ready.orang?.id ?? null}><Page route={route} /></ViewerContext.Provider> : null}
    </KerjaShell>
  );
}

function Page({ route }: { route: KerjaRoute }) {
  switch (route.name) {
    case "tugas": return <TugasPage />;
    case "ruang-daftar": return <RuangListPage />;
    case "ruang": return <RuangRedirect key={route.ruangId} ruangId={route.ruangId} />;
    case "papan": return <PapanPage key={route.papanId} papanId={route.papanId} />;
    case "kartu": return <KartuRedirect key={route.kartuId} kartuId={route.kartuId} />;
    case "cari": return <CariPage key={route.ruangId} ruangId={route.ruangId} />;
    case "berkas": return <BerkasPage key={route.ruangId} ruangId={route.ruangId} />;
    case "arsip": return <ArsipPage key={route.ruangId} ruangId={route.ruangId} />;
    case "pengaturan": return <PengaturanPage key={route.ruangId} ruangId={route.ruangId} />;
    case "admin": return <AdminPage />;
    default: return <StateCard kind="empty" title="Halaman tidak ditemukan" action={<Link className={secondaryButton} href="/">Ke Tugas saya</Link>} />;
  }
}
