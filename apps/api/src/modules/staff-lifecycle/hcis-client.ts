import * as oidc from "openid-client";
import { z } from "zod";

const employeeSchema = z.object({
  employeeId: z.string().regex(/^hcis:employee:[0-9a-f-]{36}$/i),
  employeeNumber: z.string().min(1).max(80),
  displayName: z.string().min(1).max(255),
  email: z.string().email().nullable(),
  status: z.enum(["active", "inactive", "resigned"]),
  verifiedAt: z.string().datetime(),
}).strict();

export type VerifiedEmployee = z.infer<typeof employeeSchema>;
export type VerifyEmployee = (employeeNumber: string) => Promise<VerifiedEmployee>;

export class EmployeeVerificationError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "NOT_ACTIVE" | "UNAVAILABLE" | "INVALID_CONTACT") {
    super(code);
  }
}

export function createHcisEmployeeVerifier(config: {
  issuer: string; hcisBaseUrl: string; clientId: string; clientSecret: string;
}): VerifyEmployee {
  const issuer = config.issuer.replace(/\/$/, "");
  const oauth = new oidc.Configuration(
    { issuer, token_endpoint: `${issuer}/protocol/openid-connect/token` },
    config.clientId,
    config.clientSecret,
  );
  oauth.timeout = 10;
  return async (employeeNumber) => {
    let token: string;
    try {
      token = (await oidc.clientCredentialsGrant(oauth, { scope: "staff-identity.verify" })).access_token;
    } catch {
      throw new EmployeeVerificationError("UNAVAILABLE");
    }
    let response: Response;
    try {
      response = await fetch(new URL("internal/v1/staff-identity/verify-employee", `${config.hcisBaseUrl.replace(/\/$/, "")}/`), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ employeeNumber }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new EmployeeVerificationError("UNAVAILABLE");
    }
    if (response.status === 404) throw new EmployeeVerificationError("NOT_FOUND");
    if (!response.ok) throw new EmployeeVerificationError("UNAVAILABLE");
    if (!response.headers.get("content-type")?.includes("application/json") || !response.body) {
      throw new EmployeeVerificationError("UNAVAILABLE");
    }
    let parsed: VerifiedEmployee;
    try {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 8192) throw new Error("response too large");
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      parsed = employeeSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw new EmployeeVerificationError("UNAVAILABLE");
    }
    if (parsed.employeeNumber !== employeeNumber) throw new EmployeeVerificationError("UNAVAILABLE");
    if (parsed.status !== "active") throw new EmployeeVerificationError("NOT_ACTIVE");
    if (!parsed.email) throw new EmployeeVerificationError("INVALID_CONTACT");
    return parsed;
  };
}
