import { AppWindow, Home, ShieldEllipsis, UserRound } from "lucide-react";

type MobileRoute = "home" | "apps" | "account" | "admin";

interface MobileNavigationProps {
  active: MobileRoute;
  platformAdministration: boolean;
}

export function MobileNavigation({
  active,
  platformAdministration,
}: MobileNavigationProps) {
  return (
    <nav
      aria-label="Navigasi mobile SQ Hub"
      className="fixed inset-x-3 z-40 flex rounded-2xl border border-border/80 bg-white/98 p-1.5 shadow-[var(--shadow-raised)] backdrop-blur lg:hidden"
      style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <MobileLink href="/" label="Beranda" icon={Home} active={active === "home"} />
      <MobileLink href="/apps" label="Aplikasi" icon={AppWindow} active={active === "apps"} />
      <MobileLink href="/account" label="Akun" icon={UserRound} active={active === "account"} />
      {platformAdministration ? (
        <MobileLink href="/admin" label="Admin" icon={ShieldEllipsis} active={active === "admin"} />
      ) : null}
    </nav>
  );
}

function MobileLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: typeof Home;
  active: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-brand-primary-pale text-brand-primary-deep" : "text-muted-foreground",
      ].join(" ")}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </a>
  );
}
