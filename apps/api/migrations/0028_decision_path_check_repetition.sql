-- ORGAN-IMPL-001 §4.2: the decision-path CHECK could never accept a path.
--
-- Migration 0026 folded the length limit into the pattern as `{0,511}`. PostgreSQL's regular
-- expressions cap a repetition count at 255, so the pattern is invalid and evaluating it raises
--
--   invalid regular expression: invalid repetition count(s)
--
-- Nothing failed at migration time, and nothing failed afterwards either, because the CHECK's first
-- branch — both columns NULL — is true for every row and short-circuits before the pattern is ever
-- evaluated. It surfaced the moment the first real decision path was written.
--
-- This restores the shape `applications_governance_summary_check` has used since 0008: the length as
-- its own `length(...)` test, the pattern unbounded.
--
-- Rollback: the constraint of 0026, which no row can satisfy, so there is nothing to go back to.
ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_decision_contract_check;

ALTER TABLE applications
  ADD CONSTRAINT applications_decision_contract_check CHECK (
    (decision_path IS NULL AND decision_audience IS NULL)
    OR (
      decision_path IS NOT NULL
      AND decision_audience IS NOT NULL
      AND length(decision_path) <= 512
      AND decision_path ~ '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]*$'
      AND decision_path !~ '^//'
      AND decision_audience ~ '^[A-Za-z0-9._:-]{1,255}$'
    )
  );
