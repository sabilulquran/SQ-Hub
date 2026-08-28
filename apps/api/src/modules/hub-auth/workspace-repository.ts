import type { Pool } from "pg";

export interface HubWorkspaceApplication {
  applicationKey: string;
  name: string;
  canonicalUrl: string;
}

export interface HubWorkspaceApplicationSource {
  listAuthorizedApplications(identity: {
    issuer: string;
    subject: string;
  }): Promise<HubWorkspaceApplication[]>;
}

export class PgHubWorkspaceRepository implements HubWorkspaceApplicationSource {
  constructor(private readonly pool: Pool) {}

  async listAuthorizedApplications(identity: {
    issuer: string;
    subject: string;
  }): Promise<HubWorkspaceApplication[]> {
    const result = await this.pool.query<HubWorkspaceApplication>(
      `
        SELECT
          a.application_key AS "applicationKey",
          a.name,
          a.canonical_url AS "canonicalUrl"
        FROM applications a
        JOIN application_access aa
          ON aa.application_id = a.id
        WHERE aa.identity_issuer = $1
          AND aa.identity_subject = $2
          AND aa.status = 'active'
          AND a.status = 'active'
        ORDER BY a.name, a.application_key
      `,
      [identity.issuer, identity.subject],
    );
    return result.rows;
  }
}
