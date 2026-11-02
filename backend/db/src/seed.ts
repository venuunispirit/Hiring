import type pg from 'pg';
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
  hashPassword,
  type Snapshot,
} from '@hi/shared';
import { cloneSnapshotToRound } from './clone';
import { pool, withTransaction } from './pool';

const PASSWORD = 'Password123!';

type SeedUser = {
  firstName: string;
  lastName: string;
  email: string;
  role: (typeof ROLES)[number];
  phone?: string;
};

async function createUser(client: pg.PoolClient, user: SeedUser): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO users (first_name, last_name, email, password_hash, phone)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [user.firstName, user.lastName, user.email, hashPassword(PASSWORD), user.phone ?? null],
  );
  const id = result.rows[0]!.id;
  await client.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [id, user.role]);
  return id;
}

const frontendSnapshot: Snapshot = {
  title: 'Frontend fundamentals',
  durationMinutes: 45,
  levels: [
    {
      levelNumber: 1,
      title: 'Fundamentals',
      questions: [
        {
          questionKey: 'fe-state-hook',
          questionText: 'Which React hook manages component-local state?',
          questionType: 'mcq',
          options: ['useState', 'useEffect', 'useMemo', 'useRef'],
          answerKey: 'useState',
          marks: 10,
          sequenceOrder: 1,
        },
        {
          questionKey: 'fe-list-keys',
          questionText: 'Keys help React identify which list items changed.',
          questionType: 'true_false',
          options: ['true', 'false'],
          answerKey: 'true',
          marks: 5,
          sequenceOrder: 2,
        },
      ],
    },
    {
      levelNumber: 2,
      title: 'Applied',
      questions: [
        {
          questionKey: 'fe-slow-list',
          questionText:
            'A list of 10,000 rows takes seconds to render. Explain how you would diagnose and fix it.',
          questionType: 'descriptive',
          options: null,
          answerKey:
            'Strong answer covers profiling, memoisation, windowing/virtualisation, pagination and stable keys.',
          marks: 25,
          sequenceOrder: 1,
        },
        {
          questionKey: 'fe-http-304',
          questionText: 'What does HTTP status 304 mean?',
          questionType: 'short_answer',
          options: null,
          answerKey: 'Not Modified',
          marks: 10,
          sequenceOrder: 2,
        },
      ],
    },
  ],
};

