import { describe, expect, it } from "vitest";

import type { ApplicationAccessRepository } from "../src/modules/application-access/repository.js";
import { ApplicationAccessService, governanceSummaryUrl } from "../src/modules/application-access/service.js";

const actor = { kind: "human" as const, ref: "staff:synthetic" };

function service() {
  const saved: unknown[] = [];
  const repository = {
    upsertApplication: async (input: unknown) => {
      saved.push(input);
      return input;
    },
  } as unknown as ApplicationAccessRepository;
  return { service: new ApplicationAccessService(repository), saved };
}

const base = { applicationKey: "hcis", name: "HCIS", canonicalUrl: "https://hcis.example.test", status: "active" as const, actor };

describe("HUB-IMPL-021 §2 registry fields", () => {
  it("accepts a path on the canonical origin with an audience and order", async () => {
    const { service: registry, saved } = service();
    await registry.upsertApplication({ ...base, governance: { summaryPath: "/api/governance/summary", audience: "hcis-governance", order: 1 } });
    expect(saved[0]).toMatchObject({ governance: { summaryPath: "/api/governance/summary", audience: "hcis-governance", order: 1 } });
  });

  it("rejects absolute URLs, other origins, and protocol-relative paths", async () => {
    const { service: registry, saved } = service();
    for (const summaryPath of [
      "https://evil.example.test/api/governance/summary",
      "//evil.example.test/api/governance/summary",
      "api/governance/summary",
      "/api/governance/summary\\@evil",
      "/\\evil.example.test",
    ]) {
      await expect(registry.upsertApplication({ ...base, governance: { summaryPath, audience: "hcis-governance", order: 1 } }))
        .rejects.toBeTruthy();
    }
    expect(saved).toEqual([]);
  });

  it("requires the audience exactly when the path is set", async () => {
    const { service: registry, saved } = service();
    await expect(registry.upsertApplication({ ...base, governance: { summaryPath: "/api/governance/summary", audience: null, order: 0 } })).rejects.toBeTruthy();
    await expect(registry.upsertApplication({ ...base, governance: { summaryPath: null, audience: "hcis-governance", order: 0 } })).rejects.toBeTruthy();
    await registry.upsertApplication({ ...base, governance: { summaryPath: null, audience: null, order: 3 } });
    expect(saved).toHaveLength(1);
  });

  it("keeps stored governance fields when an update omits them", async () => {
    const { service: registry, saved } = service();
    await registry.upsertApplication(base);
    expect(saved[0]).not.toHaveProperty("governance");
  });

  it("builds the summary URL on the canonical origin only", () => {
    expect(governanceSummaryUrl("https://hcis.example.test/app/", "/api/governance/summary").href)
      .toBe("https://hcis.example.test/api/governance/summary");
  });
});
