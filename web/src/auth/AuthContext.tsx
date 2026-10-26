import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, getToken, setToken } from '../api/client';
import type { Me } from '../api/types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => void;
  expiresAt: number | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

function expiryOf(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [expiresAt, setExpiresAt] = useState<number | null>(expiryOf(getToken()));

  useEffect(() => {
    if (!getToken()) return;
    api
      .get<{ user: Me }>('/auth/me')
      .then((r) => setUser(r.user))
      // Only a real 401 ends the session; a network error or an aborted request (page navigating away) must not.
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onOut = () => {
      setUser(null);
      setExpiresAt(null);
    };
    window.addEventListener('aicte:signed-out', onOut);
    return () => window.removeEventListener('aicte:signed-out', onOut);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: Me }>('/auth/login', { email, password });
    setToken(r.token);
    setExpiresAt(expiryOf(r.token));
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setExpiresAt(null);
  }, []);

  const refresh = useCallback(async () => {
    const r = await api.post<{ token: string }>('/auth/refresh');
    setToken(r.token);
    setExpiresAt(expiryOf(r.token));
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, expiresAt, refresh }), [user, loading, login, logout, expiresAt, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}

export function useMe(): Me {
  const { user } = useAuth();
  if (!user) throw new Error('Not signed in');
  return user;
}

export function homeFor(user: Me): string {
  switch (user.role) {
    case 'COLLEGE':
      return '/college';
    case 'OFFICER':
      return '/officer';
    case 'BUREAU':
      return '/bureau';
    case 'SENIOR':
    case 'SUPER_SENIOR':
    case 'HOD':
      return '/team';
    case 'COMMITTEE':
      return '/committee';
    case 'AUTHORITY':
      return '/authority';
    case 'ADMIN':
      return '/admin';
    case 'RULE_EDITOR':
    case 'RULE_APPROVER':
      return '/rules';
    default:
      return '/login';
  }
}
