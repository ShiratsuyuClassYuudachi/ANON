import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getSessionId, getToken, setTokens } from './api/client';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  trialExpiresAt: string | null;
  login: (token: string, user: User, trialExpiresAt?: string | null, refreshToken?: string) => void;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [trialExpiresAt, setTrialExpiresAt] = useState<string | null>(null);

  const refresh = async () => {
    const sessionId = getSessionId();
    if (!getToken()) {
      setUser(null);
      setTrialExpiresAt(null);
      setLoading(false);
      return;
    }
    try {
      const d = await api<{ user: User; trialExpiresAt?: string | null; qq?: { enabled: boolean; bound: boolean } }>('/api/me');
      if (sessionId !== getSessionId()) return;
      setUser(d.user);
      setTrialExpiresAt(d.trialExpiresAt ?? null);
    } catch {
      if (sessionId !== getSessionId()) return;
      setUser(null);
      setTrialExpiresAt(null);
    } finally {
      if (sessionId === getSessionId()) setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const syncSession = (event: StorageEvent) => {
      if (event.key !== 'anon-session-id' && event.key !== null) return;
      setUser(null);
      setTrialExpiresAt(null);
      setLoading(true);
      void refresh();
    };
    window.addEventListener('storage', syncSession);
    return () => window.removeEventListener('storage', syncSession);
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        user,
        loading,
        trialExpiresAt,
        login: (token, u, expiresAt, refreshToken) => {
          setTokens(token, refreshToken);
          setUser(u);
          setTrialExpiresAt(expiresAt ?? null);
          setLoading(false);
        },
        logout: () => {
          // 服务端吊销 refresh token（失败不阻塞本地登出）
          void fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: localStorage.getItem('anon-refresh-token') }),
            cache: 'no-store',
            redirect: 'error',
          }).catch(() => {});
          setTokens(null, null);
          if ('caches' in window) void caches.delete('api-cache'); // 清历史残留缓存
          setUser(null);
          setTrialExpiresAt(null);
          setLoading(false);
        },
        refresh,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
