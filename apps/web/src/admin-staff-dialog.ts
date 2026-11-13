import { useCallback, useEffect, useState } from "react";

import { useDialogParam } from "@/components/useDialogParam";
import type { AdminStaff } from "@/types";

/** URL parameter of the person pop-up on the admin screens that pick a person. */
export const STAFF_DIALOG_PARAM = "orang";

export type StaffDialogStatus = "closed" | "loading" | "ready" | "missing" | "error";

function sameUsername(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Finds the person behind `?orang=<username>`. The URL carries the Akun SQ username (NIP, or the
 * e-mail for staff without NIP) and never the raw OIDC subject, which the UI does not show. The
 * person comes from the results already on screen or from the existing directory search, matched
 * on the exact username.
 */
export async function findStaffByUsername(
  fetchJson: <T>(url: string) => Promise<T>,
  username: string,
  known: AdminStaff[],
): Promise<AdminStaff | null> {
  const listed = known.find((entry) => sameUsername(entry.username, username));
  if (listed) return listed;
  const body = await fetchJson<{ staff: AdminStaff[] }>(`/api/admin/staff?q=${encodeURIComponent(username)}`);
  return body.staff.find((entry) => sameUsername(entry.username, username)) ?? null;
}

/**
 * The person pop-up of an admin screen: `?orang=<username>` in the URL (so links and Back work),
 * resolved to the person once. `open` takes a person from the search results.
 */
export function useStaffDialog({
  fetchJson,
  known,
  enabled = true,
}: {
  fetchJson: <T>(url: string) => Promise<T>;
  known: AdminStaff[];
  enabled?: boolean;
}) {
  const [username, openParam, close] = useDialogParam(STAFF_DIALOG_PARAM);
  const [resolved, setResolved] = useState<{ username: string; staff: AdminStaff | null; failed: boolean } | null>(null);

  const open = useCallback((staff: AdminStaff) => {
    setResolved({ username: staff.username, staff, failed: false });
    openParam(staff.username);
  }, [openParam]);

  const resolvedUsername = resolved?.username ?? null;
  useEffect(() => {
    if (!enabled || !username || resolvedUsername === username) return;
    let cancelled = false;
    findStaffByUsername(fetchJson, username, known).then(
      (staff) => { if (!cancelled) setResolved({ username, staff, failed: false }); },
      () => { if (!cancelled) setResolved({ username, staff: null, failed: true }); },
    );
    return () => { cancelled = true; };
    // Resolve once per username; the fetcher and the result list are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, username, resolvedUsername]);

  const current = username && resolved?.username === username ? resolved : null;
  const status: StaffDialogStatus = !username
    ? "closed"
    : !current
      ? "loading"
      : current.staff
        ? "ready"
        : current.failed
          ? "error"
          : "missing";

  return { username, staff: current?.staff ?? null, status, open, close };
}
