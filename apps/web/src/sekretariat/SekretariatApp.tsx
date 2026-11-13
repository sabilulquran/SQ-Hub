import { useCallback, useEffect, useState } from "react";

import { BukuPage, PengaturanPage } from "@/sekretariat/AdminPages";
import { loadSekretariatLauncher, sekretariatFetch, SekretariatRequestError, type SekretariatContext } from "@/sekretariat/api";
import { KotakPage, RingkasanPage, SuratMasukPage } from "@/sekretariat/KotakPages";
import { resolveSekretariatRoute, type SekretariatRoute } from "@/sekretariat/routes";
import { SekretariatShell } from "@/sekretariat/SekretariatShell";
import { PenerbitSuratPage, SuratPage } from "@/sekretariat/SuratPages";
import { Link, secondaryButton, StateCard } from "@/sekretariat/ui";
import type { WorkspaceApplication } from "@/types";

type AppState =
  | { status: "loading" }
  | { status: "ready"; context: SekretariatContext }
  | { status: "forbidden"; code: string; message: string }
  | { status: "error"; message: string };

function startupError(): string | null {
  const category = new URLSearchParams(window.location.search).get("authError");
  if (category === "identity_unavailable") return "Akun Sabilul Qur'an belum dapat dihubungi. Coba lagi beberapa saat.";
  if (category === "oidc_failed") return "Proses masuk melalui Akun Sabilul Qur'an belum dapat diselesaikan. Silakan coba lagi.";
  return null;
}

/** Sekretariat on `sekretariat.sabilulquran.or.id`: Application Access `sekretariat-sq` + akses berlapis (§8). */
export function SekretariatApp() {
  const [state, setState] = useState<AppState>(() => {
    const error = startupError();
    return error ? { status: "error", message: error } : { status: "loading" };
  });
  const [route, setRoute] = useState<SekretariatRoute>(() => resolveSekretariatRoute(window.location.pathname));
  const [launcherApplications, setLauncherApplications] = useState<WorkspaceApplication[] | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", context: await sekretariatFetch<SekretariatContext>("/context") });
    } catch (failure) {
      if (failure instanceof SekretariatRequestError && failure.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (failure instanceof SekretariatRequestError && failure.status === 403) {
        setState({ status: "forbidden", code: failure.code, message: failure.message });
        return;
      }
      setState({ status: "error", message: "Sekretariat belum dapat dibuka. Silakan coba lagi." });
    }
  }, []);

  useEffect(() => {
    document.title = "Sekretariat · Yayasan Sabilul Qur'an";
    const sync = () => {
      setRoute(resolveSekretariatRoute(window.location.pathname));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", sync);
    if (!startupError()) {
      void load();
      void loadSekretariatLauncher().then(setLauncherApplications);
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

  const ready = state.status === "ready" ? state.context : null;
  const usable = ready !== null && ready.orang !== null;
  return (
    <SekretariatShell
      route={route}
      pengelola={ready?.pengelola ?? false}
      launcherApplications={launcherApplications}
      {...(ready ? { displayName: ready.displayName } : {})}
      {...(ready ? { onLogout: logout } : {})}
    >
      {state.status === "loading" ? <StateCard kind="loading" title="Memeriksa akses Sekretariat" /> : null}
      {state.status === "forbidden" ? (
        <StateCard
          kind="forbidden"
          title={state.code === "sekretariat_access_denied" ? "Anda belum punya akses aplikasi Sekretariat" : "Akses Sekretariat ditolak"}
          body={state.code === "sekretariat_access_denied" ? "Hubungi Kepala HCM bila Anda seharusnya memakai Sekretariat." : state.message}
        />
      ) : null}
      {state.status === "error" ? (
        <StateCard
          kind="error"
          title="Sekretariat belum dapat dibuka"
          body={state.message}
          action={<button type="button" className={secondaryButton} onClick={() => { window.history.replaceState({}, "", window.location.pathname); void load(); }}>Coba lagi</button>}
        />
      ) : null}
      {ready && !usable ? (
        <StateCard
          kind="forbidden"
          title="Akun Anda belum tercatat di Organization Directory"
          body={ready.directoryTersedia ? "Sekretariat memakai data pegawai dari HCIS. Hubungi HCM agar akun Anda ditautkan ke data kepegawaian Anda." : "Organization Directory belum tersedia. Coba lagi beberapa saat."}
        />
      ) : null}
      {usable ? <Page route={route} context={ready} /> : null}
    </SekretariatShell>
  );
}

function Page({ route, context }: { route: SekretariatRoute; context: SekretariatContext }) {
  switch (route.name) {
    case "ringkasan": return <RingkasanPage context={context} />;
    case "kotak": return <KotakPage key={route.kotakId} kotakId={route.kotakId} />;
    case "surat-masuk": return <SuratMasukPage key={route.suratMasukId} suratMasukId={route.suratMasukId} context={context} />;
    case "penerbit-surat": return <PenerbitSuratPage key={route.penerbitId} penerbitId={route.penerbitId} />;
    case "surat": return <SuratPage key={route.suratId} suratId={route.suratId} />;
    case "buku": return <BukuPage context={context} />;
    case "pengaturan": return <PengaturanPage />;
    default: return <StateCard kind="empty" title="Halaman tidak ditemukan" action={<Link className={secondaryButton} href="/">Ke Ringkasan</Link>} />;
  }
}
