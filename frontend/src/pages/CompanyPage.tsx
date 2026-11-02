import { useMemo, useState } from 'react';
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
  Spinner,
  Stat,
  Textarea,
  statusTone,
  useLoad,
} from '../components';

export function CompanyPage({ tab }: { tab: string }) {
  if (tab === 'introductions') return <CompanyIntroductions />;
  if (tab === 'profile') return <CompanyProfile />;
  return <CompanySearch />;
}

type Filters = {
  q: string;
  role: string;
  skill: string;
  minExperience: string;
  minScore: string;
};

const emptyFilters: Filters = { q: '', role: '', skill: '', minExperience: '', minScore: '' };

function CompanySearch() {
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters });
  const [applied, setApplied] = useState<Filters>({ ...emptyFilters });
  const [selected, setSelected] = useState<string | null>(null);
  const meta = useLoad<any>('/meta');

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (applied.q) params.set('q', applied.q);
    if (applied.role) params.set('role', applied.role);
    if (applied.skill) params.set('skill', applied.skill);
    if (applied.minExperience) params.set('minExperience', applied.minExperience);
    if (applied.minScore) params.set('minScore', applied.minScore);
    const query = params.toString();
    return `/company/search${query ? `?${query}` : ''}`;
  }, [applied]);

  const results = useLoad<any[]>(path);
  const rows = results.data ?? [];
  const total = rows[0]?.total ?? rows.length;

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    setSelected(null);
    setApplied({ ...filters });
  };

  return (
    <div className="stack">
      <Card
        title="Candidate search"
        subtitle="Anonymised results. Names, contact details and resumes stay hidden until the candidate accepts your introduction."
      >
        <form className="stack" onSubmit={search}>
          <div className="grid3">
            <Field label="Title or location">
              <Input
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                placeholder="React developer, Pune…"
              />
            </Field>
            <Field label="Role applied for">
              <Select
                value={filters.role}
                onChange={(e) => setFilters({ ...filters, role: e.target.value })}
              >
                <option value="">Any role</option>
                {(meta.data?.jobRoles ?? []).map((role: any) => (
                  <option key={role.id} value={role.title}>
                    {role.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Skill">
              <Input
                value={filters.skill}
                onChange={(e) => setFilters({ ...filters, skill: e.target.value })}
                placeholder="TypeScript"
              />
            </Field>
            <Field label="Minimum experience (years)">
              <Input
                type="number"
                min={0}
                max={70}
                value={filters.minExperience}
                onChange={(e) => setFilters({ ...filters, minExperience: e.target.value })}
              />
            </Field>
            <Field label="Minimum latest score">
              <Input
                type="number"
                min={0}
                value={filters.minScore}
                onChange={(e) => setFilters({ ...filters, minScore: e.target.value })}
              />
            </Field>
          </div>
          <div className="row">
            <Button type="submit">Search candidates</Button>
            <Button
              variant="ghost"
              onClick={() => {
                setFilters({ ...emptyFilters });
                setApplied({ ...emptyFilters });
                setSelected(null);
              }}
            >
              Reset
            </Button>
          </div>
        </form>
      </Card>

      <div className="grid2">
        <Card
          title="Matches"
          subtitle={results.loading ? 'Searching…' : `${total} anonymised candidate(s)`}
        >
          <div className="stack">
            <ErrorNote error={results.error} />
            {results.loading && <Spinner />}
            {!results.loading && rows.length === 0 && (
              <Empty>No discoverable candidates match these filters.</Empty>
            )}
            {rows.map((candidate: any) => (
              <button
                key={candidate.candidate_ref}
                className="row"
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: 12,
                  background: selected === candidate.candidate_ref ? '#f5f5ff' : 'white',
                  cursor: 'pointer',
                  textAlign: 'left',
                  justifyContent: 'space-between',
                }}
                onClick={() => setSelected(candidate.candidate_ref)}
              >
                <span>
                  <strong>{candidate.professional_title ?? 'Candidate'}</strong>
                  <div className="muted small">
                    {candidate.location ?? 'Location hidden'} · {candidate.experience_band} yrs ·{' '}
                    {candidate.availability ?? 'Availability unknown'}
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    {(candidate.job_roles ?? []).map((role: string) => (
                      <Badge key={role} tone="success">
                        {role}
                      </Badge>
                    ))}
                    {(candidate.skills ?? []).slice(0, 5).map((skill: string) => (
                      <Badge key={skill}>{skill}</Badge>
                    ))}
                  </div>
                </span>
                <span className="stack" style={{ alignItems: 'flex-end', gap: 4 }}>
                  {candidate.latest_score != null ? (
                    <Badge tone="success">
                      {candidate.latest_score} · v{candidate.latest_assessment_version ?? '—'}
                    </Badge>
                  ) : (
                    <Badge>not assessed</Badge>
                  )}
                  <span className="muted small">
                    {candidate.assessments_taken ?? 0} assessment(s)
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Candidate detail" subtitle="Request an introduction to unlock contact details">
          {!selected && <Empty>Select a candidate to see their anonymised profile.</Empty>}
          {selected && <CandidateDetail key={selected} candidateRef={selected} />}
        </Card>
      </div>
    </div>
  );
}

function CandidateDetail({ candidateRef }: { candidateRef: string }) {
  const detail = useLoad<any>(`/company/search/${candidateRef}`);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const request = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice('');
    setBusy(true);
    try {
      await api('/company/introductions', {
        method: 'POST',
        body: { candidateRef, message },
      });
      setNotice('Introduction requested. The candidate has been notified.');
      setMessage('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (detail.loading && !detail.data) return <Spinner />;
  if (!detail.data) return <ErrorNote error={detail.error} />;

  const candidate = detail.data;

  return (
    <div className="stack">
      <div>
        <h3>{candidate.professional_title ?? 'Candidate'}</h3>
        <p className="muted small">
          {candidate.location ?? 'Location hidden'} · {candidate.experience_band} yrs experience ·{' '}
          {candidate.availability ?? 'Availability unknown'}
        </p>
        <p className="muted small">Ref: {candidate.candidate_ref}</p>
        <div className="row" style={{ marginTop: 8 }}>
          {(candidate.job_roles ?? []).map((role: string) => (
            <Badge key={role} tone="success">
              {role}
            </Badge>
          ))}
        </div>
      </div>
      <div className="grid3">
        <Stat label="Latest score" value={candidate.latest_score ?? '—'} hint={
          candidate.latest_assessment_version
            ? `version ${candidate.latest_assessment_version}`
            : 'not assessed'
        } />
        <Stat label="Assessments" value={candidate.assessments_taken ?? 0} hint="evaluated" />
        <Stat label="Experience" value={candidate.experience_band} hint="years band" />
      </div>
      <div className="row">
        {(candidate.skills ?? []).map((skill: string) => (
          <Badge key={skill}>{skill}</Badge>
        ))}
      </div>
      <form className="stack" onSubmit={request}>
        <Field
          label="Introduction message"
          hint="Explain the role and why you would like to speak. Minimum 10 characters."
        >
          <Textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="We are hiring a senior frontend engineer…"
            required
            minLength={10}
          />
        </Field>
        <ErrorNote error={error} />
        {notice && <p className="badge success">{notice}</p>}
        <div>
          <Button type="submit" disabled={busy || message.trim().length < 10}>
            Request introduction
          </Button>
        </div>
      </form>
    </div>
  );
}

function CompanyIntroductions() {
  const introductions = useLoad<any[]>('/company/introductions');
  const [error, setError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const withdraw = async (id: number) => {
    setError(null);
    setBusyId(id);
    try {
      await api(`/company/introductions/${id}/withdraw`, { method: 'POST' });
      introductions.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  };

  const rows = introductions.data ?? [];

  return (
    <Card
      title="Introductions"
      subtitle="Contact details appear only after a candidate accepts."
    >
      <div className="stack">
        <ErrorNote error={error ?? introductions.error} />
        {introductions.loading && <Spinner />}
        {!introductions.loading && rows.length === 0 && (
          <Empty>No introduction requests yet. Search candidates to send one.</Empty>
        )}
        {rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Contact</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => (
                  <tr key={row.id}>
                    <td>
                      {row.status === 'accepted' && row.candidate_first_name ? (
                        <strong>
                          {row.candidate_first_name} {row.candidate_last_name}
                        </strong>
                      ) : (
                        <strong>{row.professional_title ?? 'Candidate'}</strong>
                      )}
                      <div className="muted small">
                        {row.location ?? '—'} · {row.total_experience_years ?? '—'} yrs
                      </div>
                    </td>
                    <td>
                      <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                    </td>
                    <td className="small">{new Date(row.requested_at).toLocaleString()}</td>
                    <td className="small">
                      {row.status === 'accepted' ? (
                        <>
                          <div>{row.candidate_email ?? '—'}</div>
                          <div className="muted">{row.candidate_phone ?? '—'}</div>
                        </>
                      ) : (
                        <span className="muted">hidden until accepted</span>
                      )}
                    </td>
                    <td>
                      {row.status === 'pending' && (
                        <Button
                          variant="ghost"
                          onClick={() => withdraw(row.id)}
                          disabled={busyId === row.id}
                        >
                          Withdraw
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function CompanyProfile() {
  const company = useLoad<any>('/company/me');

  if (company.loading && !company.data) return <Spinner />;
  if (!company.data) {
    return (
      <Card title="Company profile">
        <ErrorNote error={company.error} />
      </Card>
    );
  }

  const profile = company.data;

  return (
    <Card title="Company profile" subtitle="Your company identity on Hiring Intelligence">
      <div className="stack">
        <div>
          <h3>{profile.company_name}</h3>
          <p className="muted small">
            {profile.industry ?? 'Industry not set'}
            {profile.website ? ` · ${profile.website}` : ''}
          </p>
        </div>
        <div className="row">
          <Badge tone={statusTone(profile.status)}>{profile.status}</Badge>
          <Badge>{profile.members} member(s)</Badge>
          <Badge>company #{profile.id}</Badge>
        </div>
        <p className="muted small">
          To change the company name, industry or website, contact an administrator.
        </p>
      </div>
    </Card>
  );
}
