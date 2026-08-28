import ysqMark from "@/assets/brand/ysq-mark.png";

interface BrandLockupProps {
  compact?: boolean;
}

export function BrandLockup({ compact = false }: BrandLockupProps) {
  return (
    <div className="flex min-w-0 items-center gap-3" aria-label="SQ Hub · Yayasan Sabilul Qur'an">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-[var(--shadow-soft)] ring-1 ring-border/70">
        <img src={ysqMark} alt="" className="h-8 w-8 object-contain" aria-hidden="true" />
      </span>
      <span className={compact ? "hidden min-w-0 sm:block" : "min-w-0"}>
        <span className="block truncate font-display text-xl font-bold tracking-[-0.02em] text-brand-heading">
          SQ Hub
        </span>
        <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Yayasan Sabilul Qur&apos;an
        </span>
      </span>
    </div>
  );
}
