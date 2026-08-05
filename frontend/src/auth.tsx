import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setTokens } from './api/client';
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
    if (!getToken()) {
      setUser(null);
      setTrialExpiresAt(null);
      setLoading(false);
      return;
    }
    try {
      const d = await api<{ user: User; trialExpiresAt?: string | null }>('/api/me');
      setUser(d.user);
      setTrialExpiresAt(d.trialExpiresAt ?? null);
    } catch {
      setUser(null);
      setTrialExpiresAt(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
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
        },
        logout: () => {
          // 服务端吊销 refresh token（失败不阻塞本地登出）
          void fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: localStorage.getItem('anon-refresh-token') }),
          }).catch(() => {});
          setTokens(null, null);
          if ('caches' in window) void caches.delete('api-cache'); // 清历史残留缓存
          setUser(null);
          setTrialExpiresAt(null);
        },
        refresh,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
