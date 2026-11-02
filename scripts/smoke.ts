/**
 * End-to-end smoke test against a running API and the seeded database.
 * Usage: npm run dev:api  (terminal 1)  |  npm run smoke  (terminal 2)
 */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:4000/v1';

let failures = 0;
function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`, detail ?? '');
  }
}

async function api<T = any>(
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {},
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: response.status, data };
}

async function login(email: string): Promise<string> {
  const result = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    body: { email, password: 'Password123!' },
  });
  if (result.status !== 200) throw new Error(`login ${email}: ${JSON.stringify(result.data)}`);
  return result.data.token;
}

const candidate = await login('candidate@hi.test');
const candidate2 = await login('candidate2@hi.test');
const mentor = await login('mentor@hi.test');
const admin = await login('admin@hi.test');
const company = await login('company@hi.test');
const superAdmin = await login('super@hi.test');
console.log('login: all five roles');

const profile = await api('/candidate/profile', { token: candidate });
check('candidate profile loads', profile.status === 200 && profile.data.skills.length >= 3);

const candidateRounds = await api<any[]>('/candidate/rounds', { token: candidate });
check('candidate sees seed round', candidateRounds.status === 200 && candidateRounds.data.length >= 2);
const completed = candidateRounds.data.find((r) => r.latest_attempt?.status === 'evaluated');
const result = await api(`/candidate/attempts/${completed.latest_attempt.id}/result`, {
  token: candidate,
});
check(
  'candidate result hides answer keys',
  result.status === 200 &&
    result.data.answers.length === 4 &&
    !Object.keys(result.data.answers[0]).includes('answer_key'),
);

const mentors = await api<any[]>('/mentor/candidates', { token: mentor });
check('mentor sees assigned candidate', mentors.status === 200 && mentors.data.length === 1);
const assignmentId = mentors.data[0].id;

const templates = await api<any[]>('/mentor/templates', { token: mentor });
check('mentor sees seed template', templates.status === 200 && templates.data.length >= 1);

const snapshot = {
  title: 'Smoke test round',
  durationMinutes: 20,
  levels: [
    {
      levelNumber: 1,
      title: 'Basics',
      questions: [
        {
          questionKey: 'smoke-q1',
          questionText: 'Which hook holds state?',
          questionType: 'mcq',
          options: ['useState', 'useEffect'],
          answerKey: 'useState',
          marks: 10,
          sequenceOrder: 1,
        },
        {
          questionKey: 'smoke-q2',
          questionText: 'Explain memoisation.',
          questionType: 'descriptive',
          options: null,
          answerKey: 'Mentions caching and avoiding recomputation.',
          marks: 20,
          sequenceOrder: 2,
        },
      ],
    },
  ],
};

const created = await api<{ id: number }>('/mentor/templates', {
  token: mentor,
  method: 'POST',
  body: { title: 'Smoke template', snapshot },
});
check('mentor publishes template v1', created.status === 201 && created.data.version === 1, created.data);

const round = await api<{ id: number }>('/mentor/rounds', {
  token: mentor,
  method: 'POST',
  body: { mentorAssignmentId: assignmentId, templateId: created.data.id },
});
check('mentor creates round', round.status === 201, round.data);

const start = await api<any>(`/candidate/rounds/${round.data.id}/start`, {
  token: candidate,
  method: 'POST',
});
check(
  'candidate starts attempt and answer keys are hidden',
  start.status === 200 && start.data.questions.length === 2 && !('answer_key' in start.data.questions[0]),
  start.data,
);
const [q1, q2] = start.data.questions;

const event = await api(`/candidate/attempts/${start.data.attempt.id}/events`, {
  token: candidate,
  method: 'POST',
  body: { eventType: 'tab_hidden', eventDetails: { seconds: 4 } },
});
check('candidate event is recorded', event.status === 200);

const submit = await api<any>(`/candidate/attempts/${start.data.attempt.id}/submit`, {
  token: candidate,
  method: 'POST',
  body: {
    answers: [
      { questionId: q1.id, answer: 'useState' },
      { questionId: q2.id, answer: 'Cache results so expensive work is not repeated.' },
    ],
  },
});
check('submit auto-scores objective questions', submit.status === 200 && submit.data.totalScore === 10, submit.data);

const roundDetail = await api<any>(`/mentor/rounds/${round.data.id}`, { token: mentor });
check(
  'mentor sees answers, keys and monitoring events',
  roundDetail.status === 200 &&
    roundDetail.data.answers.length === 2 &&
    roundDetail.data.events.length === 2 &&
    roundDetail.data.questions[0].answer_key === 'useState',
);

const evaluate = await api<any>(`/mentor/attempts/${start.data.attempt.id}/evaluate`, {
  token: mentor,
  method: 'POST',
  body: {
    status: 'evaluated',
    mentorFeedback: 'Good.',
    scores: [{ questionId: q2.id, mentorScore: 18, feedback: 'Clear.' }],
  },
});
check('mentor evaluation wins over automation', evaluate.status === 200 && evaluate.data.totalScore === 28, evaluate.data);

const decision = await api(`/mentor/rounds/${round.data.id}/decision`, {
  token: mentor,
  method: 'POST',
  body: { decision: 'proceed', remarks: 'Move on.' },
});
check('mentor records a decision', decision.status === 200);

const impact = await api<any>(`/mentor/templates/${created.data.id}/impact`, {
  token: mentor,
  method: 'POST',
  body: {
    title: 'Smoke template',
    snapshot: {
      ...snapshot,
      levels: [
        {
          ...snapshot.levels[0],
          questions: [
            snapshot.levels[0].questions[0],
            {
              questionKey: 'smoke-q2',
              questionText: 'Explain memoisation and when it hurts.',
              questionType: 'descriptive',
              options: null,
              answerKey: 'Updated rubric.',
              marks: 20,
              sequenceOrder: 2,
            },
          ],
        },
      ],
    },
  },
});
check('impact preview reports the changed question', impact.data.diff.changed.includes('smoke-q2'), impact.data);

const publish = await api<any>(`/mentor/templates/${created.data.id}/versions`, {
  token: mentor,
  method: 'POST',
  body: {
    title: 'Smoke template',
    snapshot: {
      ...snapshot,
      levels: [
        {
          ...snapshot.levels[0],
          questions: [
            snapshot.levels[0].questions[0],
            {
              questionKey: 'smoke-q2',
              questionText: 'Explain memoisation and when it hurts.',
              questionType: 'descriptive',
              options: null,
              answerKey: 'Updated rubric.',
              marks: 20,
              sequenceOrder: 2,
            },
          ],
        },
      ],
    },
  },
});
check('template v2 publishes and queues re-assessment', publish.status === 200 && publish.data.affected >= 1, publish.data);

console.log('  ... waiting for the re-assessment worker');
await new Promise((resolve) => setTimeout(resolve, 7000));
const roundsAfter = await api<any[]>('/candidate/rounds', { token: candidate });
const reassessment = roundsAfter.data.find((r) => r.title.includes('re-assessment v2'));
check(
  'worker created a v2 re-assessment round',
  Boolean(reassessment),
  roundsAfter.data.map((r) => r.title),
);
const deltaRound = await api<any>(`/candidate/rounds/${reassessment.id}`, { token: candidate });
check(
  're-assessment asks only the changed question and carries the old score',
  deltaRound.status === 200 &&
    deltaRound.data.questions.length === 1 &&
    deltaRound.data.questions[0].question_key === 'smoke-q2' &&
    Number(deltaRound.data.round.carried_score) === 10,
  deltaRound.data,
);

const roleSearch = await api<any[]>('/company/search?role=React', { token: company });
check(
  'company search filters by applied role',
  roleSearch.status === 200 &&
    roleSearch.data.length >= 1 &&
    roleSearch.data.every((r) => (r.job_roles ?? []).some((role: string) => role.includes('React'))),
  roleSearch.data,
);

const search = await api<any[]>('/company/search', { token: company });
check(
  'company search exposes anonymous profiles only',
  search.status === 200 &&
    search.data.length >= 2 &&
    search.data[0].candidate_ref !== undefined &&
    search.data[0].first_name === undefined &&
    search.data[0].email === undefined,
  search.data,
);
const target = search.data.find((r) => r.experience_band === '5-10');
const intro = await api<{ id: number }>('/company/introductions', {
  token: company,
  method: 'POST',
  body: { candidateRef: target.candidate_ref, message: 'Would you be open to a conversation about a role?' },
});
check('company requests an introduction', intro.status === 201, intro.data);

const candidateIntros = await api<any[]>('/candidate/introductions', { token: candidate2 });
check('candidate sees the request', candidateIntros.status === 200 && candidateIntros.data.length === 1);
const respond = await api(`/candidate/introductions/${candidateIntros.data[0].id}/respond`, {
  token: candidate2,
  method: 'POST',
  body: { status: 'accepted' },
});
check('candidate accepts the introduction', respond.status === 200);

const companyIntros = await api<any[]>('/company/introductions', { token: company });
const accepted = companyIntros.data.find((r) => r.status === 'accepted');
check(
  'contact details appear only after consent',
  companyIntros.data.some((r) => r.status === 'pending' && r.candidate_email === null) &&
    accepted?.candidate_email === 'candidate2@hi.test',
  companyIntros.data,
);

const createAdmin = await api<{ id: string }>('/admin/users', {
  token: superAdmin,
  method: 'POST',
  body: {
    firstName: 'Test',
    lastName: 'Admin',
    email: `admin${Date.now()}@hi.test`,
    password: 'Password123!',
    permissions: ['users.list'],
  },
});
check('super admin creates an admin', createAdmin.status === 201, createAdmin.data);

const users = await api<any[]>('/admin/users', { token: admin });
check('admin lists users', users.status === 200 && users.data.length >= 7);

const audit = await api<any[]>('/admin/audit', { token: admin });
check('audit trail records decisions', audit.status === 200 && audit.data.length > 0);

const setting = await api('/settings/mentor_experience_threshold', {
  token: superAdmin,
  method: 'PUT',
  body: { value: 10 },
});
check('super admin updates a policy setting', setting.status === 200);

const notifications = await api<any[]>('/notifications', { token: candidate });
check('notifications are delivered', notifications.status === 200 && notifications.data.length > 0);

const forbidden = await api('/admin/users', { token: candidate });
check('role guard rejects candidate', forbidden.status === 403);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll smoke checks passed');
process.exit(failures ? 1 : 0);
