import { describe, expect, it } from "vitest";

import { employeeListQuerySchema } from "../src/modules/governance/employee-list.js";
import {
  GovernanceApplicationRefusedError,
  GovernanceForbiddenError,
  GovernanceNotFoundError,
  GovernanceService,
  GovernanceUnavailableError,
  type GovernanceApplication,
} from "../src/modules/governance/service.js";
import type { HubSessionRecord } from "../src/modules/hub-auth/repository.js";

// ORGAN-IMPL-001 §3.1 / HCIS ORG-014: the portal's employee list, fetched as the member. Synthetic data.
const session: HubSessionRecord = {
  sessionId: "session-organ-1",
  issuer: "https://login.example.test/realms/sq-staff",
  subject: "member-subject",
  displayName: "Pengurus Sintetis",
  username: null,
  email: null,
  emailVerified: null,
  accountRefreshTokenCiphertext: "sealed",
  createdAt: new Date("2026-11-13T00:00:00Z"),
  expiresAt: new Date("2026-11-13T12:00:00Z"),
};

const hcis: GovernanceApplication = {
  applicationKey: "hcis",
  name: "HCIS",
  canonicalUrl: "https://hcis.example.test/",
  summaryPath: "/governance/summary",
  audience: "hcis",
  order: 1,
};

const page = {
  items: [{
    fullName: "Pegawai Sintetis", employeeNumber: "SYN-001", unitName: "Unit Sintetis",
    position: "Guru", employmentStatus: "Tetap", startedOn: "2020-07-01",
  }],
  pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 },
  units: [{ id: "00000000-0000-4000-8000-000000000001", name: "Unit Sintetis" }],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function harness(respond: (url: URL) => Response, options: { member?: boolean; applications?: GovernanceApplication[] } = {}) {
  const requests: Array<{ url: URL; token: string }> = [];
  const exchanges: Array<{ audience: string; scope: string }> = [];
  const service = new GovernanceService({
    memberships: { getEffective: async () => ((options.member ?? true) ? { organ: "pengurus" as const, positionLabel: null } : null) },
    applications: { listForIdentity: async () => options.applications ?? [hcis] },
    userAccessToken: async () => "member-token",
    exchanger: {
      exchange: async (_subject, target) => {
        exchanges.push(target);
        return "exchanged-token";
      },
    },
    fetch: (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ url, token: String((init?.headers as Record<string, string>).Authorization) });
      return respond(url);
    }) as typeof fetch,
  });
  return { service, requests, exchanges };
}

const query = (raw: Record<string, string> = {}) => employeeListQuerySchema.parse(raw);

describe("Portal Organ employee list", () => {
  it("fetches the sibling /employees path as the member with the governance exchange and forwards the query", async () => {
    const { service, requests, exchanges } = harness(() => json(page));
    const result = await service.employees(session, "cookie", "hcis", query({ page: "2", pageSize: "50", q: "Sin", unitId: page.units[0]!.id }));
    expect(result).toEqual(page);
    expect(exchanges).toEqual([{ audience: "hcis", scope: "sq-governance-hcis" }]);
    expect(requests).toHaveLength(1);
    const { url, token } = requests[0]!;
    expect(url.origin + url.pathname).toBe("https://hcis.example.test/governance/employees");
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: "2", pageSize: "50", q: "Sin", unitId: page.units[0]!.id });
    expect(token).toBe("Bearer exchanged-token");
  });

  it("refuses a page carrying any field beyond the six agreed ones", async () => {
    const leaky = { ...page, items: [{ ...page.items[0], email: "pegawai@example.test" }] };
    const { service } = harness(() => json(leaky));
    await expect(service.employees(session, "cookie", "hcis", query())).rejects.toBeInstanceOf(GovernanceUnavailableError);
  });

  it("maps refusals: no membership, unknown or unpublished application, the application's own 403, and failures", async () => {
    await expect(harness(() => json(page), { member: false }).service.employees(session, "c", "hcis", query()))
      .rejects.toBeInstanceOf(GovernanceForbiddenError);
    await expect(harness(() => json(page)).service.employees(session, "c", "aset-sq", query()))
      .rejects.toBeInstanceOf(GovernanceNotFoundError);
    await expect(harness(() => json(page), { applications: [{ ...hcis, summaryPath: "/api/v1/governance/overview" }] })
      .service.employees(session, "c", "hcis", query())).rejects.toBeInstanceOf(GovernanceNotFoundError);
    await expect(harness(() => json({ code: "BOARD_ACCESS_REQUIRED" }, 403)).service.employees(session, "c", "hcis", query()))
      .rejects.toBeInstanceOf(GovernanceApplicationRefusedError);
    await expect(harness(() => json({}, 500)).service.employees(session, "c", "hcis", query()))
      .rejects.toBeInstanceOf(GovernanceUnavailableError);
  });

  it("validates the browser query before anything is fetched", () => {
    expect(() => query({ pageSize: "101" })).toThrow();
    expect(() => query({ q: "a" })).toThrow();
    expect(() => query({ unitId: "not-a-uuid" })).toThrow();
    expect(query()).toEqual({ page: 1, pageSize: 25 });
  });
});
