import { describe, expect, it } from "vitest";

import { governanceRegistrationSchema } from "../src/modules/application-access/service.js";

/**
 * ORGAN-IMPL-001 §4.2 / ADR-0012 D4. The separation the whole design rests on is enforced in this
 * one schema, so it is worth pinning: a read token must never be able to decide, which starts with
 * the registry refusing to name one audience for both.
 */
const base = { summaryPath: "/governance/summary", audience: "hcis", order: 1 };

describe("ORGAN-IMPL-001 §4.2 registry: the decision contract", () => {
  it("accepts a registration with no decision contract at all", () => {
    expect(governanceRegistrationSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a path and an audience of its own", () => {
    const parsed = governanceRegistrationSchema.safeParse({
      ...base, decisionPath: "/governance/decisions", decisionAudience: "hcis-organ-decision",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses the decision audience when it is the summary audience", () => {
    const parsed = governanceRegistrationSchema.safeParse({
      ...base, decisionPath: "/governance/decisions", decisionAudience: "hcis",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/must differ/);
  });

  it.each([
    ["a path without an audience", { decisionPath: "/governance/decisions", decisionAudience: null }],
    ["an audience without a path", { decisionPath: null, decisionAudience: "hcis-organ-decision" }],
  ])("refuses %s", (_label, decision) => {
    expect(governanceRegistrationSchema.safeParse({ ...base, ...decision }).success).toBe(false);
  });

  it.each([
    ["an absolute URL", "https://evil.example/decisions"],
    ["a protocol-relative path", "//evil.example/decisions"],
    ["a path that does not start at the origin", "governance/decisions"],
  ])("refuses %s as a decision path", (_label, decisionPath) => {
    expect(governanceRegistrationSchema.safeParse({
      ...base, decisionPath, decisionAudience: "hcis-organ-decision",
    }).success).toBe(false);
  });
});
