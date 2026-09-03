import { ArrowUpRight, PanelsTopLeft } from "lucide-react";

import type { WorkspaceApplication } from "@/types";

interface ApplicationCardProps {
  application: WorkspaceApplication;
}

export function ApplicationCard({ application }: ApplicationCardProps) {
  return (
    <a
      href={application.canonicalUrl}
      className="group flex min-h-44 flex-col justify-between rounded-2xl border border-border/75 bg-white p-4 shadow-[var(--shadow-soft)] transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-primary/35 hover:shadow-[var(--shadow-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Buka ${application.name}`}
    >
      <div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep shadow-[var(--shadow-soft)]">
          <PanelsTopLeft className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/75">Aplikasi SQ</p>
        <h2 className="mt-1 font-display text-xl font-bold tracking-[-0.02em] text-brand-heading">{application.name}</h2>
        {application.description ? <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{application.description}</p> : null}
      </div>
      <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold text-brand-primary-deep">
        Buka aplikasi
        <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </a>
  );
}
