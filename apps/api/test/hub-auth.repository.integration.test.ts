import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { PgHubAuthRepository } from "../src/modules/hub-auth/repository.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");

const pool = new Pool({ connectionString: databaseUrl });
const repository = new PgHubAuthRepository(pool);
const context = { ipAddress: "127.0.0.1", userAgent: "vitest" };
const identity = {
  issuer: "https://login.sabilulquran.or.id/realms/sq-staff-staging",
  subject: "replacement-subject-001",
  displayName: "Replacement Test",
  username: "19870088",
  email: "replacement@example.test",
  emailVerified: true,
};

beforeEach(async () => {
  await pool.query(
    "TRUNCATE platform_audit_events, hub_oidc_transactions, hub_sessions CASCADE",
  );
});

afterAll(async () => {
  await pool.end();
});

describe("Hub session replacement persistence", () => {
  it("revokes the previous session and clears its delegated token atomically", async () => {
    const oldTokenHash = "a".repeat(64);
    const newTokenHash = "b".repeat(64);
    const originalExpiry = new Date(Date.now() + 30 * 60 * 1000);

    await repository.createSession({
      tokenHash: oldTokenHash,
      identity,
      accountRefreshTokenCiphertext: "sealed-old-refresh",
      expiresAt: originalExpiry,
      context,
    });

    await repository.createSession({
      tokenHash: newTokenHash,
      identity,
      accountRefreshTokenCiphertext: "sealed-new-refresh",
      replaceSessionTokenHash: oldTokenHash,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      context,
    });

    const sessions = await pool.query<{
      tokenHash: string;
      ciphertext: string | null;
      revokedAt: Date | null;
      expiresAt: Date;
    }>(
      `
        SELECT
          token_hash AS "tokenHash",
          account_refresh_token_ciphertext AS ciphertext,
          revoked_at AS "revokedAt",
          expires_at AS "expiresAt"
        FROM hub_sessions
        WHERE token_hash IN ($1, $2)
        ORDER BY token_hash
      `,
      [oldTokenHash, newTokenHash],
    );

    expect(sessions.rows).toHaveLength(2);
    expect(sessions.rows[0]).toMatchObject({
      tokenHash: oldTokenHash,
      ciphertext: null,
    });
    expect(sessions.rows[0]?.revokedAt).toBeInstanceOf(Date);
    expect(sessions.rows[1]).toMatchObject({
      tokenHash: newTokenHash,
      ciphertext: "sealed-new-refresh",
      revokedAt: null,
    });
    expect(sessions.rows[1]?.expiresAt.getTime()).toBe(originalExpiry.getTime());

    const audit = await pool.query<{ action: string }>(
      `
        SELECT action
        FROM platform_audit_events
        WHERE action IN ('hub.auth.session.created', 'hub.auth.session.replaced')
      `,
    );
    expect(audit.rows.filter((row) => row.action === "hub.auth.session.created")).toHaveLength(2);
    expect(audit.rows.filter((row) => row.action === "hub.auth.session.replaced")).toHaveLength(1);
  });

  it("does not replace an active session when the new identity differs", async () => {
    const oldTokenHash = "e".repeat(64);
    const newTokenHash = "f".repeat(64);

    await repository.createSession({
      tokenHash: oldTokenHash,
      identity,
      accountRefreshTokenCiphertext: "sealed-old-refresh",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      context,
    });

    await expect(
      repository.createSession({
        tokenHash: newTokenHash,
        identity: { ...identity, subject: "different-subject" },
        accountRefreshTokenCiphertext: "sealed-new-refresh",
        replaceSessionTokenHash: oldTokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        context,
      }),
    ).rejects.toThrow("changed identity");

    const result = await pool.query<{
      tokenHash: string;
      ciphertext: string | null;
      revokedAt: Date | null;
    }>(
      `
        SELECT
          token_hash AS "tokenHash",
          account_refresh_token_ciphertext AS ciphertext,
          revoked_at AS "revokedAt"
        FROM hub_sessions
        WHERE token_hash IN ($1, $2)
        ORDER BY token_hash
      `,
      [oldTokenHash, newTokenHash],
    );

    expect(result.rows).toEqual([
      {
        tokenHash: oldTokenHash,
        ciphertext: "sealed-old-refresh",
        revokedAt: null,
      },
    ]);
  });

  it("rolls back the new session when the replacement target is no longer active", async () => {
    const newTokenHash = "c".repeat(64);

    await expect(
      repository.createSession({
        tokenHash: newTokenHash,
        identity,
        accountRefreshTokenCiphertext: "sealed-new-refresh",
        replaceSessionTokenHash: "d".repeat(64),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        context,
      }),
    ).rejects.toThrow("replacement is no longer active");

    const result = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM hub_sessions WHERE token_hash = $1",
      [newTokenHash],
    );
    expect(result.rows[0]?.count).toBe("0");
  });
});

describe("ORGAN-IMPL-001 §1.2 sessions bound to their client", () => {
  it("returns a session only to the client that issued it, and legacy rows only to SQ Hub", async () => {
    await repository.createSession({ tokenHash: "c".repeat(64), identity, accountRefreshTokenCiphertext: null, expiresAt: new Date(Date.now() + 3_600_000), context, clientId: "sq-organ" });
    await repository.createSession({ tokenHash: "d".repeat(64), identity, accountRefreshTokenCiphertext: null, expiresAt: new Date(Date.now() + 3_600_000), context });

    const organ = { clientId: "sq-organ", acceptLegacy: false };
    const hub = { clientId: "sq-hub", acceptLegacy: true };
    expect(await repository.getSession("c".repeat(64), 3600, organ)).toMatchObject({ subject: identity.subject });
    expect(await repository.getSession("c".repeat(64), 3600, hub)).toBeNull();
    expect(await repository.getSession("d".repeat(64), 3600, hub)).toMatchObject({ subject: identity.subject });
    expect(await repository.getSession("d".repeat(64), 3600, organ)).toBeNull();
  });
});

/**
 * ORGAN-IMPL-001 §4.2 / ADR-0012 D4. The callback refuses a login that did not reach the level the
 * authorization request asked for — but only if it still knows what was asked. The transaction is
 * persisted column by column, and the step-up requirement had no column: it was written nowhere and
 * came back undefined, so the check never ran and the realm's answer was never looked at.
 */
describe("ORGAN-IMPL-001 §4.2 step-up survives the redirect", () => {
  const transaction = {
    state: "state-step-up",
    codeVerifier: "verifier-step-up",
    nonce: "nonce-step-up",
    returnPath: "/" as const,
  };

  it("hands the requirement back to the callback", async () => {
    await repository.createTransaction({
      tokenHash: "e".repeat(64),
      transaction: { ...transaction, stepUp: { acr: "2", maxAgeSeconds: 900 } },
      expiresAt: new Date(Date.now() + 600_000),
    });
    const stored = await repository.consumeTransaction("e".repeat(64));
    expect(stored?.transaction.stepUp).toEqual({ acr: "2", maxAgeSeconds: 900 });
  });

  it("leaves an ordinary sign-in without one", async () => {
    await repository.createTransaction({
      tokenHash: "f".repeat(64),
      transaction,
      expiresAt: new Date(Date.now() + 600_000),
    });
    const stored = await repository.consumeTransaction("f".repeat(64));
    expect(stored?.transaction.stepUp).toBeUndefined();
  });
});
