-- Hiring Intelligence — Phase 1 MVP schema
-- 24 core tables from the optimized architecture + template versioning,
-- identity verification, settings and an outbox (see README deviations).

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone         VARCHAR(30),
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'pending')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL
              CHECK (role IN ('super_admin', 'admin', 'mentor', 'candidate', 'company')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  assigned_by UUID REFERENCES users(id),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE role_permissions (
  role           VARCHAR(20) NOT NULL
                 CHECK (role IN ('super_admin', 'admin', 'mentor', 'candidate', 'company')),
  permission_key VARCHAR(100) NOT NULL,
  PRIMARY KEY (role, permission_key)
);

CREATE TABLE user_permissions (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key VARCHAR(100) NOT NULL,
  granted_by     UUID REFERENCES users(id),
  effect         VARCHAR(10) NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow', 'deny')),
  PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE profiles (
  user_id                UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  public_ref             UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  professional_title     VARCHAR(150),
  total_experience_years NUMERIC(4,1),
  location               VARCHAR(150),
  education              TEXT,
  bio                    TEXT,
  availability           VARCHAR(40),
  is_discoverable        BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE companies (
  id           BIGSERIAL PRIMARY KEY,
  company_name VARCHAR(200) NOT NULL,
  website      TEXT,
  industry     VARCHAR(120),
  status       VARCHAR(20) NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'pending', 'suspended'))
);

CREATE TABLE company_members (
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE resumes (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_url             TEXT NOT NULL,
  file_name            VARCHAR(255) NOT NULL,
  is_primary           BOOLEAN NOT NULL DEFAULT false,
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  extracted_experience NUMERIC(4,1),
  parsed_data          JSONB,
  analysis_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                       CHECK (analysis_status IN ('pending', 'needs_review', 'parsed', 'failed'))
);

CREATE TABLE skills (
  id         BIGSERIAL PRIMARY KEY,
  skill_name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE user_skills (
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id         BIGINT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  experience_years NUMERIC(4,1),
  proficiency      VARCHAR(30),
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE job_roles (
  id     BIGSERIAL PRIMARY KEY,
  title  VARCHAR(150) NOT NULL UNIQUE,
  status BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE role_skills (
  job_role_id BIGINT NOT NULL REFERENCES job_roles(id) ON DELETE CASCADE,
  skill_id    BIGINT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (job_role_id, skill_id)
);

CREATE TABLE applications (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_type VARCHAR(20) NOT NULL CHECK (application_type IN ('candidate', 'mentor')),
  job_role_id      BIGINT REFERENCES job_roles(id),
  resume_id        BIGINT REFERENCES resumes(id),
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reviewed_by      UUID REFERENCES users(id),
  review_notes     TEXT,
  applied_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at      TIMESTAMPTZ
);

CREATE TABLE mentor_assignments (
  id             BIGSERIAL PRIMARY KEY,
  application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  mentor_id      UUID NOT NULL REFERENCES profiles(user_id),
  assigned_by    UUID NOT NULL REFERENCES users(id),
  status         VARCHAR(20) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'completed', 'reassigned', 'cancelled')),
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at       TIMESTAMPTZ
);

-- Reusable, versioned questionnaire authored by a mentor.
CREATE TABLE assessment_templates (
  id         BIGSERIAL PRIMARY KEY,
  mentor_id  UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  title      VARCHAR(200) NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'draft'
             CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE template_versions (
  id             BIGSERIAL PRIMARY KEY,
  template_id    BIGINT NOT NULL REFERENCES assessment_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot       JSONB NOT NULL,
  published_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_number)
);

CREATE TABLE assessment_rounds (
  id                  BIGSERIAL PRIMARY KEY,
  mentor_assignment_id BIGINT NOT NULL REFERENCES mentor_assignments(id) ON DELETE CASCADE,
  template_version_id BIGINT REFERENCES template_versions(id),
  version_number      INTEGER,
  round_number        INTEGER NOT NULL,
  title               VARCHAR(200) NOT NULL,
  scheduled_at        TIMESTAMPTZ,
  duration_minutes    INTEGER,
  status              VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'open', 'in_progress', 'completed', 'cancelled', 'expired')),
  decision            VARCHAR(20) CHECK (decision IN ('proceed', 'reject', 'hold', 'reschedule')),
  next_assessment_at  TIMESTAMPTZ,
  remarks             TEXT,
  decided_at          TIMESTAMPTZ,
  UNIQUE (mentor_assignment_id, round_number)
);

CREATE TABLE assessment_levels (
  id           BIGSERIAL PRIMARY KEY,
  round_id     BIGINT NOT NULL REFERENCES assessment_rounds(id) ON DELETE CASCADE,
  level_number INTEGER NOT NULL,
  title        VARCHAR(200),
  UNIQUE (round_id, level_number)
);

CREATE TABLE assessment_questions (
  id             BIGSERIAL PRIMARY KEY,
  level_id       BIGINT NOT NULL REFERENCES assessment_levels(id) ON DELETE CASCADE,
  question_key   VARCHAR(100) NOT NULL,
  question_text  TEXT NOT NULL,
  question_type  VARCHAR(30) NOT NULL
                 CHECK (question_type IN ('mcq', 'multiple_select', 'true_false', 'short_answer',
                                          'descriptive', 'coding', 'practical')),
  options        JSONB,
  answer_key     TEXT,
  marks          NUMERIC(7,2) NOT NULL DEFAULT 1,
  sequence_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (level_id, question_key)
);

CREATE TABLE assessment_attempts (
  id              BIGSERIAL PRIMARY KEY,
  round_id        BIGINT NOT NULL REFERENCES assessment_rounds(id) ON DELETE CASCADE,
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress', 'submitted', 'evaluated', 'expired')),
  total_score     NUMERIC(7,2),
  ai_feedback     TEXT,
  mentor_feedback TEXT,
  evaluated_at    TIMESTAMPTZ,
  UNIQUE (round_id, attempt_number)
);

CREATE TABLE candidate_answers (
  attempt_id   BIGINT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  question_id  BIGINT NOT NULL REFERENCES assessment_questions(id) ON DELETE CASCADE,
  answer       JSONB,
  auto_score   NUMERIC(7,2),
  ai_score     NUMERIC(7,2),
  mentor_score NUMERIC(7,2),
  feedback     TEXT,
  final_score  NUMERIC(7,2) GENERATED ALWAYS AS (COALESCE(mentor_score, ai_score, auto_score)) STORED,
  PRIMARY KEY (attempt_id, question_id)
);

CREATE TABLE assessment_events (
  id              BIGSERIAL PRIMARY KEY,
  attempt_id      BIGINT NOT NULL REFERENCES assessment_attempts(id) ON DELETE CASCADE,
  event_type      VARCHAR(50) NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_details   JSONB
);

CREATE TABLE introduction_requests (
  id           BIGSERIAL PRIMARY KEY,
  company_id   BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id),
  message      TEXT,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

CREATE TABLE engagement_events (
  id             BIGSERIAL PRIMARY KEY,
  candidate_id   UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  application_id BIGINT REFERENCES applications(id) ON DELETE CASCADE,
  event_type     VARCHAR(50) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message           TEXT NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  is_read           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id),
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE identity_verifications (
  id               BIGSERIAL PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         VARCHAR(50) NOT NULL,
  provider_ref     VARCHAR(255) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'verified', 'failed')),
  consent_given_at TIMESTAMPTZ,
  verified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE platform_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id         BIGSERIAL PRIMARY KEY,
  type       VARCHAR(50) NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  status     VARCHAR(20) NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  run_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at  TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX user_roles_role_idx ON user_roles (role, is_active);
