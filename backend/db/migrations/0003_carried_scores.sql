-- Preserve the per-question breakdown of a carried-forward score so a later
-- version can diff against the full attempted version, not just the delta.
ALTER TABLE assessment_rounds
  ADD COLUMN carried_scores JSONB NOT NULL DEFAULT '{}'::jsonb;
