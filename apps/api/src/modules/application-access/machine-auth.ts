import { createRemoteJWKSet, customFetch, errors, jwtVerify } from "jose";

export const MACHINE_VERIFICATION_DEADLINE_MS = 3_000;
const JWKS_TRANSPORT_TIMEOUT_MS = 2_500;
/** One JWKS request may be sent twice: the original and a single transport retry. */
const JWKS_TRANSPORT_ATTEMPTS = 2;

interface ResolverGeneration {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  abort: AbortController;
}

export interface MachinePrincipal {
  clientId: string;
}

export type VerifyMachineToken = (token: string) => Promise<MachinePrincipal>;

export class MachineAuthError extends Error {
  constructor(
    public readonly code: "INVALID_TOKEN" | "FORBIDDEN_CLIENT",
    message: string,
  ) {
    super(message);
    this.name = "MachineAuthError";
  }
}

export function createKeycloakMachineTokenVerifier(input: {
  issuer: string;
  audience: string;
  /** "any" leaves the client check to the caller (Kirim SQ maps clients to kirim_consumers). */
  allowedClients: ReadonlySet<string> | "any";
  requiredScope?: string;
}): VerifyMachineToken {
  const issuer = input.issuer.replace(/\/$/, "");
  const jwksUrl = new URL(`${issuer}/protocol/openid-connect/certs`);
  let current: ResolverGeneration | undefined;

  function generation(): ResolverGeneration {
    if (current) return current;
    const abort = new AbortController();
    current = {
      abort,
      jwks: createRemoteJWKSet(jwksUrl, {
        timeoutDuration: JWKS_TRANSPORT_TIMEOUT_MS,
        [customFetch]: async (url, options) => {
          const signal = AbortSignal.any([
            abort.signal,
            ...(options.signal ? [options.signal] : []),
          ]);
          for (let attempt = 1; ; attempt++) {
            try {
              return await fetch(url, { ...options, signal });
            } catch (error) {
              // Keycloak and the load balancer in front of it close idle keep-alive
              // sockets. Writing a JWKS request to one that the peer has just closed
              // fails as a TypeError before any response exists: a transport fault,
              // not a verdict on the presented token. Resend once on the same signal,
              // so the pair of attempts still shares the transport timeout and the
              // caller's deadline. Never resend after an abort or a timeout, and never
              // for a request the server actually answered — a non-200 status or an
              // unparsable body is rejected by JOSE outside this hook.
              if (
                attempt >= JWKS_TRANSPORT_ATTEMPTS ||
                signal.aborted ||
                !(error instanceof TypeError)
              ) throw error;
            }
          }
        },
      }),
    };
    return current;
  }

  function discard(active: ResolverGeneration) {
    // An old timeout/completion must never discard a newer healthy generation.
    if (current === active) current = undefined;
    active.abort.abort();
  }

  return async (token: string) => {
    const active = generation();
    const started = performance.now();
    const deadlineError = new MachineAuthError("INVALID_TOKEN", "machine verification unavailable");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const { payload } = await Promise.race([
        jwtVerify(token, active.jwks, {
          issuer, audience: input.audience,
          ...(input.requiredScope ? { requiredClaims: ["exp"], algorithms: ["RS256"] } : {}),
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            discard(active);
            reject(deadlineError);
          }, MACHINE_VERIFICATION_DEADLINE_MS);
        }),
      ]);
      // Do not accept late work if the event loop delayed delivery of the timer.
      if (performance.now() - started >= MACHINE_VERIFICATION_DEADLINE_MS) {
        discard(active);
        throw deadlineError;
      }

      const clientId =
        typeof payload.azp === "string"
          ? payload.azp
          : typeof payload.client_id === "string"
            ? payload.client_id
            : null;

      if (!clientId || (input.allowedClients !== "any" && !input.allowedClients.has(clientId))) {
        throw new MachineAuthError("FORBIDDEN_CLIENT", "machine client is not allowed");
      }

      if (input.requiredScope && (
        typeof payload.scope !== "string" || !payload.scope.split(/\s+/).includes(input.requiredScope)
        || (typeof payload.azp === "string" && typeof payload.client_id === "string" && payload.azp !== payload.client_id)
      )) {
        throw new MachineAuthError("FORBIDDEN_CLIENT", "machine scope or client is not allowed");
      }

      return { clientId };
    } catch (error) {
      if (
        error instanceof errors.JWKSTimeout ||
        error instanceof errors.JWKSInvalid ||
        (error instanceof errors.JOSEError && error.code === "ERR_JOSE_GENERIC") ||
        error instanceof TypeError ||
        (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
      ) {
        discard(active);
      }
      if (error instanceof MachineAuthError) throw error;
      throw new MachineAuthError("INVALID_TOKEN", "machine token is invalid");
    } finally {
      clearTimeout(timer);
    }
  };
}

export function readBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token, extra] = authorizationHeader.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) return null;
  return token;
}
