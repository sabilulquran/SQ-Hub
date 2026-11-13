import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

import { DetailDialog } from "@/components/DetailDialog";
import type { Papan } from "@/kerja/api";
import { KartuPanel } from "@/kerja/KartuPanel";

/**
 * A card opens as a pop-up over the current page (sq-core-app-shell.md "Detail views open as a
 * pop-up"). The open card is `?kartu=<id>` on the current path, so links and Back work.
 */
export function openCard(kartuId: string | null): void {
  const url = new URL(window.location.href);
  if (kartuId) url.searchParams.set("kartu", kartuId);
  else url.searchParams.delete("kartu");
  if (kartuId) window.history.pushState({ kartu: kartuId }, "", url);
  else window.history.replaceState({}, "", url);
  window.dispatchEvent(new Event("kerja:kartu"));
}

export function useOpenCard(): string | null {
  const read = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("kartu"));
  const [kartuId, setKartuId] = useState<string | null>(read);
  useEffect(() => {
    const sync = () => setKartuId(read());
    window.addEventListener("popstate", sync);
    window.addEventListener("kerja:kartu", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("kerja:kartu", sync);
    };
  }, []);
  return kartuId;
}

/** Closing goes Back when the dialog was opened in this page, so Back and the close button agree. */
function closeCard(): void {
  if ((window.history.state as { kartu?: string } | null)?.kartu) window.history.back();
  else openCard(null);
}

export function CardDialog({ papan, onChanged }: { papan?: Papan | null; onChanged?: () => void }) {
  const kartuId = useOpenCard();
  if (!kartuId) return null;
  return (
    <DetailDialog label="Kartu" onClose={closeCard}>
      <KartuPanel key={kartuId} kartuId={kartuId} papan={papan ?? null} onClose={closeCard} {...(onChanged ? { onChanged } : {})} />
    </DetailDialog>
  );
}

/** A link that opens a card as a pop-up; middle-click and copy-link still give a real URL. */
export function CardLink({ kartuId, className, children }: { kartuId: string; className?: string; children: ReactNode }) {
  const href = (() => {
    if (typeof window === "undefined") return `?kartu=${kartuId}`;
    const url = new URL(window.location.href);
    url.searchParams.set("kartu", kartuId);
    return `${url.pathname}${url.search}`;
  })();
  return (
    <a
      href={href}
      className={className}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openCard(kartuId);
      }}
    >
      {children}
    </a>
  );
}
