import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { ActorRef, IdentityRef } from "../application-access/types.js";

export type LifecycleAuditOutcome = "succeeded" | "failed" | "noop";

export interface LifecycleAuditWriter {
  write(input: {
    actor: ActorRef;
    action: string;
    identity?: IdentityRef;
    targetHint?: string;
    outcome: LifecycleAuditOutcome;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export class PgLifecycleAuditWriter implements LifecycleAuditWriter {
  constructor(private readonly pool: Pool) {}

  async write(input: {
    actor: ActorRef;
    action: string;
    identity?: IdentityRef;
    targetHint?: string;
    outcome: LifecycleAuditOutcome;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const targetRef = input.identity
      ? lifecycleTargetRef(input.identity)
      : `staff-lifecycle:${createHash("sha256").update(input.targetHint ?? "unknown").digest("hex")}`;
    await this.pool.query(
      `
        INSERT INTO platform_audit_events (
          id, actor_kind, actor_ref, action, target_type, target_ref, outcome, payload
        ) VALUES ($1, $2, $3, $4, 'staff_identity', $5, $6, $7::jsonb)
      `,
      [
        randomUUID(),
        input.actor.kind,
        input.actor.ref,
        input.action,
        targetRef,
        input.outcome,
        JSON.stringify(input.payload),
      ],
    );
  }
}

export function lifecycleTargetRef(identity: IdentityRef): string {
  return `staff-identity:${createHash("sha256")
    .update(`${identity.issuer}\n${identity.subject}`)
    .digest("hex")}`;
}
