import { useEffect, useState, type ReactNode } from 'react';
import { api, type User } from './api';
import { useAuth } from './auth';

export type NavItem = { key: string; label: string };

export function Shell({
  nav,
  active,
  onNavigate,
  children,
}: {
  nav: NavItem[];
  active: string;
  onNavigate: (key: string) => void;
  children: ReactNode;
}) {
  const { user, logout } = useAuth();
  const role = primaryRole(user);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">HI</span>
          <div>
            <strong>Hiring Intelligence</strong>
            <small>Assessment platform</small>
          </div>
        </div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.key}
              className={item.key === active ? 'nav-item active' : 'nav-item'}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="avatar">
              {user?.firstName?.[0]}
              {user?.lastName?.[0]}
            </span>
            <div>
              <strong>
                {user?.firstName} {user?.lastName}
              </strong>
              <small>{roleLabel(role)}</small>
            </div>
          </div>
          <button className="link-button" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <h1>{nav.find((n) => n.key === active)?.label ?? 'Dashboard'}</h1>
          <Notifications />
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export function Notifications() {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.is_read).length;

  const load = () => api<any[]>('/notifications').then(setItems).catch(() => {});
  useEffect(() => {
    void load();
  }, []);

  const markAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    void load();
  };

  return (
    <div className="notifications">
      <button className="bell" onClick={() => setOpen((v) => !v)}>
        Notifications {unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="dropdown">
          <div className="dropdown-head">
            <strong>Notifications</strong>
            <button className="link-button" onClick={markAll}>
              Mark all read
            </button>
          </div>
          {items.length === 0 && <p className="muted pad">Nothing yet.</p>}
          {items.slice(0, 12).map((item) => (
            <div key={item.id} className={item.is_read ? 'notification' : 'notification unread'}>
              <p>{item.message}</p>
              <small>{new Date(item.created_at).toLocaleString()}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'ghost' | 'danger' | 'success';
  disabled?: boolean;
}) {
  return (
    <button className={`btn ${variant}`} onClick={onClick} type={type} disabled={disabled}>
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input ${props.className ?? ''}`} />;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const issues = (error as any)?.issues as { path: string; message: string }[] | undefined;
  return (
    <div className="error-note">
      <strong>{message}</strong>
      {issues && (
        <ul>
          {issues.map((issue, index) => (
            <li key={index}>
              {issue.path}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <p className="muted">{label}</p>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <strong>{value}</strong>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}

export function statusTone(status: string): string {
  if (['approved', 'accepted', 'evaluated', 'proceed', 'active', 'done', 'verified'].includes(status))
    return 'success';
  if (['rejected', 'failed', 'suspended', 'cancelled'].includes(status)) return 'danger';
  if (['pending', 'submitted', 'scheduled', 'needs_review', 'hold', 'expired'].includes(status))
    return 'warn';
  return 'neutral';
}

export function primaryRole(user: User | null): string {
  const active = user?.roles.filter((r) => r.isActive).map((r) => r.role) ?? [];
  for (const role of ['super_admin', 'admin', 'mentor', 'candidate', 'company']) {
    if (active.includes(role)) return role;
  }
  return active[0] ?? 'candidate';
}

export function roleLabel(role: string): string {
  return (
    {
      super_admin: 'Super admin',
      admin: 'Admin',
      mentor: 'Mentor',
      candidate: 'Candidate',
      company: 'Company',
    }[role] ?? role
  );
}

export function useLoad<T>(path: string | null): {
  data: T | null;
  error: unknown;
  reload: () => void;
  loading: boolean;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api<T>(path)
      .then((result) => live && setData(result))
      .catch((err) => live && setError(err))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, tick]);

  return { data, error, loading, reload: () => setTick((v) => v + 1) };
}
