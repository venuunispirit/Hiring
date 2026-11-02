import { useEffect, useState } from 'react';
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
import { AuditTable } from './SuperAdminPage';

export function AdminPage({ tab }: { tab: string }) {
  const [status, setStatus] = useState('pending');
  const [type, setType] = useState('');
  const query = `/applications?status=${status}${type ? `&type=${type}` : ''}`;
  const applications = useLoad<any[]>(query);
  const users = useLoad<any[]>('/admin/users');
  const audit = useLoad<any[]>('/admin/audit');
  const settings = useLoad<Record<string, unknown>>('/settings');
  const [selected, setSelected] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ notes: '', experience: '', mentorId: '', force: false });

  useEffect(() => {
    if (!selected) return;
    setForm({
      notes: '',
      experience: selected.extracted_experience ?? '',
      mentorId: '',
      force: false,
    });
    setError(null);
    setNotice('');
  }, [selected?.id]);

  const review = async (nextStatus: 'approved' | 'rejected', routeTo?: 'candidate' | 'mentor') => {
    setError(null);
    setNotice('');
    try {
      await api(`/applications/${selected.id}/review`, {
        method: 'POST',
        body: {
          status: nextStatus,
          reviewNotes: form.notes || null,
          extractedExperience: form.experience === '' ? null : Number(form.experience),
          mentorId: form.mentorId || null,
          routeTo: routeTo ?? null,
          force: form.force,
        },
      });
      setNotice(`Application ${nextStatus}.`);
      setSelected(null);
      applications.reload();
    } catch (err) {
      setError(err);
    }
  };

  const mentors = (users.data ?? []).filter(
    (u) => (u.roles ?? []).includes('mentor') && u.kyc_verified,
  );
  const threshold = Number(settings.data?.mentor_experience_threshold ?? 10);
  const reviewExperience =
    form.experience === '' ? Number(selected?.extracted_experience ?? 0) : Number(form.experience);

  return (
    <>
      {tab === 'applications' && (
        <>
          <Card
            title="Applications"
            subtitle="Analyse the resume estimate, then approve or reject."
            actions={
              <div className="row">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="">All</option>
                </Select>
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">All types</option>
                  <option value="candidate">Candidate</option>
                  <option value="mentor">Mentor</option>
                </Select>
              </div>
            }
          >
            {(applications.data ?? []).length === 0 ? (
              <Empty>No applications match this filter.</Empty>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Applicant</th>
                      <th>Type</th>
                      <th>Role</th>
                      <th>Resume</th>
                      <th>Experience</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(applications.data ?? []).map((application) => (
                      <tr key={application.id}>
                        <td>
                          <strong>
                            {application.first_name} {application.last_name}
                          </strong>
                          <div className="muted small">{application.email}</div>
                        </td>
                        <td>
                          <Badge>{application.application_type}</Badge>
                        </td>
                        <td>{application.job_role ?? '—'}</td>
                        <td>{application.file_name ?? '—'}</td>
                        <td>{application.extracted_experience ?? '—'} yrs</td>
                        <td>
                          <Badge tone={statusTone(application.status)}>{application.status}</Badge>
                        </td>
                        <td>
                          <Button variant="ghost" onClick={() => setSelected(application)}>
                            Review
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {selected && (
            <Card
              title={`Review: ${selected.first_name} ${selected.last_name}`}
              subtitle={`${selected.application_type} application · ${selected.email}`}
              actions={
                <Button variant="ghost" onClick={() => setSelected(null)}>
                  Close
                </Button>
              }
            >
              {selected.status !== 'pending' ? (
                <p className="muted">
                  This application was already {selected.status}. Review notes:{' '}
                  {selected.review_notes ?? '—'}
                </p>
              ) : (
                <div className="stack">
                  <div className="grid2">
                    <Field
                      label="Resume experience estimate (years)"
                      hint={`Threshold is ${settings.data?.mentor_experience_threshold ?? 10} years for mentors.`}
                    >
                      <Input
                        type="number"
                        min={0}
                        max={70}
                        step="0.5"
                        value={form.experience}
                        onChange={(e) => setForm({ ...form, experience: e.target.value })}
                      />
                    </Field>
                    {selected.application_type === 'candidate' && (
                      <Field label="Assign a mentor (optional on approval)">
                        <Select
                          value={form.mentorId}
                          onChange={(e) => setForm({ ...form, mentorId: e.target.value })}
                        >
                          <option value="">Choose later</option>
                          {mentors.map((mentor) => (
                            <option key={mentor.id} value={mentor.id}>
                              {mentor.first_name} {mentor.last_name} ({mentor.email})
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </div>
                  <Field label="Internal review notes" hint="Never shown to the applicant.">
                    <Textarea
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </Field>
                  {selected.application_type === 'mentor' && (
                    <label className="option">
                      <input
                        type="checkbox"
                        checked={form.force}
                        onChange={(e) => setForm({ ...form, force: e.target.checked })}
                      />
                      Override the experience threshold (logged in the audit trail)
                    </label>
                  )}
                  <ErrorNote error={error} />
                  {notice && <p className="badge success">{notice}</p>}
                  <div className="row">
                    <Button variant="success" onClick={() => review('approved')}>
                      Approve
                    </Button>
                    {selected.application_type === 'mentor' && reviewExperience < threshold && (
                      <Button variant="ghost" onClick={() => review('approved', 'candidate')}>
                        Route to candidate
                      </Button>
                    )}
                    {selected.application_type === 'candidate' && reviewExperience >= threshold && (
                      <Button variant="ghost" onClick={() => review('approved', 'mentor')}>
                        Route to mentor
                      </Button>
                    )}
                    <Button variant="danger" onClick={() => review('rejected')}>
                      Reject
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {tab === 'users' && (
        <Card title="Users" subtitle="Everyone with an account on the platform">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Roles</th>
                  <th>KYC</th>
                  <th>Company</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(users.data ?? []).map((user) => (
                  <tr key={user.id}>
                    <td>
                      {user.first_name} {user.last_name}
                    </td>
                    <td>{user.email}</td>
                    <td>
                      {(user.roles ?? []).map((role: string) => (
                        <Badge key={role}>{role}</Badge>
                      ))}
                    </td>
                    <td>
                      <Badge tone={user.kyc_verified ? 'success' : 'warn'}>
                        {user.kyc_verified ? 'verified' : 'pending'}
                      </Badge>
                    </td>
                    <td>{user.company_name ?? '—'}</td>
                    <td>
                      <Badge tone={statusTone(user.status)}>{user.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'settings' && (
        <Card title="Policies" subtitle="Set by the super admin">
          <div className="grid3">
            {Object.entries(settings.data ?? {}).map(([key, value]) => (
              <div className="stat" key={key}>
                <small>{key.replaceAll('_', ' ')}</small>
                <strong>{String(value)}</strong>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'audit' && (
        <Card title="Audit log" subtitle="Every sensitive decision is recorded">
          <AuditTable rows={audit.data ?? []} />
        </Card>
      )}
    </>
  );
}
