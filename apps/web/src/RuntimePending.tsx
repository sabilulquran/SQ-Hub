import { LockKeyhole } from "lucide-react";

import { BrandLockup } from "@/components/BrandLockup";

export function RuntimePending() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-xl rounded-[2rem] border border-border/75 bg-white p-6 text-center shadow-[var(--shadow-raised)] sm:p-9">
        <div className="flex justify-center">
          <BrandLockup />
        </div>
        <div className="mx-auto mt-8 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-primary-pale text-brand-primary-deep">
          <LockKeyhole className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold tracking-[-0.025em] text-brand-heading sm:text-3xl">
          Workspace sedang disambungkan ke Akun SQ
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Visual foundation SQ Hub sudah tersedia. Launcher staf baru akan diaktifkan setelah sesi OIDC server-side dan Application Access terverifikasi di staging.
        </p>
      </div>
    </main>
  );
}
