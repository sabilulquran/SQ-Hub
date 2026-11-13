import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * docs/design/sq-core-app-shell.md "Detail views open as a pop-up": an item's detail or edit form
 * opens on top of the page and never changes its layout. Centred dialog up to 720 px (960 px when
 * `wide`) from 768 px, full-screen sheet below. Escape, the backdrop and the close button close it;
 * focus moves in on open and returns to the element that opened it on close, Tab stays inside,
 * and the page behind does not scroll.
 *
 * With `title` the dialog draws its own header with the title and a close button. Without it (for
 * example Kerja's card, which has its own header and close button) only `label` names the dialog
 * and the content is padded as is.
 */
export function DetailDialog({
  title,
  description,
  label,
  onClose,
  wide = false,
  children,
}: {
  /** Heading and accessible name; usually the item's name. Draws the built-in header. */
  title?: string;
  description?: ReactNode;
  /** Accessible name when there is no `title`. */
  label?: string;
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
      const panel = panelRef.current;
      if (!panel || event.defaultPrevented) return;
      // A dialog stacked on top (for example a reason prompt) handles its own keys first.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panel) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const inside = panel.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center md:items-start md:p-10" role="presentation">
      <button type="button" aria-label="Tutup" tabIndex={-1} className="absolute inset-0 h-full w-full cursor-default bg-black/45" onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? label}
        tabIndex={-1}
        className={`relative flex h-full w-full flex-col overflow-y-auto bg-surface-raised shadow-[var(--shadow-raised)] outline-none md:h-auto md:max-h-[90vh] md:rounded-2xl ${title ? "" : "p-4 md:p-6"} ${wide ? "md:max-w-[960px]" : "md:max-w-[720px]"}`}
      >
        {title ? (
          <>
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-surface-raised px-4 py-3 md:px-6 md:py-4">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold text-brand-heading">{title}</h2>
                {description ? <div className="mt-0.5 text-sm text-muted-foreground">{description}</div> : null}
              </div>
              <button
                type="button"
                onClick={() => closeRef.current()}
                aria-label="Tutup"
                className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <div className="px-4 py-4 md:px-6 md:py-5">{children}</div>
          </>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
