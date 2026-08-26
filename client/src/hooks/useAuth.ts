import { useCallback, useEffect, useState } from 'react';

export interface AuthUser {
  id: string;
  username: string;
  role?: 'admin' | 'user';
  isAdmin?: boolean;
  mustChangePassword?: boolean;
  approved?: boolean;
}

const TOKEN_KEY = 'auth_token';

export const useAuth = () => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const persistToken = (t: string | null) => {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
    setToken(t);
  };

  const fetchMe = useCallback(async (t: string) => {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (!res.ok) throw new Error('Phiên đăng nhập hết hạn.');
    const data = await res.json();
    return data.user as AuthUser;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const u = await fetchMe(token);
        if (!cancelled) setUser(u);
      } catch {
        if (!cancelled) {
          persistToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, fetchMe]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Đăng nhập thất bại.');
    persistToken(data.token);
    setUser(data.user);
    return data.user as AuthUser;
  }, []);

  const register = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Đăng ký thất bại.');
    if (data.token && data.user) {
      persistToken(data.token);
      setUser(data.user);
    }
    return data;
  }, []);

  const resetPassword = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Đặt lại mật khẩu thất bại.');
  }, []);

  const changePassword = useCallback(async (password: string) => {
    if (!token) throw new Error('Phiên đăng nhập hết hạn.');
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Đổi mật khẩu thất bại.');
    setUser(data.user);
    return data.user as AuthUser;
  }, [token]);

  const logout = useCallback(() => {
    persistToken(null);
    setUser(null);
  }, []);

  return { token, user, loading, login, register, resetPassword, changePassword, logout };
};
