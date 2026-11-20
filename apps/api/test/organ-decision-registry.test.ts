import { describe, expect, it } from "vitest";

import { ApplicationAccessService } from "../src/modules/application-access/service.js";
import type { ApplicationUpsertInput } from "../src/modules/application-access/repository.js";
import type { ApplicationRecord } from "../src/modules/application-access/types.js";

/**
 * ORGAN-IMPL-001 §4.2 / ADR-0012 D4. The separation the whole design rests on is enforced here:
 * a read token must never be able to decide, which starts with the registry refusing to name one
 * audience for both.
 *
 * These go through the service rather than the schema alone, because the bug that reached
 * production was not in a schema: the platform-admin route sent `decision` as its own group, the
 * service's input did not know that key, and the save was refused as an unrecognized key. A decision
 * contract nested inside `governance` passed validation and was then dropped before the UPDATE. Both
 * ends type-check in isolation; only a test that runs the path between them sees it.
 */
function harness(stored: ApplicationRecord[] = []) {
  const seen: ApplicationUpsertInput[] = [];
  const repository = {
    listApplications: async () => stored,
    upsertApplication: async (input: ApplicationUpsertInput): Promise<ApplicationRecord> => {
      seen.push(input);
      return {
        id: "00000000-0000-4000-8000-000000000000",
        applicationKey: input.applicationKey,
        name: input.name,
        canonicalUrl: input.canonicalUrl,
        status: input.status,
        governanceSummaryPath: input.governance?.summaryPath ?? null,
        governanceAudience: input.governance?.audience ?? null,
        governanceOrder: input.governance?.order ?? 0,
        decisionPath: input.decision?.path ?? null,
        decisionAudience: input.decision?.audience ?? null,
        kind: input.kind ?? "modul",
        whatsappCapable: input.whatsapp?.capable ?? false,
        machineClientId: input.whatsapp?.machineClientId ?? null,
      };
    },
  };
  const service = new ApplicationAccessService(
    repository as unknown as ConstructorParameters<typeof ApplicationAccessService>[0],
  );
  return { service, seen };
}

/** The shape the route sends when the body carries no governance field at all. */
const withoutGovernance = {
  applicationKey: "hcis",
  name: "HCIS",
  canonicalUrl: "https://hcis.sabilulquran.or.id",
  status: "active" as const,
  actor: { kind: "system" as const, ref: "ops:test" },
};

const base = {
  ...withoutGovernance,
  governance: { summaryPath: "/governance/summary", audience: "hcis", order: 1 },
};

describe("ORGAN-IMPL-001 §4.2 registry: the decision contract", () => {
  it("accepts a registration with no decision contract at all", async () => {
    const { service, seen } = harness();
    await service.upsertApplication(base);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.decision).toBeUndefined();
  });

  // The guard has to hold against what is stored, not only against what the call sent: the route
  // builds its two groups independently, so a body with decision fields and no governance field
  // reaches the service with `governance` undefined.
  it("refuses a decision-only update that names the stored summary audience", async () => {
    const { service, seen } = harness([
      {
        id: "00000000-0000-4000-8000-000000000001",
        applicationKey: "hcis",
        name: "HCIS",
        canonicalUrl: "https://hcis.sabilulquran.or.id",
        status: "active",
        governanceSummaryPath: "/governance/summary",
        governanceAudience: "hcis",
        governanceOrder: 1,
        decisionPath: null,
        decisionAudience: null,
        kind: "modul",
        whatsappCapable: false,
        machineClientId: null,
      },
    ]);
    await expect(
      service.upsertApplication({
        ...withoutGovernance,
        decision: { path: "/governance/decisions", audience: "hcis" },
      }),
    ).rejects.toThrow(/must differ/);
    expect(seen).toHaveLength(0);
  });

  it("allows a decision-only update with an audience of its own", async () => {
    const { service, seen } = harness();
    await service.upsertApplication({
      ...withoutGovernance,
      decision: { path: "/governance/decisions", audience: "hcis-organ-decision" },
    });
    expect(seen[0]?.governance).toBeUndefined();
    expect(seen[0]?.decision).toEqual({
      path: "/governance/decisions",
      audience: "hcis-organ-decision",
    });
  });

  it("carries the decision group through to the repository", async () => {
    const { service, seen } = harness();
    const record = await service.upsertApplication({
      ...base,
      decision: { path: "/governance/decisions", audience: "hcis-organ-decision" },
    });
    expect(seen[0]?.decision).toEqual({
      path: "/governance/decisions",
      audience: "hcis-organ-decision",
    });
    expect(record.decisionPath).toBe("/governance/decisions");
    expect(record.decisionAudience).toBe("hcis-organ-decision");
  });

  it("clears the contract when the group is sent with nulls", async () => {
    const { service, seen } = harness();
    await service.upsertApplication({ ...base, decision: { path: null, audience: null } });
    expect(seen[0]?.decision).toEqual({ path: null, audience: null });
  });

  it("refuses the decision audience when it is the summary audience", async () => {
    const { service } = harness();
    await expect(
      service.upsertApplication({
        ...base,
        decision: { path: "/governance/decisions", audience: "hcis" },
      }),
    ).rejects.toThrow(/must differ/);
  });

  it.each([
    ["a path without an audience", { path: "/governance/decisions", audience: null }],
    ["an audience without a path", { path: null, audience: "hcis-organ-decision" }],
  ])("refuses %s", async (_label, decision) => {
    const { service } = harness();
    await expect(service.upsertApplication({ ...base, decision })).rejects.toThrow();
  });

  it.each([
    ["an absolute URL", "https://evil.example/decisions"],
    ["a protocol-relative path", "//evil.example/decisions"],
    ["a path that does not start at the origin", "governance/decisions"],
  ])("refuses %s as a decision path", async (_label, path) => {
    const { service } = harness();
    await expect(
      service.upsertApplication({ ...base, decision: { path, audience: "hcis-organ-decision" } }),
    ).rejects.toThrow();
  });
});
