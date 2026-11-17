import { installLibsignalConsoleRedaction } from "./wa/libsignal-console-redaction.js";

// Before anything else loads Baileys: libsignal writes decryption failures to the console with the
// sender's JID in them (KIRIM-IMPL-005 §12). Installing the redaction first means no number can
// reach the log even during module initialization.
installLibsignalConsoleRedaction();

const { startWorker } = await import("./server.js");

const stop = await startWorker();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
