import { jakartaBusinessDate } from "./validation.js";
import type { SyncAttempt } from "./repository.js";

// One full reconciliation per run. All failures retry only at the normal cadence;
// there is no aggressive auth/schema/4xx retry and no network call in read paths.
export function startDirectoryScheduler(input: {
  reconcile: (asOf: string) => Promise<SyncAttempt | null>;
  report: (attempt: SyncAttempt | { result: "FAILED"; errorCategory: "storage" }) => void;
  now?: () => Date;
}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  function run() {
    inFlight = (async () => {
      try {
        const result = await input.reconcile(jakartaBusinessDate((input.now ?? (() => new Date()))()));
        if (result) input.report(result);
        if (result?.errorCategory === "source_request") stopped = true;
      } catch { input.report({ result: "FAILED", errorCategory: "storage" }); }
      if (!stopped) { timer = setTimeout(run, 300_000); timer.unref(); }
    })();
  }
  run();
  return async () => { stopped = true; clearTimeout(timer); await inFlight; };
}