CREATE INDEX applications_status_idx ON applications (status, job_role_id, user_id, applied_at);
CREATE INDEX mentor_assignments_lookup_idx ON mentor_assignments (mentor_id, application_id, status);
CREATE INDEX assessment_rounds_lookup_idx ON assessment_rounds (mentor_assignment_id, scheduled_at);
CREATE INDEX assessment_attempts_round_idx ON assessment_attempts (round_id, status);
CREATE INDEX assessment_events_attempt_idx ON assessment_events (attempt_id, event_timestamp);
CREATE INDEX assessment_questions_level_idx ON assessment_questions (level_id, sequence_order);
CREATE INDEX introduction_requests_lookup_idx ON introduction_requests (company_id, candidate_id, status);
CREATE UNIQUE INDEX introduction_requests_one_active_idx
  ON introduction_requests (company_id, candidate_id)
  WHERE status IN ('pending', 'accepted');
CREATE INDEX notifications_unread_idx ON notifications (user_id, is_read, created_at);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at);
CREATE INDEX jobs_pending_idx ON jobs (status, run_at);
CREATE INDEX identity_verifications_user_idx ON identity_verifications (user_id, status);
CREATE INDEX resumes_user_idx ON resumes (user_id);

-- ---------------------------------------------------------------------------
-- Restricted company search view. No name, email, phone, exact address,
-- resume URL, answers or mentor notes ever leave this view.
-- ---------------------------------------------------------------------------
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
    WHERE a2.user_id = p.user_id AND at2.status = 'evaluated') AS assessments_taken
FROM profiles p
LEFT JOIN LATERAL (
  SELECT at.total_score, r.version_number, at.evaluated_at
  FROM assessment_attempts at
  JOIN assessment_rounds r ON r.id = at.round_id
  JOIN mentor_assignments ma ON ma.id = r.mentor_assignment_id
  JOIN applications a ON a.id = ma.application_id
  WHERE a.user_id = p.user_id AND at.status = 'evaluated'
  ORDER BY at.evaluated_at DESC NULLS LAST
  LIMIT 1
) ass ON true
WHERE p.is_discoverable
  AND EXISTS (
    SELECT 1 FROM applications a
    WHERE a.user_id = p.user_id
      AND a.application_type = 'candidate'
      AND a.status = 'approved'
  );
