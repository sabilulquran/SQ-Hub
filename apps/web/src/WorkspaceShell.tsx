import { Grid2X2, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { filterApplications } from "@/application-filter";
import { ApplicationCard } from "@/components/ApplicationCard";
import { GlobalHeader, type HeaderPreviewMode } from "@/components/GlobalHeader";
import { MobileNavigation } from "@/components/MobileNavigation";
import type { WorkspaceApplication, WorkspaceSnapshot } from "@/types";

export type WorkspacePrimaryRoute = "home" | "apps";

interface WorkspaceShellProps {
  workspace: WorkspaceSnapshot;
  route?: WorkspacePrimaryRoute;
  previewMode?: HeaderPreviewMode;
  onLogout?: () => void | Promise<void>;
}

export function WorkspaceShell({
  workspace,
  route = "home",
  previewMode,
  onLogout,
}: WorkspaceShellProps) {
  const [query, setQuery] = useState("");
  const filteredApplications = useMemo(
    () => filterApplications(workspace.applications, query),
    [workspace.applications, query],
  );

  return (
    <div className="min-h-screen bg-surface text-foreground">
      <GlobalHeader workspace={workspace} onLogout={onLogout} previewMode={previewMode} />

      <main className="mx-auto max-w-7xl px-4 pb-32 pt-7 sm:px-6 sm:pt-10 lg:px-8 lg:pb-12">
        {route === "home" ? (
          <HomePage workspace={workspace} />
        ) : (
          <ApplicationsPage
            applications={workspace.applications}
            filteredApplications={filteredApplications}
            query={query}
            onQueryChange={setQuery}
          />
        )}
      </main>

      <MobileNavigation
        active={route}
        platformAdministration={workspace.capabilities.platformAdministration}
      />
    </div>
  );
}

function HomePage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const { applications, user } = workspace;

  return (
    <>
      <section aria-labelledby="home-heading">
        <p className="text-sm font-semibold text-brand-primary-deep">Beranda</p>
        <h1
          id="home-heading"
          className="mt-1 font-display text-3xl font-bold tracking-[-0.03em] text-brand-heading sm:text-4xl"
        >
          Assalamu&apos;alaikum, {user.displayName}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Pilih aplikasi yang tersedia untuk pekerjaan Anda.
        </p>
      </section>

      <section className="mt-9" aria-labelledby="your-apps-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="your-apps-heading" className="font-display text-xl font-bold text-brand-heading sm:text-2xl">
              Aplikasi Anda
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {applications.length} aplikasi tersedia
            </p>
          </div>
          <a
            href="/apps"
            className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-brand-primary-deep hover:bg-brand-primary-pale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Lihat semua aplikasi
          </a>
        </div>

        <div className="mt-4">
          <ApplicationGrid applications={applications} />
        </div>
      </section>
    </>
  );
}

function ApplicationsPage({
  applications,
  filteredApplications,
  query,
  onQueryChange,
}: {
  applications: WorkspaceApplication[];
  filteredApplications: WorkspaceApplication[];
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <>
      <section aria-labelledby="apps-heading">
        <p className="text-sm font-semibold text-brand-primary-deep">SQ Hub</p>
        <h1
          id="apps-heading"
          className="mt-1 font-display text-3xl font-bold tracking-[-0.03em] text-brand-heading sm:text-4xl"
        >
          Semua aplikasi
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          Aplikasi yang tampil di sini sudah disesuaikan dengan akses akun Anda.
        </p>
      </section>

      {applications.length > 0 ? (
        <section className="mt-7" aria-label="Cari dan buka aplikasi">
          <label htmlFor="application-search" className="block max-w-xl">
            <span className="mb-2 block text-sm font-bold text-foreground">Cari aplikasi</span>
            <span className="relative block">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                id="application-search"
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Cari berdasarkan nama atau deskripsi"
                className="min-h-11 w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-brand-primary focus:ring-4 focus:ring-brand-primary/10"
              />
            </span>
          </label>

          <div className="mt-6">
            {filteredApplications.length > 0 ? (
              <ApplicationGrid applications={filteredApplications} />
            ) : (
              <EmptyState
                icon="search"
                title="Aplikasi tidak ditemukan"
                body={`Tidak ada aplikasi yang cocok dengan “${query.trim()}”. Coba kata kunci lain.`}
              />
            )}
          </div>
        </section>
      ) : (
        <div className="mt-7">
          <EmptyState
            icon="apps"
            title="Belum ada aplikasi"
            body="Belum ada akses aplikasi aktif untuk akun ini."
          />
        </div>
      )}
    </>
  );
}

function ApplicationGrid({ applications }: { applications: WorkspaceApplication[] }) {
  if (applications.length === 0) {
    return (
      <EmptyState
        icon="apps"
        title="Belum ada aplikasi"
        body="Belum ada akses aplikasi aktif untuk akun ini."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 lg:grid-cols-3 lg:gap-4">
      {applications.map((application) => (
        <ApplicationCard key={application.key} application={application} />
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: "apps" | "search";
  title: string;
  body: string;
}) {
  const Icon = icon === "search" ? Search : Grid2X2;
  return (
    <div className="rounded-2xl border border-dashed border-border bg-white px-5 py-9 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="mt-3 font-display text-lg font-bold text-brand-heading">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
