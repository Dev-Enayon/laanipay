import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setTokens, clearTokens } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      if (!localStorage.getItem('laani_access')) {
        if (active) setLoading(false);
        return;
      }
      try {
        const data = await api('/auth/me');
        if (active) setUser(data.user);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    bootstrap();

    const onUnauthorized = () => {
      clearTokens();
      setUser(null);
    };
    window.addEventListener('laani:unauthorized', onUnauthorized);

    return () => {
      active = false;
      window.removeEventListener('laani:unauthorized', onUnauthorized);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    setTokens(data);
    setUser(data.user);
    return data.user;
  }, []);

  const signup = useCallback(async (payload) => {
    const data = await api('/auth/signup', { method: 'POST', body: payload });
    setTokens(data);
    setUser(data.user);
    return { user: data.user, emailWarning: data.emailWarning ?? null };
  }, []);

  const refreshUser = useCallback(async () => {
    const data = await api('/auth/me');
    setUser(data.user);
    return data.user;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
