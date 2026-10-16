import { Ellipsis, type LucideIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { navigationItems, type HubNavItem, type HubNavKey } from "@/components/shellNavigation";
import { SpaceSwitcher, type HubSpace } from "@/components/SpaceSwitcher";
import { useDismiss } from "@/components/useDismiss";

interface MobileNavigationProps {
  space: HubSpace;
  active: HubNavKey;
  platformAdministration: boolean;
  previewMoreOpen?: boolean;
}

const MAX_DESTINATIONS = 5;

/**
 * Phone bottom navigation (below 768 px): at most five destinations, the last
 * one "Lainnya" with Pindah ruang and the remaining items (docs/design/sq-core-app-shell.md).
 */
export function MobileNavigation({
  space,
  active,
  platformAdministration,
  previewMoreOpen = false,
}: MobileNavigationProps) {
  const [moreOpen, setMoreOpen] = useState(previewMoreOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setMoreOpen(false), []);
  useDismiss(moreOpen, close, rootRef, triggerRef);

  const items = navigationItems(space);
  const needsMore = platformAdministration || items.length > MAX_DESTINATIONS;
  const direct = needsMore ? items.slice(0, MAX_DESTINATIONS - 1) : items;
  const overflow = needsMore ? items.slice(MAX_DESTINATIONS - 1) : [];
  const moreActive = overflow.some((item) => item.key === active);

  return (
    <div ref={rootRef} className="md:hidden">
      <nav
        aria-label="Navigasi mobile SQ Hub"
        className="fixed inset-x-3 z-40 flex rounded-2xl border border-border/80 bg-surface-raised p-1.5 shadow-[var(--shadow-raised)]"
        style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {direct.map((item) => (
          <MobileLink key={item.key} item={item} active={item.key === active} />
        ))}
        {needsMore ? (
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((value) => !value)}
            className={tabClass(moreActive || moreOpen)}
          >
            <Ellipsis className="h-[18px] w-[18px]" aria-hidden="true" />
            <span className="truncate">Lainnya</span>
          </button>
        ) : null}
      </nav>

      {moreOpen ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={close}
            className="fixed inset-0 z-[60] cursor-default bg-black/35"
          />
          <div
            role="dialog"
            aria-label="Lainnya"
            className="fixed inset-x-0 bottom-0 z-[60] rounded-t-3xl border border-border/80 bg-surface-raised p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-raised)]"
          >
            <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-border" aria-hidden="true" />
            {platformAdministration ? (
              <section aria-label="Pindah ruang">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Pindah ruang</p>
                <SpaceSwitcher space={space} />
              </section>
            ) : null}
            {overflow.length > 0 ? (
              <ul className="mt-4 space-y-1">
                {overflow.map((item) => (
                  <li key={item.key}>
                    <SheetLink item={item} active={item.key === active} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function tabClass(active: boolean) {
  return [
    "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active ? "bg-brand-primary-pale text-brand-primary-deep" : "text-muted-foreground",
  ].join(" ");
}

function MobileLink({ item, active }: { item: HubNavItem; active: boolean }) {
  const Icon: LucideIcon = item.icon;
  return (
    <a href={item.href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      <span className="truncate">{item.shortLabel}</span>
    </a>
  );
}

function SheetLink({ item, active }: { item: HubNavItem; active: boolean }) {
  const Icon: LucideIcon = item.icon;
  return (
    <a
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={[
        "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-brand-primary-pale text-brand-primary-deep" : "text-foreground hover:bg-muted",
      ].join(" ")}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      {item.label}
    </a>
  );
}
