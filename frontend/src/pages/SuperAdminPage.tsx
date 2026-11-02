import { useState } from 'react';
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
  Stat,
  statusTone,
  useLoad,
} from '../components';

const ADMIN_PERMISSIONS = [
  'users.create_admin',
  'users.list',
  'permissions.manage',
  'settings.manage',
  'audit.view',
  'applications.view',
  'applications.review',
  'mentors.assign',
  'candidates.view',
  'assessments.manage',
  'assessments.monitor',
  'assessments.evaluate',
  'notifications.view',
];

export function SuperAdminPage({ tab }: { tab: string }) {
  const users = useLoad<any[]>('/admin/users');
  const applications = useLoad<any[]>('/applications');
  const audit = useLoad<any[]>('/admin/audit');
  const settings = useLoad<Record<string, unknown>>('/settings');

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [grants, setGrants] = useState<string[]>(['users.list', 'applications.view']);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [threshold, setThreshold] = useState('');
  const [busy, setBusy] = useState(false);

  const createAdmin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      await api('/admin/users', {
        method: 'POST',
        body: { ...form, permissions: grants },
      });
      setNotice(`Admin created for ${form.email}`);
      setForm({ firstName: '', lastName: '', email: '', password: '' });
      users.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const saveThreshold = async () => {
    setError(null);
    try {
      await api('/settings/mentor_experience_threshold', {
        method: 'PUT',
        body: { value: Number(threshold || settings.data?.mentor_experience_threshold || 10) },
      });
      setNotice('Policy updated');
      settings.reload();
    } catch (err) {
      setError(err);
    }
  };

  const pending = (applications.data ?? []).filter((a) => a.status === 'pending').length;

  return (
    <>
      {tab === 'overview' && (
        <>
          <div className="grid3">
            <Stat label="Users" value={users.data?.length ?? '—'} hint="all roles" />
            <Stat label="Pending applications" value={pending} hint="awaiting review" />
            <Stat
              label="Mentor threshold"
              value={`${settings.data?.mentor_experience_threshold ?? 10} yrs`}
              hint="policy setting"
            />
            <Stat label="Audit entries" value={audit.data?.length ?? '—'} hint="latest 200" />
          </div>
          <Card title="Platform activity" subtitle="Most recent sensitive actions">
            <AuditTable rows={(audit.data ?? []).slice(0, 10)} />
          </Card>
        </>
      )}

      {tab === 'admins' && (
        <>
          <Card title="Create an admin" subtitle="Admins review applications and assign mentors.">
            <form className="stack" onSubmit={createAdmin}>
              <div className="grid2">
                <Field label="First name">
                  <Input
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Last name">
                  <Input
                    value={form.lastName}
                    onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                    required
                  />
                </Field>
              </div>
              <div className="grid2">
                <Field label="Email">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Temporary password">
                  <Input
                    type="password"
                    minLength={8}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                  />
                </Field>
              </div>
              <Field label="Capabilities">
                <div className="grid2">
                  {ADMIN_PERMISSIONS.map((permission) => (
                    <label key={permission} className="option">
                      <input
                        type="checkbox"
                        checked={grants.includes(permission)}
                        onChange={(e) =>
                          setGrants((prev) =>
                            e.target.checked
                              ? [...prev, permission]
                              : prev.filter((p) => p !== permission),
                          )
                        }
                      />
                      {permission}
                    </label>
                  ))}
                </div>
              </Field>
              <ErrorNote error={error} />
              {notice && <p className="badge success">{notice}</p>}
              <div>
                <Button type="submit" disabled={busy}>
                  {busy ? 'Creating…' : 'Create admin'}
                </Button>
              </div>
            </form>
          </Card>

          <Card title="All users" subtitle="Roles, identity verification and company membership">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Roles</th>
                  <th>KYC</th>
                  <th>Company</th>
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
                        {user.kyc_verified ? 'verified' : 'not verified'}
                      </Badge>
                    </td>
                    <td>{user.company_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {tab === 'settings' && (
        <Card title="Policies" subtitle="Changing the threshold affects new mentor approvals.">
          <div className="grid2">
            <Field
              label="Mentor experience threshold (years)"
              hint="Applicants at or above this can be approved as mentors."
            >
              <Input
                type="number"
                min={0}
                max={70}
                value={threshold || String(settings.data?.mentor_experience_threshold ?? 10)}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </Field>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <Button onClick={saveThreshold}>Save policy</Button>
            </div>
          </div>
          <ErrorNote error={error} />
          {notice && <p className="badge success">{notice}</p>}
        </Card>
      )}

      {tab === 'audit' && (
        <Card title="Audit log" subtitle="Append-only record of sensitive actions">
          <AuditTable rows={audit.data ?? []} />
        </Card>
      )}
    </>
  );
}

export function AuditTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty>No audit entries yet.</Empty>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString()}</td>
              <td>{row.email ?? 'system'}</td>
              <td>{row.action}</td>
              <td>
                {row.entity_type} {row.entity_id}
              </td>
              <td>
                <code className="small">{JSON.stringify(row.details)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
