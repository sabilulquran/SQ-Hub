import { ArrowUpRight, PanelsTopLeft } from "lucide-react";

import type { WorkspaceApplication } from "@/types";

interface ApplicationCardProps {
  application: WorkspaceApplication;
}

export function ApplicationCard({ application }: ApplicationCardProps) {
  return (
    <a
      href={application.canonicalUrl}
      className="group flex min-h-48 flex-col justify-between rounded-3xl border border-border/75 bg-surface-raised p-5 shadow-[var(--shadow-soft)] transition duration-200 hover:-translate-y-0.5 hover:border-brand-primary/45 hover:shadow-[var(--shadow-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Buka ${application.name}`}
    >
      <div>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-primary-pale text-brand-primary-deep ring-1 ring-brand-primary/10">
          <PanelsTopLeft className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-primary-deep">
          Aplikasi SQ
        </p>
        <h3 className="mt-1 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading">
          {application.name}
        </h3>
        {application.description ? (
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {application.description}
          </p>
        ) : null}
      </div>

      <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-brand-primary-deep">
        Buka aplikasi
        <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </a>
  );
}
