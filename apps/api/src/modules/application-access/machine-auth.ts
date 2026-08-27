import { createRemoteJWKSet, jwtVerify } from "jose";

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
  allowedClients: ReadonlySet<string>;
}): VerifyMachineToken {
  const issuer = input.issuer.replace(/\/$/, "");
  const jwks = createRemoteJWKSet(
    new URL(`${issuer}/protocol/openid-connect/certs`),
  );

  return async (token: string) => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: input.audience,
      });

      const clientId =
        typeof payload.azp === "string"
          ? payload.azp
          : typeof payload.client_id === "string"
            ? payload.client_id
            : null;

      if (!clientId || !input.allowedClients.has(clientId)) {
        throw new MachineAuthError("FORBIDDEN_CLIENT", "machine client is not allowed");
      }

      return { clientId };
    } catch (error) {
      if (error instanceof MachineAuthError) throw error;
      throw new MachineAuthError("INVALID_TOKEN", "machine token is invalid");
    }
  };
}

export function readBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token, extra] = authorizationHeader.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) return null;
  return token;
}
