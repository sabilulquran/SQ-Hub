type ConsoleMethod = (...args: unknown[]) => void;

type ConsoleTarget = {
  info: ConsoleMethod;
  warn: ConsoleMethod;
};

const LIBSIGNAL_SESSION_DIAGNOSTIC_PREFIXES = [
  "Closing session:",
  "Opening session:",
  "Removing old closed session:",
  "Session already closed",
  "Session already open",
  "Closing stale open session for new outgoing prekey bundle",
  "Closing open session in favor of incoming prekey bundle",
] as const;

/**
 * Legacy libsignal writes ratchet/session objects directly to the process console,
 * bypassing the logger supplied to Baileys. Some of those objects contain private
 * ratchet material. Suppress only those exact library diagnostics; application
 * logging and every unrelated console message continue unchanged.
 */
export function isSensitiveLibsignalDiagnostic(args: unknown[]): boolean {
  const first = args[0];
  if (typeof first !== "string") return false;
  return LIBSIGNAL_SESSION_DIAGNOSTIC_PREFIXES.some((prefix) => first.startsWith(prefix));
}

export function installLibsignalConsoleRedaction(target: ConsoleTarget = console): () => void {
  const originalInfo = target.info.bind(target);
  const originalWarn = target.warn.bind(target);

  target.info = (...args: unknown[]) => {
    if (!isSensitiveLibsignalDiagnostic(args)) originalInfo(...args);
  };
  target.warn = (...args: unknown[]) => {
    if (!isSensitiveLibsignalDiagnostic(args)) originalWarn(...args);
  };

  return () => {
    target.info = originalInfo;
    target.warn = originalWarn;
  };
}
