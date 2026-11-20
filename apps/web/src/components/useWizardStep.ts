import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { DIALOG_PARAM_EVENT } from "@/components/useDialogParam";

/** UX-FLOW-001 rule 2: the step of a page-level flow lives in `?langkah=`. */
export const WIZARD_STEP_PARAM = "langkah";

/** The step named by `search`, or the first step when the value is missing or unknown. */
export function readWizardStep<S extends string>(search: string, steps: readonly S[]): S {
  const raw = new URLSearchParams(search).get(WIZARD_STEP_PARAM);
  return raw !== null && (steps as readonly string[]).includes(raw) ? (raw as S) : steps[0]!;
}

/**
 * UX-FLOW-001 (docs/design/sq-step-flow.md): one step per screen for a flow on a full page.
 * The step lives in `?langkah=<name>` (the first step writes no query), so the browser's or
 * Android's Back goes back one step and the page keeps its in-memory entries. This app has no
 * router: like useDialogParam it uses pushState/replaceState and listens to popstate plus the
 * shared same-tab event, and keeps every other query parameter (for example `?nomor=`).
 * Each step change after the first render scrolls `scrollTarget` (or the window) to its top.
 * Behaviour ported from HCIS `apps/web/src/lib/useWizardStep.ts`.
 */
export function useWizardStep<S extends string>(steps: readonly S[], scrollTarget?: RefObject<HTMLElement | null>) {
  const first = steps[0]!;
  const read = useCallback(
    () => (typeof window === "undefined" ? first : readWizardStep(window.location.search, steps)),
    // `steps` is a module-level constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [first],
  );
  const [step, setStep] = useState<S>(read);

  useEffect(() => {
    const sync = () => setStep(read());
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener(DIALOG_PARAM_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(DIALOG_PARAM_EVENT, sync);
    };
  }, [read]);

  const goTo = useCallback((next: S, options: { replace?: boolean } = {}) => {
    const url = new URL(window.location.href);
    if (next === first) url.searchParams.delete(WIZARD_STEP_PARAM);
    else url.searchParams.set(WIZARD_STEP_PARAM, next);
    // A wizard entry is never a pop-up entry, so useDialogParam's close does not treat it as one.
    const state: Record<string, unknown> = { ...((window.history.state as Record<string, unknown> | null) ?? {}) };
    delete state.dialog;
    if (options.replace) window.history.replaceState(state, "", url);
    else window.history.pushState(state, "", url);
    window.dispatchEvent(new Event(DIALOG_PARAM_EVENT));
  }, [first]);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const target = scrollTarget?.current;
    if (target) {
      const top = target.getBoundingClientRect().top + window.scrollY - 16;
      if (top < window.scrollY) window.scrollTo({ top: Math.max(0, top) });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [step, scrollTarget]);

  return { step, index: steps.indexOf(step), goTo };
}
