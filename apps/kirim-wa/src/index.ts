import { installLibsignalConsoleRedaction } from "./wa/libsignal-console-redaction.js";

// Before anything else loads Baileys: legacy libsignal writes session and ratchet objects straight
// to the process console, bypassing the logger Baileys is given, and some of them carry private
// ratchet material (KIRIM-IMPL-005 §12). Installing the redaction first means none of it can reach
// the log, not even while modules are still initializing.
installLibsignalConsoleRedaction();

const { startWorker } = await import("./server.js");

const worker = await startWorker();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void worker.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
