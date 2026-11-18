import type { GovernanceCard, GovernanceDecision } from "@/types";

export interface DecisionRow extends GovernanceDecision {
  application: string;
}

/** Every application's `decisions` block, in card order (ORGAN-IMPL-001 §3, §4.1). */
export function collectDecisions(cards: GovernanceCard[]): DecisionRow[] {
  return cards.flatMap((card) =>
    card.state === "ready" ? (card.summary.decisions ?? []).map((item) => ({ ...item, application: card.summary.title })) : [],
  );
}

export type DecisionDirection = "approve" | "reject";

/**
 * ORGAN-IMPL-001 §4.2 step 5: one id per action, where the action is this step AND this direction.
 *
 * The id is what makes a resend safe: the owning application answers a repeat by repeating its
 * first decision instead of taking a second one. That is only right while the id means one
 * direction. Sharing a single id across both buttons would mean that pressing Setujui after a
 * rejection whose answer never arrived gets the rejection replayed, answered 200, and shown as
 * success — the member would believe they had approved.
 */
export function requestIdFor(
  store: Partial<Record<DecisionDirection, string>>,
  decision: DecisionDirection,
  make: () => string,
): string {
  const existing = store[decision];
  if (existing) return existing;
  const created = make();
  store[decision] = created;
  return created;
}
