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
