import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { primaryRole, Shell, type NavItem } from './components';
import { Login } from './pages/Login';

const Register = lazy(() => import('./pages/Register').then((m) => ({ default: m.Register })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const CandidatePage = lazy(() =>
  import('./pages/CandidatePage').then((m) => ({ default: m.CandidatePage })),
);
const CompanyPage = lazy(() =>
  import('./pages/CompanyPage').then((m) => ({ default: m.CompanyPage })),
);
const MentorPage = lazy(() => import('./pages/MentorPage').then((m) => ({ default: m.MentorPage })));
const SuperAdminPage = lazy(() =>
  import('./pages/SuperAdminPage').then((m) => ({ default: m.SuperAdminPage })),
);

const NAV: Record<string, NavItem[]> = {
  super_admin: [
    { key: 'overview', label: 'Overview' },
    { key: 'admins', label: 'Admins & access' },
    { key: 'settings', label: 'Policies' },
    { key: 'audit', label: 'Audit log' },
  ],
  admin: [
    { key: 'applications', label: 'Applications' },
    { key: 'users', label: 'Users' },
    { key: 'settings', label: 'Policies' },
    { key: 'audit', label: 'Audit log' },
  ],
  mentor: [
    { key: 'candidates', label: 'Candidates' },
    { key: 'assessments', label: 'Assessments' },
    { key: 'rankings', label: 'Rankings' },
  ],
  candidate: [
    { key: 'profile', label: 'Profile' },
    { key: 'assessments', label: 'Assessments' },
    { key: 'introductions', label: 'Introductions' },
  ],
  company: [
    { key: 'search', label: 'Candidate search' },
    { key: 'introductions', label: 'Introductions' },
    { key: 'profile', label: 'Company profile' },
  ],
};

function PageFallback() {
  return <p className="muted">Loading…</p>;
}

export function App() {
  const { user } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const role = primaryRole(user);
  const [tab, setTab] = useState(NAV[role]?.[0]?.key ?? 'overview');

  useEffect(() => {
    setTab(NAV[role]?.[0]?.key ?? 'overview');
  }, [role]);

  if (!user) {
    return (
      <Suspense fallback={<PageFallback />}>
        {authMode === 'login' ? (
          <Login onRegister={() => setAuthMode('register')} />
        ) : (
          <Register onLogin={() => setAuthMode('login')} />
        )}
      </Suspense>
    );
  }

  const nav = NAV[role] ?? NAV.candidate ?? [];
  const active = nav.some((item) => item.key === tab) ? tab : (nav[0]?.key ?? 'overview');

  return (
    <Shell nav={nav} active={active} onNavigate={setTab}>
      <Suspense fallback={<PageFallback />}>
        {role === 'super_admin' && <SuperAdminPage tab={active} />}
        {role === 'admin' && <AdminPage tab={active} />}
        {role === 'mentor' && <MentorPage tab={active} />}
        {role === 'candidate' && <CandidatePage tab={active} />}
        {role === 'company' && <CompanyPage tab={active} />}
      </Suspense>
    </Shell>
  );
}
