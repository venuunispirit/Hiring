-- Delta re-assessment + role-aware company search.
-- Historical rounds and attempts stay immutable; a re-assessment round is a
-- new round containing only changed/new questions and a carried forward score.

ALTER TABLE assessment_rounds
  ADD COLUMN reassessment_of_round_id BIGINT REFERENCES assessment_rounds(id) ON DELETE SET NULL,
  ADD COLUMN carried_score            NUMERIC(7,2) NOT NULL DEFAULT 0;

CREATE INDEX assessment_rounds_reassessment_idx
  ON assessment_rounds (reassessment_of_round_id);

DROP VIEW company_candidate_search;

CREATE VIEW company_candidate_search AS
SELECT
  p.public_ref                                            AS candidate_ref,
  p.professional_title,
  p.location,
  p.total_experience_years,
  CASE
    WHEN COALESCE(p.total_experience_years, 0) < 2 THEN '0-2'
    WHEN COALESCE(p.total_experience_years, 0) < 5 THEN '2-5'
    WHEN COALESCE(p.total_experience_years, 0) < 10 THEN '5-10'
    ELSE '10+'
  END                                                     AS experience_band,
  p.availability,
  COALESCE((
    SELECT array_agg(s.skill_name ORDER BY s.skill_name)
    FROM user_skills us
    JOIN skills s ON s.id = us.skill_id
    WHERE us.user_id = p.user_id
  ), '{}')                                                AS skills,
  ass.total_score                                         AS latest_score,
  ass.version_number                                      AS latest_assessment_version,
  ass.evaluated_at                                        AS latest_assessed_at,
  (SELECT count(*) FROM assessment_attempts at2
     JOIN assessment_rounds r2 ON r2.id = at2.round_id
     JOIN mentor_assignments ma2 ON ma2.id = r2.mentor_assignment_id
     JOIN applications a2 ON a2.id = ma2.application_id
    WHERE a2.user_id = p.user_id AND at2.status IN ('evaluated', 'expired')) AS assessments_taken,
  COALESCE((
    SELECT array_agg(DISTINCT jr.title ORDER BY jr.title)
    FROM applications a3
    JOIN job_roles jr ON jr.id = a3.job_role_id
    WHERE a3.user_id = p.user_id
      AND a3.application_type = 'candidate'
      AND a3.status = 'approved'
  ), '{}')                                                AS job_roles
FROM profiles p
LEFT JOIN LATERAL (
  SELECT at.total_score, r.version_number, at.evaluated_at
  FROM assessment_attempts at
  JOIN assessment_rounds r ON r.id = at.round_id
  JOIN mentor_assignments ma ON ma.id = r.mentor_assignment_id
  JOIN applications a ON a.id = ma.application_id
  WHERE a.user_id = p.user_id AND at.status IN ('evaluated', 'expired')
  ORDER BY at.evaluated_at DESC NULLS LAST, at.id DESC
  LIMIT 1
) ass ON true
WHERE p.is_discoverable
  AND EXISTS (
    SELECT 1 FROM applications a
    WHERE a.user_id = p.user_id
      AND a.application_type = 'candidate'
      AND a.status = 'approved'
  );
