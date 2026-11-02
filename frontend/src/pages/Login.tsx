import { useState } from 'react';
import { useAuth } from '../auth';
import { Button, ErrorNote, Field, Input } from '../components';

const DEMO: [string, string][] = [
  ['super@hi.test', 'Super admin'],
  ['admin@hi.test', 'Admin'],
  ['mentor@hi.test', 'Mentor'],
  ['candidate@hi.test', 'Candidate'],
  ['company@hi.test', 'Company'],
  ['candidate2@hi.test', 'Candidate 2'],
];

export function Login({ onRegister }: { onRegister: () => void }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('candidate@hi.test');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
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
          <span className="badge">Confidential · MVP</span>
          <h1 style={{ marginTop: 18 }}>Skills, assessed. Hiring, consented.</h1>
          <p>
            Mentors build versioned assessments. Candidates prove their skills. Companies
            discover anonymous, assessed profiles and request an introduction.
          </p>
          <ul>
            <li>Five roles, one account</li>
            <li>Raw answers, scores and decisions kept separate</li>
            <li>No contact details before candidate consent</li>
          </ul>
        </div>
        <p className="small">Hiring Intelligence · Phase 1 MVP · November 2026</p>
      </div>
      <div className="auth-panel">
        <form className="auth-box" onSubmit={submit}>
          <div>
            <h2>Sign in</h2>
            <p className="muted">Use a seeded account or your own registration.</p>
          </div>
          <Field label="Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </Field>
          <Field label="Password">
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </Field>
          <div className="auth-error">
            <ErrorNote error={error} />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="muted small">
            New here?{' '}
            <button type="button" className="link-button" onClick={onRegister}>
              Create an account
            </button>
          </p>
          <div>
            <p className="muted small" style={{ marginBottom: 4 }}>
              Demo accounts (password: Password123!)
            </p>
            <div className="demo">
              {DEMO.map(([account, label]) => (
                <button
                  type="button"
                  key={account}
                  onClick={() => {
                    setEmail(account);
                    setPassword('Password123!');
                  }}
                >
                  {label}
                  <br />
                  <span className="muted">{account}</span>
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
