import { useEffect, useRef, useState } from 'react';
import { api, upload } from '../api';
import { useAuth } from '../auth';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Select,
  Spinner,
  Stat,
  Textarea,
  statusTone,
  useLoad,
} from '../components';

export function CandidatePage({ tab }: { tab: string }) {
  if (tab === 'assessments') return <CandidateAssessments />;
  if (tab === 'introductions') return <CandidateIntroductions />;
  return <CandidateProfile />;
}

const blankProfile = {
  professionalTitle: '',
  totalExperienceYears: '',
  location: '',
  availability: '',
  education: '',
  bio: '',
  isDiscoverable: false,
};

function CandidateProfile() {
  const { user, refresh } = useAuth();
  const profile = useLoad<any>('/candidate/profile');
  const [form, setForm] = useState({ ...blankProfile });
  const [skillsText, setSkillsText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [jobRoleId, setJobRoleId] = useState('');
  const meta = useLoad<any>('/meta');

  useEffect(() => {
    if (!profile.data) return;
    const p = profile.data.profile ?? {};
    setForm({
      professionalTitle: p.professional_title ?? '',
      totalExperienceYears:
        p.total_experience_years === null || p.total_experience_years === undefined
          ? ''
          : String(p.total_experience_years),
      location: p.location ?? '',
      availability: p.availability ?? '',
      education: p.education ?? '',
      bio: p.bio ?? '',
      isDiscoverable: Boolean(p.is_discoverable),
    });
    setSkillsText(
      (profile.data.skills ?? []).map((skill: any) => skill.skill_name).join(', '),
    );
  }, [profile.data]);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice('');
    setBusy(true);
    try {
      const existing = profile.data?.skills ?? [];
      const names = skillsText
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      const skills = names.map((name) => {
        const match = existing.find(
          (skill: any) => skill.skill_name.toLowerCase() === name.toLowerCase(),
        );
        return {
          skillName: name,
          experienceYears: match?.experience_years ?? null,
          proficiency: match?.proficiency ?? null,
        };
      });
      await api('/candidate/profile', {
        method: 'PUT',
        body: {
          professionalTitle: form.professionalTitle || null,
          totalExperienceYears:
            form.totalExperienceYears === '' ? null : Number(form.totalExperienceYears),
          location: form.location || null,
          availability: form.availability || null,
          education: form.education || null,
          bio: form.bio || null,
          isDiscoverable: form.isDiscoverable,
          skills,
        },
      });
      setNotice('Profile saved.');
      profile.reload();
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const verifyIdentity = async () => {
    setError(null);
    setNotice('');
    setBusy(true);
    try {
      await api('/auth/kyc', {
        method: 'POST',
        body: {
          provider: 'sandbox',
          providerRef: `sandbox-${(user?.id ?? '').slice(0, 8)}`,
          consent: true,
        },
      });
      await refresh();
      profile.reload();
      setNotice('Identity verified. You can now start assessments and apply.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const uploadResume = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setNotice('');
    setUploading(true);
    try {
      await upload('/candidate/resumes', file);
      setNotice(`${file.name} uploaded.`);
      profile.reload();
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const apply = async () => {
    setError(null);
    setNotice('');
    setBusy(true);
    try {
      const primary = (profile.data?.resumes ?? []).find((resume: any) => resume.is_primary);
      await api('/applications', {
        method: 'POST',
        body: {
          applicationType: 'candidate',
          resumeId: primary?.id ?? null,
          jobRoleId: jobRoleId ? Number(jobRoleId) : null,
        },
      });
      setNotice('Application submitted. An admin will review it shortly.');
      profile.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (profile.loading && !profile.data) return <Spinner />;

  const resumes = profile.data?.resumes ?? [];
  const applications = profile.data?.applications ?? [];

  return (
    <div className="stack">
      <ErrorNote error={error ?? profile.error} />
      {notice && <p className="badge success">{notice}</p>}
      <div className="grid2">
        <Card
          title="Your profile"
          subtitle="Mentors and companies only see what you choose to share."
        >
          <form className="stack" onSubmit={saveProfile}>
            <div className="grid2">
              <Field label="Professional title">
                <Input
                  value={form.professionalTitle}
                  onChange={(e) => setForm({ ...form, professionalTitle: e.target.value })}
                  placeholder="Frontend engineer"
                />
              </Field>
              <Field label="Total experience (years)">
                <Input
                  type="number"
                  min={0}
                  max={70}
                  step="0.5"
                  value={form.totalExperienceYears}
                  onChange={(e) => setForm({ ...form, totalExperienceYears: e.target.value })}
                />
              </Field>
              <Field label="Location">
                <Input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="Bengaluru"
                />
              </Field>
              <Field label="Availability">
                <Input
                  value={form.availability}
                  onChange={(e) => setForm({ ...form, availability: e.target.value })}
                  placeholder="Immediate / 30 days"
                />
              </Field>
            </div>
            <Field label="Skills" hint="Comma separated, for example: React, TypeScript, SQL">
              <Input value={skillsText} onChange={(e) => setSkillsText(e.target.value)} />
            </Field>
            <Field label="Education">
              <Textarea
                rows={2}
                value={form.education}
                onChange={(e) => setForm({ ...form, education: e.target.value })}
              />
            </Field>
            <Field label="About you">
              <Textarea
                rows={4}
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
              />
            </Field>
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={form.isDiscoverable}
                onChange={(e) => setForm({ ...form, isDiscoverable: e.target.checked })}
              />
              <span>
                Appear in company candidate search (anonymised until you accept an introduction)
              </span>
            </label>
            <div className="row">
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save profile'}
              </Button>
              {form.isDiscoverable && <Badge tone="success">discoverable</Badge>}
            </div>
          </form>
        </Card>

        <div className="stack">
          <Card title="Identity verification" subtitle="Required before assessments and applications">
            <div className="stack">
              <div className="row">
                <Badge tone={profile.data?.kycVerified ? 'success' : 'warn'}>
                  {profile.data?.kycVerified ? 'verified' : 'not verified'}
                </Badge>
                {profile.data?.profile?.public_ref && (
                  <span className="muted small">Ref: {profile.data.profile.public_ref}</span>
                )}
              </div>
              <p className="muted small">
                Sandbox eKYC stores only a provider reference and your consent time — never an
                Aadhaar number.
              </p>
              {!profile.data?.kycVerified && (
                <div>
                  <Button onClick={verifyIdentity} disabled={busy} variant="success">
                    Verify identity
                  </Button>
                </div>
              )}
            </div>
          </Card>

          <Card title="Resumes">
            <div className="stack">
              {resumes.length === 0 && <Empty>No resume uploaded yet.</Empty>}
              {resumes.map((resume: any) => (
                <div key={resume.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <strong>{resume.file_name}</strong>
                    <div className="muted small">
                      {new Date(resume.uploaded_at).toLocaleDateString()}
                      {resume.is_primary ? ' · primary' : ''}
                    </div>
                  </span>
                  <Badge tone={statusTone(resume.analysis_status)}>{resume.analysis_status}</Badge>
                </div>
              ))}
              <Field label="Upload resume" hint="PDF, DOC, DOCX or TXT">
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={uploadResume}
                  disabled={uploading}
                />
              </Field>
              {uploading && <Spinner label="Uploading…" />}
            </div>
          </Card>

          <Card title="Applications" subtitle="Your route into the mentor programme">
            <div className="stack">
              {applications.length === 0 && <Empty>No applications yet.</Empty>}
              {applications.map((application: any) => (
                <div key={application.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <strong>{application.application_type}</strong>
                    {application.job_role && <span className="muted"> · {application.job_role}</span>}
                    <div className="muted small">
                      {new Date(application.applied_at).toLocaleDateString()}
                    </div>
                  </span>
                  <Badge tone={statusTone(application.status)}>{application.status}</Badge>
                </div>
              ))}
              <Field label="Role you are applying for">
                <Select value={jobRoleId} onChange={(event) => setJobRoleId(event.target.value)}>
                  <option value="">Choose a role (optional)</option>
                  {(meta.data?.jobRoles ?? []).map((role: any) => (
                    <option key={role.id} value={role.id}>
                      {role.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <Button onClick={apply} disabled={busy || !profile.data?.kycVerified} variant="ghost">
                  Submit candidate application
                </Button>
              </div>
              {!profile.data?.kycVerified && (
                <p className="muted small">Verify your identity first to apply.</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CandidateAssessments() {
  const rounds = useLoad<any[]>('/candidate/rounds');
  const [roundId, setRoundId] = useState<number | null>(null);

  if (roundId) {
    return (
      <RoundRunner
        roundId={roundId}
        onClose={() => {
          setRoundId(null);
          rounds.reload();
        }}
      />
    );
  }

  return (
    <Card
      title="Assessments"
      subtitle="Rounds are created by your mentor. You can attempt each round once."
    >
      <div className="stack">
        <ErrorNote error={rounds.error} />
        {rounds.loading && <Spinner />}
        {!rounds.loading && (rounds.data ?? []).length === 0 && (
          <Empty>No assessment rounds yet. Your mentor will schedule one after your application is approved.</Empty>
        )}
        {(rounds.data ?? []).length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Decision</th>
                  <th>Latest attempt</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(rounds.data ?? []).map((round: any) => {
                  const attempt = round.latest_attempt;
                  const open =
                    ['scheduled', 'open', 'in_progress'].includes(round.status) &&
                    !['submitted', 'evaluated', 'expired'].includes(attempt?.status);
                  return (
                    <tr key={round.id}>
                      <td>
                        {round.round_number}. {round.title}
                        {round.scheduled_at && (
                          <div className="muted small">
                            Scheduled {new Date(round.scheduled_at).toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td>{round.version_number ? `v${round.version_number}` : '—'}</td>
                      <td>
                        <Badge tone={statusTone(round.status)}>{round.status}</Badge>
                      </td>
                      <td>
                        {round.decision ? (
                          <Badge tone={statusTone(round.decision)}>{round.decision}</Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {attempt
                          ? `${attempt.status} · ${attempt.total_score ?? '—'}`
                          : 'not attempted'}
                      </td>
                      <td>
                        <Button variant={open ? 'primary' : 'ghost'} onClick={() => setRoundId(round.id)}>
                          {open ? 'Open' : 'View'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

type RunnerAttempt = {
  id: number;
  questions: any[];
  resumed: boolean;
  startedAt: string;
  durationMinutes: number | null;
  carriedScore: number;
};

function RoundRunner({ roundId, onClose }: { roundId: number; onClose: () => void }) {
  const detail = useLoad<any>(`/candidate/rounds/${roundId}`);
  const [attempt, setAttempt] = useState<RunnerAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<number, unknown>>({});
  const [resultId, setResultId] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const autoSubmitted = useRef(false);

  const attempts = detail.data?.attempts ?? [];
  const latest = attempts.length ? attempts[0] : null;
  const canStart =
    detail.data?.canStart ||
    (latest?.status === 'in_progress' && !attempt);

  useEffect(() => {
    if (!attempt) return;
    const send = (eventType: string, eventDetails?: Record<string, unknown>) => {
      void api(`/candidate/attempts/${attempt.id}/events`, {
        method: 'POST',
        body: { eventType, eventDetails },
      }).catch(() => {});
    };
    const onVisibility = () => {
      if (document.hidden) send('tab_hidden');
    };
    const onBlur = () => send('window_blur');
    const onFullscreen = () =>
      send('fullscreen_change', { fullscreen: Boolean(document.fullscreenElement) });

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [attempt]);

  const start = async () => {
    setError(null);
    setNotice('');
    setBusy(true);
    autoSubmitted.current = false;
    try {
      const started = await api<{
        attempt: { id: number; started_at: string };
        questions: any[];
        resumed: boolean;
        carriedScore: number;
        durationMinutes: number | null;
      }>(`/candidate/rounds/${roundId}/start`, { method: 'POST' });
      setAttempt({
        id: started.attempt.id,
        questions: started.questions,
        resumed: started.resumed,
        startedAt: started.attempt.started_at,
        durationMinutes: started.durationMinutes,
        carriedScore: started.carriedScore ?? 0,
      });
      setNow(Date.now());
      setAnswers({});
      setNotice(
        started.resumed
          ? 'Resumed your in-progress attempt. Answers are saved when you submit.'
          : 'Attempt started. Keep this tab visible — tab switches are recorded.',
      );
      detail.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const setAnswer = (questionId: number, value: unknown) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  };

  const toggleMulti = (questionId: number, option: string) => {
    const current = Array.isArray(answers[questionId]) ? (answers[questionId] as string[]) : [];
    const next = current.includes(option)
      ? current.filter((value) => value !== option)
      : [...current, option];
    setAnswer(questionId, next);
  };

  const submit = async (auto = false) => {
    if (!attempt) return;
    setError(null);
    setNotice('');
    setBusy(true);
    try {
      if (auto) {
        await api(`/candidate/attempts/${attempt.id}/events`, {
          method: 'POST',
          body: { eventType: 'time_expired', eventDetails: {} },
        }).catch(() => {});
      }
      const payload = attempt.questions
        .filter((question) => {
          const value = answers[question.id];
          return value !== undefined && value !== '';
        })
        .map((question) => ({ questionId: question.id, answer: answers[question.id] }));
      const result = await api<{ totalScore: number; status: string }>(
        `/candidate/attempts/${attempt.id}/submit`,
        { method: 'POST', body: { answers: payload } },
      );
      setNotice(
        `${auto || result.status === 'expired' ? 'Time expired — submitted.' : 'Submitted.'} ` +
          `Auto-scored total: ${result.totalScore}.`,
      );
      setResultId(attempt.id);
      setAttempt(null);
      detail.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const deadline = attempt?.durationMinutes
    ? new Date(attempt.startedAt).getTime() + attempt.durationMinutes * 60_000
    : null;
  const remaining = deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));

  useEffect(() => {
    if (!attempt || remaining === null) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [attempt, remaining === null]);

  useEffect(() => {
    if (!attempt || remaining === null || remaining > 0 || autoSubmitted.current) return;
    autoSubmitted.current = true;
    void submit(true);
  }, [attempt, remaining]);

  if (detail.loading && !detail.data) return <Card title="Assessment"><Spinner /></Card>;
  if (!detail.data) {
    return (
      <Card title="Assessment" actions={<Button variant="ghost" onClick={onClose}>Close</Button>}>
        <ErrorNote error={detail.error} />
        <Empty>Could not load this round.</Empty>
      </Card>
    );
  }

  const { round, questions } = detail.data;
  const activeQuestions = attempt ? attempt.questions : questions;
  const unanswered = attempt
    ? attempt.questions.filter((question) => {
        const value = answers[question.id];
        return value === undefined || value === '';
      }).length
    : 0;

  return (
    <Card
      title={round.title}
      subtitle={`Round ${round.id} · version ${round.version_number ?? '—'} · ${round.duration_minutes ?? '—'} min`}
      actions={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      <div className="stack">
        <div className="row">
          <Badge tone={statusTone(round.round_status)}>{round.round_status}</Badge>
          {round.decision && <Badge tone={statusTone(round.decision)}>decision: {round.decision}</Badge>}
          <Badge>{attempts.length} attempt(s)</Badge>
          {attempt && <Badge tone="warn">attempt #{attempt.id} in progress</Badge>}
          {attempt && remaining !== null && (
            <span className="timer">
              {String(Math.floor(remaining / 60)).padStart(2, '0')}:
              {String(remaining % 60).padStart(2, '0')} left
            </span>
          )}
          {Number(round.carried_score) > 0 && (
            <Badge tone="success">{Number(round.carried_score)} carried forward</Badge>
          )}
        </div>
        <ErrorNote error={error ?? detail.error} />
        {notice && <p className="badge success">{notice}</p>}

        {!attempt && canStart && (
          <div className="stack">
            <p className="muted small">
              The timer starts when you begin. Objective questions are auto-scored; descriptive,
              coding and practical answers wait for mentor review.
            </p>
            <div>
              <Button onClick={start} disabled={busy}>
                {latest?.status === 'in_progress' ? 'Resume attempt' : 'Start assessment'}
              </Button>
            </div>
          </div>
        )}

        {!attempt && !canStart && (
          <p className="muted small">
            {round.scheduled_at && new Date(round.scheduled_at) > new Date()
              ? `This round opens ${new Date(round.scheduled_at).toLocaleString()}.`
              : latest
                ? 'This round has been submitted. You can review your result below.'
                : 'This round is not open for attempts.'}
          </p>
        )}

        {attempt && (
          <div className="stack">
            {groupByLevel(activeQuestions).map(([levelNumber, levelQuestions]) => (
              <div key={levelNumber} className="level-block">
                <h3 className="small">{levelQuestions[0]?.level_title ?? `Level ${levelNumber}`}</h3>
                <div className="stack">
                  {levelQuestions.map((question: any) => (
                    <div key={question.id} className="attempt-question">
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <strong>{question.question_text}</strong>
                        <span className="row">
                          <Badge>{question.question_type}</Badge>
                          <Badge>{question.marks} marks</Badge>
                        </span>
                      </div>
                      <QuestionInput
                        question={question}
                        value={answers[question.id]}
                        onChange={(value) => setAnswer(question.id, value)}
                        onToggleMulti={(option) => toggleMulti(question.id, option)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted small">
                {unanswered > 0 ? `${unanswered} question(s) unanswered` : 'All questions answered'}
              </span>
              <Button onClick={submit} disabled={busy}>
                {busy ? 'Submitting…' : 'Submit attempt'}
              </Button>
            </div>
          </div>
        )}

        {resultId && <AttemptResult attemptId={resultId} onClose={() => setResultId(null)} />}

        {attempts.length > 0 && (
          <div className="stack">
            <h3 className="small">Your attempts</h3>
            <table>
              <thead>
                <tr>
                  <th>Attempt</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {attempts.map((row: any) => (
                  <tr key={row.id}>
                    <td>#{row.attempt_number}</td>
                    <td>
                      <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                    </td>
                    <td>{row.total_score ?? '—'}</td>
                    <td>{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : '—'}</td>
                    <td>
                      {row.status !== 'in_progress' && (
                        <Button variant="ghost" onClick={() => setResultId(row.id)}>
                          Result
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {latest?.mentor_feedback && (
              <p className="muted small">Mentor feedback: {latest.mentor_feedback}</p>
            )}
          </div>
        )}

      </div>
    </Card>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
  onToggleMulti,
}: {
  question: any;
  value: unknown;
  onChange: (value: unknown) => void;
  onToggleMulti: (option: string) => void;
}) {
  const options: string[] = Array.isArray(question.options) ? question.options : [];

  if (question.question_type === 'true_false') {
    return (
      <div className="stack">
        {['true', 'false'].map((option) => (
          <label key={option} className="option">
            <input
              type="radio"
              name={`q-${question.id}`}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {option === 'true' ? 'True' : 'False'}
          </label>
        ))}
      </div>
    );
  }

  if (question.question_type === 'multiple_select') {
    return (
      <div className="stack">
        {options.map((option) => {
          const selected = Array.isArray(value) && value.includes(option);
          return (
            <label key={option} className="option">
              <input type="checkbox" checked={selected} onChange={() => onToggleMulti(option)} />
              {option}
            </label>
          );
        })}
      </div>
    );
  }

  if (question.question_type === 'mcq' && options.length > 0) {
    return (
      <div className="stack">
        {options.map((option) => (
          <label key={option} className="option">
            <input
              type="radio"
              name={`q-${question.id}`}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {option}
          </label>
        ))}
      </div>
    );
  }

  if (question.question_type === 'short_answer') {
    return (
      <Input
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Your answer"
      />
    );
  }

  return (
    <Textarea
      rows={question.question_type === 'coding' ? 8 : 5}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={
        question.question_type === 'coding'
          ? 'Paste your solution'
          : 'Write your answer — your mentor will review it'
      }
    />
  );
}

function groupByLevel(questions: any[]): Array<[number, any[]]> {
  const groups = new Map<number, any[]>();
  for (const question of questions) {
    const level = Number(question.level_number ?? 1);
    const bucket = groups.get(level) ?? [];
    bucket.push(question);
    groups.set(level, bucket);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function AttemptResult({ attemptId, onClose }: { attemptId: number; onClose: () => void }) {
  const result = useLoad<any>(`/candidate/attempts/${attemptId}/result`);

  if (result.loading && !result.data) return <Spinner />;
  if (!result.data) return <ErrorNote error={result.error} />;

  const { attempt, answers, maxScore, carriedScore = 0 } = result.data;
  const possible = Number(maxScore) + Number(carriedScore);

  return (
    <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <Badge tone={statusTone(attempt.status)}>{attempt.status}</Badge>
          <Stat label="Score" value={`${attempt.total_score ?? '—'} / ${possible}`} />
          {Number(carriedScore) > 0 && (
            <Badge tone="success">{Number(carriedScore)} carried forward</Badge>
          )}
        </div>
        <Button variant="ghost" onClick={onClose}>
          Hide result
        </Button>
      </div>
      {attempt.mentor_feedback && (
        <p className="small">Mentor feedback: {attempt.mentor_feedback}</p>
      )}
      {answers.map((answer: any) => (
        <div key={answer.question_id} className="attempt-question">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{answer.question_text}</strong>
            <span className="row">
              <Badge>{answer.question_type}</Badge>
              <Badge>
                {answer.final_score ?? answer.auto_score ?? '—'} / {answer.marks}
              </Badge>
            </span>
          </div>
          <p className="small">
            Your answer: <span className="muted">{displayAnswer(answer.answer)}</span>
          </p>
          {answer.feedback && <p className="small">Feedback: {answer.feedback}</p>}
        </div>
      ))}
    </div>
  );
}

function displayAnswer(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function CandidateIntroductions() {
  const introductions = useLoad<any[]>('/candidate/introductions');
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const respond = async (id: number, status: 'accepted' | 'rejected') => {
    setError(null);
    setBusyId(id);
    try {
      await api(`/candidate/introductions/${id}/respond`, { method: 'POST', body: { status } });
      introductions.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const items = introductions.data ?? [];

  return (
    <Card
      title="Introductions"
      subtitle="Companies can only see your name and contact details after you accept."
    >
      <div className="stack">
        <ErrorNote error={error ?? introductions.error} />
        {introductions.loading && <Spinner />}
        {!introductions.loading && items.length === 0 && (
          <Empty>No company has requested an introduction yet.</Empty>
        )}
        {items.map((item: any) => (
          <div key={item.id} className="attempt-question">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{item.company_name}</strong>
                <div className="muted small">
                  {item.industry ?? 'Company'}
                  {item.requester_first_name
                    ? ` · ${item.requester_first_name} ${item.requester_last_name}`
                    : ''}
                </div>
              </div>
              <Badge tone={statusTone(item.status)}>{item.status}</Badge>
            </div>
            <p className="small">{item.message}</p>
            {item.website && <p className="muted small">{item.website}</p>}
            {item.status === 'accepted' && item.requester_email && (
              <p className="small">Contact: {item.requester_email}</p>
            )}
            {item.status === 'pending' && (
              <div className="row">
                <Button
                  variant="success"
                  onClick={() => respond(item.id, 'accepted')}
                  disabled={busyId === item.id}
                >
                  Accept
                </Button>
                <Button
                  variant="danger"
                  onClick={() => respond(item.id, 'rejected')}
                  disabled={busyId === item.id}
                >
                  Reject
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
