import {
  AppWindow,
  ArrowLeft,
  KeyRound,
  LogIn,
  ScrollText,
  ShieldCheck,
} from "lucide-react";

import type { AdminAccessState } from "@/types";

interface AdminCenterPanelProps {
  state: AdminAccessState;
  onReauthenticate?: () => void | Promise<void>;
}

export function AdminCenterPanel({ state, onReauthenticate }: AdminCenterPanelProps) {
  if (state.status === "forbidden") {
    return (
      <section className="rounded-[2rem] border border-border/75 bg-white px-6 py-10 text-center shadow-[var(--shadow-soft)] sm:px-10">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="mt-5 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">
          Akses administrasi tidak tersedia
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Akun ini dapat tetap menggunakan ruang kerja SQ Hub, tetapi tidak memiliki kewenangan Administrasi SQ.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-border bg-white px-4 py-2.5 text-sm font-bold text-foreground shadow-[var(--shadow-soft)] transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Kembali ke beranda
        </a>
      </section>
    );
  }

  if (state.status === "reauth_required") {
    return (
      <section className="rounded-[2rem] border border-brand-yellow/45 bg-white px-6 py-10 text-center shadow-[var(--shadow-soft)] sm:px-10">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-yellow/25 text-foreground">
          <LogIn className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="mt-5 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">
          Masuk ulang untuk Administrasi SQ
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Kewenangan administrator diberikan setelah sesi ini dibuat. Keluar lalu masuk kembali melalui SQ Identity agar sesi istimewa dimulai setelah pemberian kewenangan.
        </p>
        <button
          type="button"
          onClick={() => void onReauthenticate?.()}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)] transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Keluar dan masuk kembali
        </button>
      </section>
    );
  }

  const { overview } = state.context;
  return (
    <div>
      <section className="relative overflow-hidden rounded-[2rem] border border-brand-primary/15 bg-brand-primary px-6 py-7 text-white shadow-[var(--shadow-brand-card)] sm:px-8 sm:py-9 lg:px-10">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-brand-cyan/30 blur-3xl" aria-hidden="true" />
        <div className="relative max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/12 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/90">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Administrasi SQ
          </span>
          <h2 className="mt-5 font-display text-3xl font-bold leading-tight tracking-[-0.035em] sm:text-4xl">
            Fondasi administrasi platform
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/80 sm:text-base sm:leading-7">
            Area ini menangani kewenangan lintas aplikasi milik platform. Hak kerja di dalam HCIS dan aplikasi domain lain tetap mengikuti aturan aplikasinya masing-masing.
          </p>
        </div>
      </section>

      <section className="pt-9 sm:pt-11" aria-labelledby="admin-overview-heading">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-primary-deep">Go 5A</p>
        <h2 id="admin-overview-heading" className="mt-1 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading sm:text-3xl">
          Ringkasan platform
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Ringkasan ini masih baca-saja untuk membuktikan batas kewenangan Admin Center sebelum fungsi pengelolaan dibuka pada fase berikutnya.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <OverviewCard
            icon={<AppWindow className="h-5 w-5" aria-hidden="true" />}
            title="Aplikasi"
            value={overview.applications.total}
            detail={`${overview.applications.active} aktif · ${overview.applications.inactive} nonaktif`}
          />
          <OverviewCard
            icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
            title="Akses Aplikasi"
            value={overview.applicationAccess.total}
            detail={`${overview.applicationAccess.active} aktif · ${overview.applicationAccess.revoked} dicabut`}
          />
          <OverviewCard
            icon={<ScrollText className="h-5 w-5" aria-hidden="true" />}
            title="Audit 24 jam"
            value={overview.auditEventsLast24Hours}
            detail="aktivitas platform tercatat"
          />
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-3" aria-label="Tahap Administrasi SQ">
        <FutureArea title="Aplikasi" description="Registry aplikasi dan status platform." />
        <FutureArea title="Akses Aplikasi" description="Pemberian dan pencabutan akses Staff." />
        <FutureArea title="Audit Platform" description="Jejak perubahan administrasi lintas aplikasi." />
      </section>
    </div>
  );
}

function OverviewCard({
  icon,
  title,
  value,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
  detail: string;
}) {
  return (
    <article className="rounded-3xl border border-border/70 bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-primary-pale text-brand-primary-deep">
        {icon}
      </div>
      <p className="mt-5 text-xs font-bold uppercase tracking-[0.13em] text-muted-foreground">{title}</p>
      <p className="mt-1 font-display text-4xl font-bold tracking-[-0.04em] text-brand-heading">{value}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </article>
  );
}

function FutureArea({ title, description }: { title: string; description: string }) {
  return (
    <article className="rounded-3xl border border-dashed border-border bg-white/65 p-5">
      <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Fase berikutnya
      </span>
      <h3 className="mt-4 font-display text-lg font-bold text-brand-heading">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </article>
  );
}
