-- ORGAN-IMPL-001 §4.2 / ADR-0012 D4: one audience may never name both contracts.
--
-- The service compares the decision audience with the summary audience, but it can only compare
-- what it is given, and the two travel in separate groups: a call that sends the decision contract
-- without the governance group leaves the stored summary audience out of the comparison entirely.
-- This holds for every caller and every shape, including a direct UPDATE.
--
-- A decision token that also opened the summary, or a summary token that satisfied the decision
-- route's audience check, would collapse the separation the whole of R2 rests on.
--
-- Additive and already true of every row: no application has a decision audience yet.
--
-- Rollback: ALTER TABLE applications DROP CONSTRAINT applications_decision_audience_distinct;
ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_decision_audience_distinct;

ALTER TABLE applications
  ADD CONSTRAINT applications_decision_audience_distinct CHECK (
    decision_audience IS NULL
    OR decision_audience IS DISTINCT FROM governance_audience
  );
