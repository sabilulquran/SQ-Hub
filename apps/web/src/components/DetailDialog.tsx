import { useEffect, useRef, type ReactNode } from "react";

/**
 * docs/design/sq-core-app-shell.md "Detail views open as a pop-up": an item's detail or edit form
 * opens on top of the page and never changes its layout. Centred dialog from 768 px, full-screen
 * sheet below. Escape, the backdrop and the caller's close button close it; focus returns to the
 * element that opened it, and the page behind does not scroll.
 */
export function DetailDialog({
  label,
  onClose,
  wide = false,
  children,
}: {
  /** Accessible name; usually the item's title. */
  label: string;
  onClose: () => void;
  /** Up to 960 px instead of 720 px, for wide content such as tables. */
  wide?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A dialog stacked inside (for example a reason prompt) handles its own Escape first.
      if (document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 1) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:items-start sm:p-6 md:p-10" role="presentation">
      <button type="button" aria-label="Tutup" tabIndex={-1} className="absolute inset-0 h-full w-full cursor-default bg-black/45" onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`relative flex h-full w-full flex-col overflow-y-auto bg-surface-raised p-4 shadow-[var(--shadow-raised)] outline-none sm:h-auto sm:max-h-[90vh] sm:rounded-2xl sm:p-6 ${wide ? "sm:max-w-[960px]" : "sm:max-w-[720px]"}`}
      >
        {children}
      </div>
    </div>
  );
}
