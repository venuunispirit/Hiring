import { createContext, useContext, useState, type ReactNode } from 'react';
import { api, setToken, type User } from './api';

type AuthContextValue = {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (body: Record<string, unknown>) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem('hi_user');
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(loadUser);

  const store = (token: string, nextUser: User) => {
    setToken(token);
    localStorage.setItem('hi_user', JSON.stringify(nextUser));
    setUser(nextUser);
  };

  const login = async (email: string, password: string) => {
    const result = await api<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    store(result.token, result.user);
  };

  const register = async (body: Record<string, unknown>) => {
    const result = await api<{ token: string; user: User }>('/auth/register', {
      method: 'POST',
      body,
    });
    store(result.token, result.user);
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem('hi_user');
    setUser(null);
  };

  const refresh = async () => {
    const next = await api<User>('/auth/me');
    localStorage.setItem('hi_user', JSON.stringify(next));
    setUser(next);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth outside provider');
  return context;
}
