import { Loader2 } from "lucide-react";

/** HUB-IMPL-005 Rev 2: shown while the one automatic sign-in retry leaves for Akun SQ. */
export function SignInHandOff() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-5 py-10">
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Membuka Akun SQ…
      </div>
    </main>
  );
}
