import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  Input,
  Select,
  Textarea,
  statusTone,
  useLoad,
} from '../components';

const QUESTION_TYPES = [
  ['mcq', 'Multiple choice'],
  ['multiple_select', 'Multiple select'],
  ['true_false', 'True / false'],
  ['short_answer', 'Short answer'],
  ['descriptive', 'Descriptive'],
  ['coding', 'Coding'],
  ['practical', 'Practical'],
];

export function MentorPage({ tab }: { tab: string }) {
  if (tab === 'candidates') return <MentorCandidates />;
  if (tab === 'assessments') return <MentorAssessments />;
  return <MentorRankings />;
}

function MentorCandidates() {
  const assignments = useLoad<any[]>('/mentor/candidates');
  const templates = useLoad<any[]>('/mentor/templates');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = useLoad<any>(selectedId ? `/mentor/assignments/${selectedId}` : null);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [form, setForm] = useState({ templateId: '', scheduledAt: '' });
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  const createRound = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice('');
    try {
      await api('/mentor/rounds', {
        method: 'POST',
        body: {
          mentorAssignmentId: selectedId,
          templateId: Number(form.templateId),
          scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
        },
      });
      setNotice('Round created and candidate notified.');
      detail.reload();
      setForm({ templateId: '', scheduledAt: '' });
    } catch (err) {
      setError(err);
    }
  };

  return (
    <>
      <div className="grid2">
        <Card title="Assigned candidates" subtitle="Every candidate routed to you">
          {(assignments.data ?? []).length === 0 && <Empty>No candidates assigned yet.</Empty>}
          <div className="stack">
            {(assignments.data ?? []).map((assignment) => (
              <button
                key={assignment.id}
                className="row"
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: 12,
                  background: selectedId === assignment.id ? '#f5f5ff' : 'white',
                  cursor: 'pointer',
                  textAlign: 'left',
                  justifyContent: 'space-between',
                }}
                onClick={() => {
                  setSelectedId(assignment.id);
                  setRoundId(null);
                }}
              >
                <span>
                  <strong>
                    {assignment.first_name} {assignment.last_name}
                  </strong>
                  <div className="muted small">
                    {assignment.professional_title ?? 'Candidate'} ·{' '}
                    {assignment.total_experience_years ?? '—'} yrs · {assignment.job_role ?? '—'}
                  </div>
                </span>
                <span className="row">
                  {assignment.best_score != null && <Badge tone="success">{assignment.best_score}</Badge>}
                  <Badge>{assignment.rounds_count} rounds</Badge>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Selected candidate" subtitle="Profile, skills and round history">
          {!selectedId && <Empty>Select a candidate to see their record.</Empty>}
          {detail.data && (
            <div className="stack">
              <div>
                <h3>
                  {detail.data.assignment.first_name} {detail.data.assignment.last_name}
                </h3>
                <p className="muted small">
                  {detail.data.assignment.professional_title ?? 'Candidate'} ·{' '}
                  {detail.data.assignment.total_experience_years ?? '—'} yrs ·{' '}
                  {detail.data.assignment.location ?? '—'}
                </p>
              </div>
              <div className="row">
                {(detail.data.assignment.skills ?? []).map((skill: any) => (
                  <Badge key={skill.skill}>{skill.skill}</Badge>
                ))}
              </div>
              <form className="stack" onSubmit={createRound}>
                <div className="grid2">
                  <Field label="Assessment template">
                    <Select
                      value={form.templateId}
                      onChange={(e) => setForm({ ...form, templateId: e.target.value })}
                      required
                    >
                      <option value="">Choose a template</option>
                      {(templates.data ?? []).map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.title} (v{template.latest_version})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Schedule (optional)">
                    <Input
                      type="datetime-local"
                      value={form.scheduledAt}
                      onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                    />
                  </Field>
                </div>
                <ErrorNote error={error} />
                {notice && <p className="badge success">{notice}</p>}
                <div>
                  <Button type="submit">Create round</Button>
                </div>
              </form>

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
                    {(detail.data.rounds ?? []).map((round: any) => (
                      <tr key={round.id}>
                        <td>
                          {round.round_number}. {round.title}
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
                          {round.latest_attempt
                            ? `${round.latest_attempt.status} · ${round.latest_attempt.total_score ?? '—'}`
                            : 'not attempted'}
                        </td>
                        <td>
                          <Button variant="ghost" onClick={() => setRoundId(round.id)}>
                            Open
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      </div>

      {roundId && <RoundMonitor roundId={roundId} onClose={() => setRoundId(null)} />}
    </>
  );
}

function RoundMonitor({ roundId, onClose }: { roundId: number; onClose: () => void }) {
  const detail = useLoad<any>(`/mentor/rounds/${roundId}`);
  const [scores, setScores] = useState<Record<number, { mentorScore: string; feedback: string }>>({});
  const [mentorFeedback, setMentorFeedback] = useState('');
  const [decision, setDecision] = useState({ decision: 'proceed', remarks: '', nextAssessmentAt: '' });
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');

  const latest = useMemo(() => {
    const attempts = detail.data?.attempts ?? [];
    return attempts.length ? attempts[attempts.length - 1] : null;
  }, [detail.data]);

  useEffect(() => {
    if (!detail.data || !latest) return;
    const next: Record<number, { mentorScore: string; feedback: string }> = {};
    for (const answer of detail.data.answers) {
      if (answer.attempt_id !== latest.id) continue;
      next[answer.question_id] = {
        mentorScore: answer.mentor_score ?? '',
        feedback: answer.feedback ?? '',
      };
    }
    setScores(next);
    setMentorFeedback(latest.mentor_feedback ?? '');
  }, [latest?.id, detail.data]);

  const evaluate = async () => {
    setError(null);
    setNotice('');
    try {
      const payload = Object.entries(scores)
        .filter(([, value]) => value.mentorScore !== '')
        .map(([questionId, value]) => ({
          questionId: Number(questionId),
          mentorScore: Number(value.mentorScore),
          feedback: value.feedback || null,
        }));
      const result = await api<{ totalScore: number }>(`/mentor/attempts/${latest.id}/evaluate`, {
        method: 'POST',
        body: { scores: payload, mentorFeedback, status: 'evaluated' },
      });
      setNotice(`Evaluation saved. Total: ${result.totalScore}`);
      detail.reload();
    } catch (err) {
      setError(err);
    }
  };

  const saveDecision = async () => {
    setError(null);
    setNotice('');
    try {
      await api(`/mentor/rounds/${roundId}/decision`, {
        method: 'POST',
        body: {
          decision: decision.decision,
          remarks: decision.remarks || null,
          nextAssessmentAt: decision.nextAssessmentAt
            ? new Date(decision.nextAssessmentAt).toISOString()
            : null,
        },
      });
      setNotice('Decision recorded.');
      detail.reload();
    } catch (err) {
      setError(err);
    }
  };

  if (detail.loading) return <Card title="Round">Loading…</Card>;
  if (!detail.data) return <Card title="Round">Could not load this round.</Card>;

  const { round, questions, attempts, answers, events } = detail.data;

  return (
    <Card
      title={`${round.first_name} ${round.last_name} · ${round.title}`}
      subtitle={`Round ${round.round_number} · version ${round.version_number ?? '—'} · ${round.status}`}
      actions={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="stack">
        <div className="row">
          <Badge tone={statusTone(round.status)}>{round.status}</Badge>
          {round.decision && (
            <Badge tone={statusTone(round.decision)}>decision: {round.decision}</Badge>
          )}
          <Badge>{round.duration_minutes ?? '—'} min</Badge>
          <Badge>{attempts.length} attempt(s)</Badge>
        </div>

        <h3 className="small">Questions & answer keys</h3>
        <div className="stack">
          {questions.map((question: any) => (
            <div key={question.id} className="attempt-question">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{question.question_text}</strong>
                <Badge>{question.question_type}</Badge>
              </div>
              <p className="muted small">Answer key: {question.answer_key ?? 'mentor scored'}</p>
              <p className="small">Marks: {question.marks}</p>
            </div>
          ))}
        </div>

        {latest && (
          <>
            <h3 className="small">Evaluate attempt {latest.attempt_number}</h3>
            <div className="stack">
              {questions.map((question: any) => {
                const answer = answers.find(
                  (a: any) => a.attempt_id === latest.id && a.question_id === question.id,
                );
                const value = scores[question.id] ?? { mentorScore: '', feedback: '' };
                return (
                  <div key={question.id} className="attempt-question">
                    <strong>{question.question_text}</strong>
                    <p className="small">
                      Candidate answer:{' '}
                      <span className="muted">
                        {typeof answer?.answer === 'string'
                          ? answer.answer
                          : JSON.stringify(answer?.answer ?? '—')}
                      </span>
                    </p>
                    <p className="muted small">
                      auto {answer?.auto_score ?? '—'} · final {answer?.final_score ?? '—'} /{' '}
                      {question.marks}
                    </p>
                    <div className="grid2">
                      <Field label="Mentor score">
                        <Input
                          type="number"
                          min={0}
                          max={Number(question.marks)}
                          step="0.5"
                          value={value.mentorScore}
                          onChange={(e) =>
                            setScores((prev) => ({
                              ...prev,
                              [question.id]: { ...value, mentorScore: e.target.value },
                            }))
                          }
                        />
                      </Field>
                      <Field label="Feedback">
                        <Input
                          value={value.feedback}
                          onChange={(e) =>
                            setScores((prev) => ({
                              ...prev,
                              [question.id]: { ...value, feedback: e.target.value },
                            }))
                          }
                        />
                      </Field>
                    </div>
                  </div>
                );
              })}
              <Field label="Overall mentor feedback">
                <Textarea
                  value={mentorFeedback}
                  onChange={(e) => setMentorFeedback(e.target.value)}
                />
              </Field>
              <div>
                <Button onClick={evaluate}>Save evaluation</Button>
              </div>
            </div>
          </>
        )}

        <h3 className="small">Decision</h3>
        <div className="grid2">
          <Field label="Decision">
            <Select
              value={decision.decision}
              onChange={(e) => setDecision({ ...decision, decision: e.target.value })}
            >
              <option value="proceed">Proceed</option>
              <option value="reject">Reject</option>
              <option value="hold">Hold</option>
              <option value="reschedule">Reschedule</option>
            </Select>
          </Field>
          <Field label="Next assessment (for reschedule)">
            <Input
              type="datetime-local"
              value={decision.nextAssessmentAt}
              onChange={(e) => setDecision({ ...decision, nextAssessmentAt: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Remarks">
          <Textarea
            value={decision.remarks}
            onChange={(e) => setDecision({ ...decision, remarks: e.target.value })}
          />
        </Field>
        <div>
          <Button variant="success" onClick={saveDecision}>
            Record decision
          </Button>
        </div>

        <ErrorNote error={error} />
        {notice && <p className="badge success">{notice}</p>}

        <h3 className="small">Monitoring events</h3>
        {events.length === 0 ? (
          <Empty>No monitoring events recorded.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event: any) => (
                <tr key={event.id}>
                  <td>{new Date(event.event_timestamp).toLocaleString()}</td>
                  <td>{event.event_type}</td>
                  <td>
                    <code className="small">{JSON.stringify(event.event_details)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Events are signals, not proof of misconduct. Monitoring is disclosed to candidates.
        </p>
      </div>
    </Card>
  );
}

type BuilderQuestion = {
  questionKey: string;
  questionText: string;
  questionType: string;
  options: string;
  answerKey: string;
  marks: number;
};

type BuilderLevel = { title: string; questions: BuilderQuestion[] };

function newQuestion(): BuilderQuestion {
  return {
    questionKey: `q_${crypto.randomUUID().slice(0, 8)}`,
    questionText: '',
    questionType: 'mcq',
    options: '',
    answerKey: '',
    marks: 10,
  };
}

function MentorAssessments() {
  const templates = useLoad<any[]>('/mentor/templates');
  const [editing, setEditing] = useState<any>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);

  const openVersion = async (template: any) => {
    setLoadingEdit(true);
    try {
      const detail = await api<any>(`/mentor/templates/${template.id}`);
      const latest = detail.versions[0];
      setEditing({
        id: detail.id,
        title: detail.title,
        snapshot: latest.snapshot,
      });
    } finally {
      setLoadingEdit(false);
    }
  };

  return (
    <>
      <Card
        title="Assessment templates"
        subtitle="Published versions are immutable; edits publish a new version and re-assess earlier candidates."
        actions={
          <Button
            onClick={() =>
              setEditing({
                title: '',
                snapshot: { title: '', durationMinutes: 30, levels: [] },
              })
            }
          >
            New template
          </Button>
        }
      >
        {loadingEdit && <p className="muted">Loading template…</p>}
        {(templates.data ?? []).length === 0 ? (
          <Empty>No templates yet. Create your first assessment.</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Latest version</th>
                  <th>Versions</th>
                  <th>Rounds using</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(templates.data ?? []).map((template) => (
                  <tr key={template.id}>
                    <td>
                      <strong>{template.title}</strong>
                    </td>
                    <td>v{template.latest_version}</td>
                    <td>{template.versions}</td>
                    <td>{template.rounds_using}</td>
                    <td>{new Date(template.created_at).toLocaleDateString()}</td>
                    <td>
                      <Button variant="ghost" onClick={() => openVersion(template)}>
                        New version
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <TemplateBuilder
          key={editing.id ?? 'new'}
          templateId={editing.id}
          title={editing.title}
          snapshot={editing.snapshot}
          onClose={() => setEditing(null)}
          onSaved={() => templates.reload()}
        />
      )}
    </>
  );
}

function snapshotToLevels(snapshot: any): BuilderLevel[] {
  return (snapshot.levels ?? []).map((level: any) => ({
    title: level.title ?? '',
    questions: (level.questions ?? []).map((question: any) => ({
      questionKey: question.questionKey,
      questionText: question.questionText,
      questionType: question.questionType,
      options: (question.options ?? []).join(', '),
      answerKey: question.answerKey ?? '',
      marks: Number(question.marks ?? 10),
    })),
  }));
}

function TemplateBuilder({
  templateId,
  title: initialTitle,
  snapshot,
  onClose,
  onSaved,
}: {
  templateId?: number;
  title: string;
  snapshot: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initialTitle || snapshot.title || '');
  const [duration, setDuration] = useState(Number(snapshot.durationMinutes ?? 30));
  const [levels, setLevels] = useState<BuilderLevel[]>(
    snapshotToLevels(snapshot).length
      ? snapshotToLevels(snapshot)
      : [{ title: 'Level 1', questions: [newQuestion()] }],
  );
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [impact, setImpact] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const buildSnapshot = () => ({
    title: title || 'Untitled assessment',
    durationMinutes: duration || 30,
    levels: levels.map((level, levelIndex) => ({
      levelNumber: levelIndex + 1,
      title: level.title || `Level ${levelIndex + 1}`,
      questions: level.questions.map((question, index) => ({
        questionKey: question.questionKey,
        questionText: question.questionText,
        questionType: question.questionType,
        options: ['mcq', 'multiple_select', 'true_false'].includes(question.questionType)
          ? question.options
              .split(',')
              .map((option) => option.trim())
              .filter(Boolean)
          : null,
        answerKey: question.answerKey || null,
        marks: Number(question.marks || 0),
        sequenceOrder: index + 1,
      })),
    })),
  });

  const updateLevel = (index: number, patch: Partial<BuilderLevel>) =>
    setLevels((prev) => prev.map((level, i) => (i === index ? { ...level, ...patch } : level)));

  const updateQuestion = (
    levelIndex: number,
    questionIndex: number,
    patch: Partial<BuilderQuestion>,
  ) =>
    setLevels((prev) =>
      prev.map((level, i) =>
        i !== levelIndex
          ? level
          : {
              ...level,
              questions: level.questions.map((question, j) =>
                j === questionIndex ? { ...question, ...patch } : question,
              ),
            },
      ),
    );

  const preview = async () => {
    setError(null);
    setImpact(null);
    try {
      const result = await api<any>(`/mentor/templates/${templateId}/impact`, {
        method: 'POST',
        body: { title, snapshot: buildSnapshot() },
      });
      setImpact(result);
    } catch (err) {
      setError(err);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const body = { title, snapshot: buildSnapshot() };
      if (templateId) {
        const result = await api<any>(`/mentor/templates/${templateId}/versions`, {
          method: 'POST',
          body,
        });
        setNotice(
          `Published v${result.version}. ${result.affected} candidate(s) queued for re-assessment.`,
        );
      } else {
        await api('/mentor/templates', { method: 'POST', body });
        setNotice('Template published as v1.');
      }
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={templateId ? `New version: ${initialTitle}` : 'New assessment template'}
      subtitle="Stable question keys let the diff engine find what changed."
      actions={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="stack">
        <div className="grid2">
          <Field label="Template title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field label="Duration (minutes)">
            <Input
              type="number"
              min={1}
              max={600}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </Field>
        </div>

        {levels.map((level, levelIndex) => (
          <div className="level-block" key={levelIndex}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>Level {levelIndex + 1}</strong>
              {levels.length > 1 && (
                <button
                  className="link-button"
                  onClick={() => setLevels((prev) => prev.filter((_, i) => i !== levelIndex))}
                >
                  Remove level
                </button>
              )}
            </div>
            <Field label="Level title">
              <Input
                value={level.title}
                onChange={(e) => updateLevel(levelIndex, { title: e.target.value })}
              />
            </Field>

            {level.questions.map((question, questionIndex) => (
              <div className="question-editor" key={question.questionKey}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong className="small">Question {questionIndex + 1}</strong>
                  {level.questions.length > 1 && (
                    <button
                      className="link-button"
                      onClick={() =>
                        updateLevel(levelIndex, {
                          questions: level.questions.filter((_, i) => i !== questionIndex),
                        })
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
                <Field label="Question text">
                  <Textarea
                    value={question.questionText}
                    onChange={(e) =>
                      updateQuestion(levelIndex, questionIndex, {
                        questionText: e.target.value,
                      })
                    }
                  />
                </Field>
                <div className="grid3">
                  <Field label="Type">
                    <Select
                      value={question.questionType}
                      onChange={(e) =>
                        updateQuestion(levelIndex, questionIndex, {
                          questionType: e.target.value,
                          options:
                            e.target.value === 'true_false' && !question.options
                              ? 'true, false'
                              : question.options,
                        })
                      }
                    >
                      {QUESTION_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Marks">
                    <Input
                      type="number"
                      min={0}
                      value={question.marks}
                      onChange={(e) =>
                        updateQuestion(levelIndex, questionIndex, {
                          marks: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="Key" hint="Stable across versions">
                    <Input
                      value={question.questionKey}
                      onChange={(e) =>
                        updateQuestion(levelIndex, questionIndex, {
                          questionKey: e.target.value,
                        })
                      }
                    />
                  </Field>
                </div>
                {['mcq', 'multiple_select', 'true_false'].includes(question.questionType) && (
                  <Field label="Options (comma separated)">
                    <Input
                      value={question.options}
                      onChange={(e) =>
                        updateQuestion(levelIndex, questionIndex, { options: e.target.value })
                      }
                    />
                  </Field>
                )}
                <Field
                  label="Answer key / rubric"
                  hint={
                    ['descriptive', 'coding', 'practical'].includes(question.questionType)
                      ? 'Shown to the mentor only; no auto-scoring.'
                      : 'Used for auto-scoring. Comma separate multiple-select answers.'
                  }
                >
                  <Textarea
                    value={question.answerKey}
                    onChange={(e) =>
                      updateQuestion(levelIndex, questionIndex, {
                        answerKey: e.target.value,
                      })
                    }
                  />
                </Field>
              </div>
            ))}

            <div>
              <Button
                variant="ghost"
                onClick={() =>
                  updateLevel(levelIndex, { questions: [...level.questions, newQuestion()] })
                }
              >
                Add question
              </Button>
            </div>
          </div>
        ))}

        <div className="row">
          <Button
            variant="ghost"
            onClick={() =>
              setLevels((prev) => [
                ...prev,
                { title: `Level ${prev.length + 1}`, questions: [newQuestion()] },
              ])
            }
          >
            Add level
          </Button>
        </div>

        {impact && (
          <div className="card" style={{ background: '#fbfcff' }}>
            <strong className="small">Impact preview</strong>
            <p className="small">
              Affected candidates: {impact.affected}. Added: {impact.diff.added.join(', ') || '—'} ·
              Removed: {impact.diff.removed.join(', ') || '—'} · Changed:{' '}
              {impact.diff.changed.join(', ') || '—'}
            </p>
            {impact.candidates?.length > 0 && (
              <p className="muted small">
                {impact.candidates.map((c: any) => `${c.first_name} ${c.last_name}`).join(', ')}
              </p>
            )}
          </div>
        )}

        <ErrorNote error={error} />
        {notice && <p className="badge success">{notice}</p>}

        <div className="row">
          {templateId && (
            <Button variant="ghost" onClick={preview}>
              Preview impact
            </Button>
          )}
          <Button onClick={save} disabled={busy}>
            {busy ? 'Publishing…' : templateId ? 'Publish new version' : 'Publish template'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function MentorRankings() {
  const rankings = useLoad<any[]>('/mentor/rankings');
  return (
    <Card title="Candidate rankings" subtitle="Latest evaluated score for each assigned candidate">
      {(rankings.data ?? []).length === 0 ? (
        <Empty>No evaluated candidates yet.</Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Candidate</th>
                <th>Profile</th>
                <th>Experience</th>
                <th>Round</th>
                <th>Score</th>
                <th>Decision</th>
                <th>Evaluated</th>
              </tr>
            </thead>
            <tbody>
              {(rankings.data ?? []).map((row, index) => (
                <tr key={row.assignment_id}>
                  <td>{index + 1}</td>
                  <td>
                    {row.first_name} {row.last_name}
                  </td>
                  <td>{row.professional_title ?? '—'}</td>
                  <td>{row.total_experience_years ?? '—'} yrs</td>
                  <td>
                    {row.round_number ? `${row.round_number} (v${row.version_number ?? '—'})` : '—'}
                  </td>
                  <td>
                    <Badge tone={row.total_score != null ? 'success' : 'neutral'}>
                      {row.total_score ?? '—'}
                    </Badge>
                  </td>
                  <td>{row.decision ? <Badge>{row.decision}</Badge> : '—'}</td>
                  <td>
                    {row.evaluated_at ? new Date(row.evaluated_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
