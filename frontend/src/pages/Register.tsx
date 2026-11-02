import { useState } from 'react';
import { useAuth } from '../auth';
import { Button, ErrorNote, Field, Input, Select } from '../components';

export function Register({ onLogin }: { onLogin: () => void }) {
  const { register } = useAuth();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    role: 'candidate',
    companyName: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({
        ...form,
        companyName: form.role === 'company' ? form.companyName : undefined,
        phone: form.phone || undefined,
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-hero">
        <div>
          <span className="badge">Join the platform</span>
          <h1 style={{ marginTop: 18 }}>One account. Verified identity. Real skills.</h1>
          <p>
            Candidates and mentors verify identity with Aadhaar through an authorised provider.
            Company accounts need a business email address.
          </p>
          <ul>
            <li>Mentor applications are reviewed by an admin</li>
            <li>10+ years of experience routes to a mentor application</li>
            <li>Your Aadhaar number is never stored</li>
          </ul>
        </div>
        <p className="small">Hiring Intelligence · Phase 1 MVP</p>
      </div>
      <div className="auth-panel">
        <form className="auth-box" onSubmit={submit}>
          <div>
            <h2>Create an account</h2>
            <p className="muted">You can apply to a role after signing up.</p>
          </div>
          <div className="grid2">
            <Field label="First name">
              <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required />
            </Field>
            <Field label="Last name">
              <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required />
            </Field>
          </div>
          <Field label="Email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              required
            />
          </Field>
          <Field label="Phone (optional)">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <Input
              type="password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              minLength={8}
              required
            />
          </Field>
          <Field label="I am joining as">
            <Select value={form.role} onChange={(e) => set('role', e.target.value)}>
              <option value="candidate">Candidate</option>
              <option value="mentor">Mentor (admin approval required)</option>
              <option value="company">Company</option>
            </Select>
          </Field>
          {form.role === 'company' && (
            <Field label="Company name" hint="Free email domains are rejected.">
              <Input
                value={form.companyName}
                onChange={(e) => set('companyName', e.target.value)}
                required
              />
            </Field>
          )}
          <ErrorNote error={error} />
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>
          <p className="muted small">
            Already registered?{' '}
            <button type="button" className="link-button" onClick={onLogin}>
              Sign in
            </button>
          </p>
        </form>
      </div>
    </main>
  );
}
