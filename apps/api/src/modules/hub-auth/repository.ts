import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { HubOidcAuthorizationTransaction } from "./oidc-provider.js";

export interface HubRequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface HubSessionIdentity {
  issuer: string;
  subject: string;
  displayName: string;
}

export interface HubSessionRecord extends HubSessionIdentity {
  sessionId: string;
  expiresAt: Date;
}

export interface HubAuthStore {
  createTransaction(input: {
    tokenHash: string;
    transaction: HubOidcAuthorizationTransaction;
    expiresAt: Date;
  }): Promise<void>;
  consumeTransaction(tokenHash: string): Promise<{
    transaction: HubOidcAuthorizationTransaction;
    expiresAt: Date;
  } | null>;
  createSession(input: {
    tokenHash: string;
    identity: HubSessionIdentity;
    expiresAt: Date;
    context: HubRequestContext;
  }): Promise<HubSessionRecord>;
  getSession(tokenHash: string, idleSeconds: number): Promise<HubSessionRecord | null>;
  revokeSession(tokenHash: string, context: HubRequestContext): Promise<void>;
}

interface TransactionRow {
  state: string;
  codeVerifier: string;
  nonce: string;
  expiresAt: Date;
}

interface SessionRow {
  sessionId: string;
  identityIssuer: string;
  identitySubject: string;
  displayName: string;
  expiresAt: Date;
}

export class PgHubAuthRepository implements HubAuthStore {
  constructor(private readonly pool: Pool) {}

  async createTransaction(input: {
    tokenHash: string;
    transaction: HubOidcAuthorizationTransaction;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO hub_oidc_transactions (
          id, token_hash, state, code_verifier, nonce, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        randomUUID(),
        input.tokenHash,
        input.transaction.state,
        input.transaction.codeVerifier,
        input.transaction.nonce,
        input.expiresAt,
      ],
    );
  }

  async consumeTransaction(tokenHash: string): Promise<{
    transaction: HubOidcAuthorizationTransaction;
    expiresAt: Date;
  } | null> {
    const result = await this.pool.query<TransactionRow>(
      `
        DELETE FROM hub_oidc_transactions
        WHERE token_hash = $1
        RETURNING
          state,
          code_verifier AS "codeVerifier",
          nonce,
          expires_at AS "expiresAt"
      `,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      transaction: {
        state: row.state,
        codeVerifier: row.codeVerifier,
        nonce: row.nonce,
      },
      expiresAt: row.expiresAt,
    };
  }

  async createSession(input: {
    tokenHash: string;
    identity: HubSessionIdentity;
    expiresAt: Date;
    context: HubRequestContext;
  }): Promise<HubSessionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sessionId = randomUUID();
      const result = await client.query<SessionRow>(
        `
          INSERT INTO hub_sessions (
            id,
            token_hash,
            identity_issuer,
            identity_subject,
            display_name,
            expires_at,
            ip_address,
            user_agent
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING
            id AS "sessionId",
            identity_issuer AS "identityIssuer",
            identity_subject AS "identitySubject",
            display_name AS "displayName",
            expires_at AS "expiresAt"
        `,
        [
          sessionId,
          input.tokenHash,
          input.identity.issuer,
          input.identity.subject,
          input.identity.displayName,
          input.expiresAt,
          input.context.ipAddress,
          input.context.userAgent,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("hub session insert returned no row");

      await client.query(
        `
          INSERT INTO platform_audit_events (
            id, actor_kind, actor_ref, action, target_type, target_ref, outcome, payload
          ) VALUES ($1, 'human', $2, 'hub.auth.session.created', 'hub_session', $3, 'succeeded', $4::jsonb)
        `,
        [
          randomUUID(),
          input.identity.subject,
          sessionId,
          JSON.stringify({ issuer: input.identity.issuer }),
        ],
      );
      await client.query("COMMIT");

      return {
        sessionId: row.sessionId,
        issuer: row.identityIssuer,
        subject: row.identitySubject,
        displayName: row.displayName,
        expiresAt: row.expiresAt,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getSession(tokenHash: string, idleSeconds: number): Promise<HubSessionRecord | null> {
    const result = await this.pool.query<SessionRow>(
      `
        SELECT
          id AS "sessionId",
          identity_issuer AS "identityIssuer",
          identity_subject AS "identitySubject",
          display_name AS "displayName",
          expires_at AS "expiresAt"
        FROM hub_sessions
        WHERE token_hash = $1
          AND revoked_at IS NULL
          AND expires_at > now()
          AND last_seen_at > now() - ($2::double precision * interval '1 second')
        LIMIT 1
      `,
      [tokenHash, idleSeconds],
    );
    const row = result.rows[0];
    if (!row) return null;

    await this.pool.query(
      `UPDATE hub_sessions SET last_seen_at = now() WHERE id = $1`,
      [row.sessionId],
    );

    return {
      sessionId: row.sessionId,
      issuer: row.identityIssuer,
      subject: row.identitySubject,
      displayName: row.displayName,
      expiresAt: row.expiresAt,
    };
  }

  async revokeSession(tokenHash: string, context: HubRequestContext): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        sessionId: string;
        identityIssuer: string;
        identitySubject: string;
      }>(
        `
          UPDATE hub_sessions
          SET revoked_at = now()
          WHERE token_hash = $1
            AND revoked_at IS NULL
          RETURNING
            id AS "sessionId",
            identity_issuer AS "identityIssuer",
            identity_subject AS "identitySubject"
        `,
        [tokenHash],
      );
      const row = result.rows[0];
      if (row) {
        await client.query(
          `
            INSERT INTO platform_audit_events (
              id, actor_kind, actor_ref, action, target_type, target_ref, outcome, payload
            ) VALUES ($1, 'human', $2, 'hub.auth.logout', 'hub_session', $3, 'succeeded', $4::jsonb)
          `,
          [
            randomUUID(),
            row.identitySubject,
            row.sessionId,
            JSON.stringify({
              issuer: row.identityIssuer,
              ipAddress: context.ipAddress,
              userAgent: context.userAgent,
            }),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
