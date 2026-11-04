import type { FastifyInstance } from "fastify";

import { invalidRequestFields, invalidRequestIssues } from "../../invalid-request.js";
import {
  MachineAuthError,
  readBearerToken,
  type VerifyMachineToken,
} from "../application-access/machine-auth.js";
import { IdentityManagementError } from "../identity-management/client.js";
import { EmployeeVerificationError } from "./hcis-client.js";
import { hcisInviteSchema, type StaffLifecycleService } from "./service.js";

export const HCIS_INVITE_PATH = "/internal/v1/staff-activation/invite";

/**
 * HUB-IMPL-024: HCIS asks SQ Hub to prepare an employee's Akun SQ and HCIS access. Only clients in
 * STAFF_ACTIVATION_ALLOWED_CLIENTS pass `verifyMachineToken`; the body carries the NIP and the
 * asking HCIS account only. Nothing from the body is logged.
 */
export function registerHcisInviteRoute(
  app: FastifyInstance,
  input: {
    verifyMachineToken: VerifyMachineToken;
    service: Pick<StaffLifecycleService, "inviteFromHcis">;
  },
) {
  app.post(HCIS_INVITE_PATH, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const token = readBearerToken(request.headers.authorization);
    if (!token) return reply.code(401).send({ error: "UNAUTHENTICATED" });

    let clientId: string;
    try {
      clientId = (await input.verifyMachineToken(token)).clientId;
    } catch (error) {
      if (error instanceof MachineAuthError) {
        return reply.code(error.code === "FORBIDDEN_CLIENT" ? 403 : 401).send({ error: error.code });
      }
      throw error;
    }

    const parsed = hcisInviteSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn(
        { category: "internal_invalid_request", issues: invalidRequestIssues(parsed.error) },
        "staff activation invite body rejected",
      );
      return reply.code(400).send({ error: "INVALID_REQUEST", fields: invalidRequestFields(parsed.error) });
    }

    try {
      return reply.code(200).send(await input.service.inviteFromHcis(parsed.data, clientId));
    } catch (error) {
      const mapped = mapInviteError(error);
      if (mapped.status >= 500) request.log.warn({ category: "staff_activation_invite", error: mapped.error }, "staff activation invite failed");
      return reply.code(mapped.status).send({ error: mapped.error });
    }
  });
}

function mapInviteError(error: unknown): { status: number; error: string } {
  if (error instanceof EmployeeVerificationError) {
    if (error.code === "NOT_FOUND") return { status: 404, error: "HCIS_EMPLOYEE_NOT_FOUND" };
    if (error.code === "NOT_ACTIVE" || error.code === "INVALID_CONTACT") {
      return { status: 409, error: `HCIS_EMPLOYEE_${error.code}` };
    }
    return { status: 503, error: "HCIS_VERIFY_UNAVAILABLE" };
  }
  if (error instanceof IdentityManagementError) {
    if (error.code === "DUPLICATE_USERNAME" || error.code === "DUPLICATE_EMAIL") return { status: 409, error: error.code };
    return { status: 503, error: "IDENTITY_MANAGEMENT_UNAVAILABLE" };
  }
  if (error instanceof Error && [
    "EMPLOYEE_IDENTITY_CONFLICT", "STAFF_IDENTITY_DISABLED", "ORGAN_IDENTITY_LINK_REQUIRES_ADMIN",
  ].includes(error.message)) {
    return { status: 409, error: error.message };
  }
  return { status: 503, error: "STAFF_LIFECYCLE_UNAVAILABLE" };
}
