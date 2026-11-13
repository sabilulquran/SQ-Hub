import { useCallback, useEffect, useState } from "react";

/** Fired after this hook changes the URL itself; pushState and replaceState do not fire popstate. */
export const DIALOG_PARAM_EVENT = "sq:dialog-param";

export function readDialogParam(name: string): string | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name);
}

/**
 * docs/design/sq-core-app-shell.md "Detail views open as a pop-up": the open item lives in the URL
 * (`?<name>=<value>`), so a link opens the same pop-up and the browser's Back closes it.
 * Returns the current value plus functions to open and close it.
 */
export function useDialogParam(name: string): [string | null, (value: string) => void, () => void] {
  const [value, setValue] = useState<string | null>(() => readDialogParam(name));

  useEffect(() => {
    const sync = () => setValue(readDialogParam(name));
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener(DIALOG_PARAM_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(DIALOG_PARAM_EVENT, sync);
    };
  }, [name]);

  const open = useCallback((next: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(name, next);
    window.history.pushState({ ...(window.history.state as object | null), dialog: name }, "", url);
    window.dispatchEvent(new Event(DIALOG_PARAM_EVENT));
  }, [name]);

  // Closing goes Back when the pop-up was opened on this page, so Back and the close button agree.
  // A pop-up reached by a link has no entry of its own to go back to, so the parameter is removed.
  const close = useCallback(() => {
    if ((window.history.state as { dialog?: string } | null)?.dialog === name) {
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event(DIALOG_PARAM_EVENT));
  }, [name]);

  return [value, open, close];
}
