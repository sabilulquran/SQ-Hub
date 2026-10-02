import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ActorRef, IdentityRef } from "../application-access/types.js";
import type { OffboardingStep } from "./service.js";

export interface LifecycleOperation {
  id: string;
  status: "IN_PROGRESS" | "PARTIAL_FAILURE" | "COMPLETED";
  steps: OffboardingStep[];
}

export interface LifecycleOperationStore {
  withIdentityLock<T>(identity: IdentityRef, task: (locked: LockedLifecycleOperation) => Promise<T>): Promise<T>;
}

export interface LockedLifecycleOperation {
  begin(actor: ActorRef, reason: string): Promise<LifecycleOperation>;
  update(operation: LifecycleOperation): Promise<void>;
}

export class PgLifecycleOperationStore implements LifecycleOperationStore {
  constructor(private readonly pool: Pool) {}

  async withIdentityLock<T>(identity: IdentityRef, task: (locked: LockedLifecycleOperation) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const lockKey = `${identity.issuer}\n${identity.subject}`;
    try {
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired",
        ["staff_lifecycle", lockKey],
      );
      if (!lock.rows[0]?.acquired) throw new Error("LIFECYCLE_OPERATION_BUSY");
      try { return await task({
        begin: (actor, reason) => this.begin(client, identity, actor, reason),
        update: (operation) => this.update(client, identity, operation),
      }); }
      finally {
        await client.query("SELECT pg_advisory_unlock(hashtext($1), hashtext($2))", ["staff_lifecycle", lockKey]);
      }
    } finally { client.release(); }
  }

  private async begin(client: PoolClient, identity: IdentityRef, actor: ActorRef, reason: string): Promise<LifecycleOperation> {
    const prior = await client.query<{ id: string; status: LifecycleOperation["status"]; steps: OffboardingStep[] }>(
      "SELECT id, status, steps FROM staff_lifecycle_operations WHERE identity_issuer=$1 AND identity_subject=$2",
      [identity.issuer, identity.subject],
    );
    const row = prior.rows[0];
    if (row && row.status !== "COMPLETED") return { id: row.id, status: row.status, steps: row.steps };
    const id = randomUUID();
    await client.query(
      `INSERT INTO staff_lifecycle_operations (id, identity_issuer, identity_subject, status, steps, actor_ref, reason)
       VALUES ($1,$2,$3,'IN_PROGRESS','[]'::jsonb,$4,$5)
       ON CONFLICT (identity_issuer, identity_subject) DO UPDATE
       SET id=EXCLUDED.id, status='IN_PROGRESS', steps='[]'::jsonb, actor_ref=EXCLUDED.actor_ref,
           reason=EXCLUDED.reason, created_at=now(), updated_at=now()`,
      [id, identity.issuer, identity.subject, actor.ref, reason],
    );
    return { id, status: "IN_PROGRESS", steps: [] };
  }

  private async update(client: PoolClient, identity: IdentityRef, operation: LifecycleOperation): Promise<void> {
    await client.query(
      `UPDATE staff_lifecycle_operations SET status=$1, steps=$2::jsonb, updated_at=now()
       WHERE id=$3 AND identity_issuer=$4 AND identity_subject=$5`,
      [operation.status, JSON.stringify(operation.steps), operation.id, identity.issuer, identity.subject],
    );
  }

}