export async function seed(force = false): Promise<void> {
  const existing = await pool.query('SELECT count(*)::int AS count FROM users');
  if (existing.rows[0].count > 0 && !force) {
    console.log('Database already has users; skipping seed. Use `npm run db:reset` for a clean slate.');
    return;
  }

  await withTransaction(async (client) => {
    // Role defaults (permission keys live in code, validated on write).
    for (const role of ROLES) {
      for (const permission of DEFAULT_ROLE_PERMISSIONS[role]) {
        await client.query(
          `INSERT INTO role_permissions (role, permission_key) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [role, permission],
        );
      }
    }

    const superAdmin = await createUser(client, {
      firstName: 'Sara',
      lastName: 'Owner',
      email: 'super@hi.test',
      role: 'super_admin',
    });
    const admin = await createUser(client, {
      firstName: 'Aman',
      lastName: 'Reviewer',
      email: 'admin@hi.test',
      role: 'admin',
    });
    const mentor = await createUser(client, {
      firstName: 'Maya',
      lastName: 'Iyer',
      email: 'mentor@hi.test',
      role: 'mentor',
    });
    const mentor2 = await createUser(client, {
      firstName: 'Rohan',
      lastName: 'Kapoor',
      email: 'mentor2@hi.test',
      role: 'mentor',
    });
    const candidate = await createUser(client, {
      firstName: 'Neha',
      lastName: 'Sharma',
      email: 'candidate@hi.test',
      role: 'candidate',
    });
    const candidate2 = await createUser(client, {
      firstName: 'Arjun',
      lastName: 'Rao',
      email: 'candidate2@hi.test',
      role: 'candidate',
    });
    const companyUser = await createUser(client, {
      firstName: 'Priya',
      lastName: 'Menon',
      email: 'company@hi.test',
      role: 'company',
    });

    const profiles: Array<[string, string, number, string, string, string, boolean]> = [
      [mentor, 'Staff Frontend Engineer', 12, 'Bengaluru', 'B.Tech, NIT Trichy', '12 years building design systems and large React applications.', false],
      [mentor2, 'Principal Backend Engineer', 11, 'Pune', 'B.E., COEP', 'Distributed systems, payments and Postgres at scale.', false],
      [candidate, 'Frontend Engineer', 4, 'Bengaluru', 'B.Tech, VIT', 'React and TypeScript engineer focused on accessible interfaces.', true],
      [candidate2, 'Backend Engineer', 6, 'Hyderabad', 'B.Tech, IIIT-H', 'Node.js and PostgreSQL services, payments background.', true],
    ];
    for (const [userId, title, years, location, education, bio, discoverable] of profiles) {
      await client.query(
        `INSERT INTO profiles
           (user_id, professional_title, total_experience_years, location, education, bio,
            availability, is_discoverable)
         VALUES ($1, $2, $3, $4, $5, $6, 'Open to offers', $7)`,
        [userId, title, years, location, education, bio, discoverable],
      );
    }

    // Identity verification (no Aadhaar number is ever stored).
    for (const userId of [mentor, mentor2, candidate, candidate2]) {
      await client.query(
        `INSERT INTO identity_verifications
           (user_id, provider, provider_ref, status, consent_given_at, verified_at)
         VALUES ($1, 'sandbox-ekyc', $2, 'verified', now(), now())`,
        [userId, `kyc_${userId.slice(0, 8)}`],
      );
    }

    // Skills catalogue and job roles.
    const skillNames = [
      'TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Python', 'SQL',
      'System Design', 'Docker', 'AWS', 'Figma',
    ];
    const skillIds: Record<string, number> = {};
    for (const name of skillNames) {
      const row = await client.query<{ id: number }>(
        `INSERT INTO skills (skill_name) VALUES ($1)
         ON CONFLICT (skill_name) DO UPDATE SET skill_name = EXCLUDED.skill_name RETURNING id`,
        [name],
      );
      skillIds[name] = row.rows[0]!.id;
    }

    const roleRows: Array<[string, string[]]> = [
      ['React Developer', ['TypeScript', 'React', 'System Design']],
      ['Backend Developer', ['Node.js', 'PostgreSQL', 'Docker', 'AWS']],
      ['Data Engineer', ['Python', 'SQL', 'PostgreSQL']],
      ['Product Designer', ['Figma']],
    ];
    const jobRoleIds: Record<string, number> = {};
    for (const [title, skills] of roleRows) {
      const row = await client.query<{ id: number }>(
        `INSERT INTO job_roles (title) VALUES ($1)
         ON CONFLICT (title) DO UPDATE SET title = EXCLUDED.title RETURNING id`,
        [title],
      );
      jobRoleIds[title] = row.rows[0]!.id;
      for (const skill of skills) {
        await client.query(
          `INSERT INTO role_skills (job_role_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [row.rows[0]!.id, skillIds[skill]],
        );
      }
    }

    const userSkillRows: Array<[string, string, number, string | null]> = [
      [candidate, 'TypeScript', 4, 'advanced'],
      [candidate, 'React', 4, 'advanced'],
      [candidate, 'System Design', 2, 'intermediate'],
      [candidate2, 'Node.js', 6, 'advanced'],
      [candidate2, 'PostgreSQL', 6, 'advanced'],
      [candidate2, 'Docker', 5, 'advanced'],
      [mentor, 'TypeScript', 12, null],
      [mentor, 'React', 12, null],
      [mentor2, 'Node.js', 11, null],
      [mentor2, 'PostgreSQL', 11, null],
    ];
    for (const [userId, skill, years, proficiency] of userSkillRows) {
      await client.query(
        `INSERT INTO user_skills (user_id, skill_id, experience_years, proficiency)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [userId, skillIds[skill], years, proficiency],
      );
    }

    const parsed = (skills: string[], role: string, company: string) =>
      JSON.stringify({
        skills,
        employment: [{ role, company, years: 3 }],
        education: [{ degree: 'B.Tech', institution: 'Seed University' }],
      });

    const candidateResume = await client.query<{ id: number }>(
      `INSERT INTO resumes
         (user_id, file_url, file_name, is_primary, extracted_experience, parsed_data, analysis_status)
       VALUES ($1, 'seed://neha-sharma.pdf', 'neha-sharma.pdf', true, 4, $2, 'parsed')
       RETURNING id`,
      [candidate, parsed(['TypeScript', 'React', 'System Design'], 'Frontend Engineer', 'Initech')],
    );
    const candidate2Resume = await client.query<{ id: number }>(
      `INSERT INTO resumes
         (user_id, file_url, file_name, is_primary, extracted_experience, parsed_data, analysis_status)
       VALUES ($1, 'seed://arjun-rao.pdf', 'arjun-rao.pdf', true, 6, $2, 'parsed')
       RETURNING id`,
      [candidate2, parsed(['Node.js', 'PostgreSQL', 'Docker'], 'Backend Engineer', 'Globex')],
    );

    const applications = await client.query<{ id: number; user_id: string }>(
      `INSERT INTO applications
         (user_id, application_type, job_role_id, resume_id, status, reviewed_by, reviewed_at)
       VALUES
         ($1, 'candidate', $2, $3, 'approved', $4, now()),
         ($5, 'candidate', $6, $7, 'approved', $4, now()),
         ($8, 'mentor', $9, null, 'approved', $4, now())
       RETURNING id, user_id`,
      [
        candidate, jobRoleIds['React Developer'], candidateResume.rows[0]!.id, admin,
        candidate2, jobRoleIds['Backend Developer'], candidate2Resume.rows[0]!.id,
        mentor, jobRoleIds['React Developer'],
      ],
    );
    const candidateApplication = applications.rows.find((r) => r.user_id === candidate)!.id;
    const candidate2Application = applications.rows.find((r) => r.user_id === candidate2)!.id;

    const assignment = await client.query<{ id: number }>(
      `INSERT INTO mentor_assignments (application_id, mentor_id, assigned_by, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [candidateApplication, mentor, admin],
    );
    const assignment2 = await client.query<{ id: number }>(
      `INSERT INTO mentor_assignments (application_id, mentor_id, assigned_by, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [candidate2Application, mentor2, admin],
    );

    const template = await client.query<{ id: number }>(
      `INSERT INTO assessment_templates (mentor_id, title, status)
       VALUES ($1, 'Frontend fundamentals', 'published') RETURNING id`,
      [mentor],
    );
    const version = await client.query<{ id: number }>(
      `INSERT INTO template_versions (template_id, version_number, snapshot)
       VALUES ($1, 1, $2) RETURNING id`,
      [template.rows[0]!.id, JSON.stringify(frontendSnapshot)],
    );

    const round = await client.query<{ id: number }>(
      `INSERT INTO assessment_rounds
         (mentor_assignment_id, template_version_id, version_number, round_number, title,
          scheduled_at, duration_minutes, status, decision, remarks, decided_at)
       VALUES ($1, $2, 1, 1, $3, now() - interval '2 days', 45, 'completed', 'proceed',
               'Strong fundamentals; move to the applied round.', now() - interval '1 day')
       RETURNING id`,
      [assignment.rows[0]!.id, version.rows[0]!.id, frontendSnapshot.title],
    );
    await cloneSnapshotToRound(client, round.rows[0]!.id, frontendSnapshot);

    const round2 = await client.query<{ id: number }>(
      `INSERT INTO assessment_rounds
         (mentor_assignment_id, round_number, title, scheduled_at, duration_minutes, status)
       VALUES ($1, 1, 'Backend screening', now() + interval '2 days', 40, 'scheduled')
       RETURNING id`,
      [assignment2.rows[0]!.id],
    );
    await client.query(`UPDATE assessment_rounds SET status = 'open' WHERE id = $1`, [
      round2.rows[0]!.id,
    ]);

    const attempt = await client.query<{ id: number }>(
      `INSERT INTO assessment_attempts
         (round_id, attempt_number, started_at, submitted_at, status, total_score,
          mentor_feedback, evaluated_at)
       VALUES ($1, 1, now() - interval '2 days', now() - interval '2 days' + interval '40 minutes',
               'evaluated', 45, 'Clear explanations; production examples were strong.', now() - interval '1 day')
       RETURNING id`,
      [round.rows[0]!.id],
    );
    const attemptId = attempt.rows[0]!.id;

    const questions = await client.query<{ id: number; question_key: string }>(
      `SELECT q.id, q.question_key
       FROM assessment_questions q
       JOIN assessment_levels l ON l.id = q.level_id
       WHERE l.round_id = $1`,
      [round.rows[0]!.id],
    );
    const byKey = (key: string) => questions.rows.find((q) => q.question_key === key)!.id;

    await client.query(
      `INSERT INTO candidate_answers
         (attempt_id, question_id, answer, auto_score, mentor_score, feedback)
       VALUES
         ($1, $2, $3, 10, null, null),
         ($1, $4, $5, 5, null, null),
         ($1, $6, $7, null, 20, 'Good coverage of virtualisation; missed profiling detail.'),
         ($1, $8, $9, 10, null, null)`,
      [
        attemptId,
        byKey('fe-state-hook'), JSON.stringify('useState'),
        byKey('fe-list-keys'), JSON.stringify('true'),
        byKey('fe-slow-list'), JSON.stringify('Profile first, then virtualise the list and memoise row components.'),
        byKey('fe-http-304'), JSON.stringify('Not Modified'),
      ],
    );

    await client.query(
      `INSERT INTO assessment_events (attempt_id, event_type, event_timestamp, event_details)
       VALUES
         ($1, 'assessment_started', now() - interval '2 days', '{}'),
         ($1, 'tab_hidden', now() - interval '2 days' + interval '12 minutes', '{"seconds": 8}')`,
      [attemptId],
    );

    await client.query(
      `INSERT INTO assessment_rounds
         (mentor_assignment_id, round_number, title, scheduled_at, duration_minutes, status)
       VALUES ($1, 2, 'Applied review', now() + interval '5 days', 30, 'scheduled')`,
      [assignment.rows[0]!.id],
    );

    const company = await client.query<{ id: number }>(
      `INSERT INTO companies (company_name, website, industry, status)
       VALUES ('Acme Technologies', 'https://acme.test', 'Software', 'active') RETURNING id`,
    );
    const companyId = company.rows[0]!.id;
    await client.query(`INSERT INTO company_members (company_id, user_id) VALUES ($1, $2)`, [
      companyId,
      companyUser,
    ]);
    await client.query(
      `INSERT INTO introduction_requests (company_id, candidate_id, requested_by, message)
       VALUES ($1, $2, $3, 'We are hiring a senior frontend engineer and would like to talk.')`,
      [companyId, candidate, companyUser],
    );

    await client.query(
      `INSERT INTO notifications (user_id, message, notification_type)
       VALUES
         ($1, 'Your assessment was evaluated. Score: 45/50.', 'result'),
         ($2, 'A new candidate was assigned to you.', 'mentor'),
         ($3, 'A company requested an introduction.', 'introduction')`,
      [candidate, mentor, candidate],
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
       VALUES
         ($1, 'applications.review', 'application', $2, '{"status":"approved"}'),
         ($1, 'mentor.assign', 'mentor_assignment', $3, '{"mentor":"mentor@hi.test"}'),
         ($4, 'application.submit', 'application', $2, '{"type":"candidate"}')`,
      [admin, String(candidateApplication), String(assignment.rows[0]!.id), candidate],
    );

    await client.query(
      `INSERT INTO platform_settings (key, value, updated_by)
       VALUES ('mentor_experience_threshold', '10'::jsonb, $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
      [superAdmin],
    );

    console.log('Seeded. All accounts use password:', PASSWORD);
    console.log('  super@hi.test     super_admin');
    console.log('  admin@hi.test     admin');
    console.log('  mentor@hi.test    mentor (12 yrs, verified)');
    console.log('  mentor2@hi.test   mentor (11 yrs, verified)');
    console.log('  candidate@hi.test candidate (4 yrs, discoverable, assessed)');
    console.log('  candidate2@hi.test candidate (6 yrs, discoverable)');
    console.log('  company@hi.test   company member at Acme Technologies');
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed(process.argv.includes('--force'))
    .then(() => pool.end())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
