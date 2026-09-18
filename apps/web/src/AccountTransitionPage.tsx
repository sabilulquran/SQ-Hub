import { ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect } from "react";

import { GlobalHeader } from "@/components/GlobalHeader";
import { MobileNavigation } from "@/components/MobileNavigation";
import type { WorkspaceSnapshot } from "@/types";

interface AccountTransitionPageProps {
  workspace: WorkspaceSnapshot;
  onLogout?: () => void | Promise<void>;
  preview?: boolean;
}

const accountEndpoint = "/api/account";

export function AccountTransitionPage({
  workspace,
  onLogout,
  preview = false,
}: AccountTransitionPageProps) {
  useEffect(() => {
    if (!preview) window.location.assign(accountEndpoint);
  }, [preview]);

  return (
    <div className="min-h-screen bg-surface text-foreground">
      <GlobalHeader workspace={workspace} onLogout={onLogout} />
      <main className="mx-auto flex max-w-7xl items-start justify-center px-4 pb-32 pt-16 sm:px-6 sm:pt-24 lg:px-8 lg:pb-12">
        <section
          aria-labelledby="account-transition-heading"
          className="w-full max-w-md rounded-2xl border border-border bg-white p-6 text-center shadow-[var(--shadow-soft)] sm:p-8"
        >
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-primary-pale text-brand-primary-deep">
            <LoaderCircle className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          </span>
          <h1
            id="account-transition-heading"
            className="mt-4 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading"
          >
            Membuka Akun SQ…
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Anda akan diarahkan ke pengaturan akun dan keamanan.
          </p>
          <a
            href={accountEndpoint}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-bold text-white shadow-[var(--shadow-button)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Buka Akun SQ
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </section>
      </main>
      <MobileNavigation
        active="account"
        platformAdministration={workspace.capabilities.platformAdministration}
      />
    </div>
  );
}
