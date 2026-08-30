import ysqMark from "@/assets/brand/ysq-mark.png";

interface BrandLockupProps {
  compact?: boolean;
}

export function BrandLockup({ compact = false }: BrandLockupProps) {
  return (
    <div
      className={compact ? "flex min-w-0 items-center gap-2.5" : "flex min-w-0 items-start gap-3 px-2"}
      aria-label="SQ Hub · Yayasan Sabilul Qur'an"
    >
      <img
        src={ysqMark}
        alt=""
        className={compact ? "h-9 w-9 shrink-0 object-contain" : "h-11 w-11 shrink-0 object-contain"}
        aria-hidden="true"
      />
      <div className="min-w-0 pt-0.5">
        <p
          className={
            compact
              ? "truncate font-display text-[11px] font-bold leading-tight text-brand-heading"
              : "font-display text-sm font-bold leading-[1.25] tracking-[-0.01em] text-brand-heading"
          }
        >
          SQ Hub
        </p>
        <p
          className={
            compact
              ? "mt-0.5 truncate text-[9px] font-semibold text-muted-foreground"
              : "mt-1 text-[10px] font-semibold leading-4 text-muted-foreground"
          }
        >
          Yayasan Sabilul Qur&apos;an
        </p>
      </div>
    </div>
  );
}
