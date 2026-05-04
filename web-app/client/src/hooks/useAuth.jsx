import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './useApi';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [xpInfo, setXpInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load token from localStorage on mount
  useEffect(() => {
    const token = localStorage.getItem('dh_token');
    if (token) {
      fetchMe(token);
    } else {
      setLoading(false);
    }
  }, []);

  async function fetchMe(token) {
    try {
      if (token) {
        localStorage.setItem('dh_token', token);
      }
      const data = await api('/api/auth/me');
      setUser(data.user);
      setWallet(data.wallet);
      setXpInfo(data.xp || null);
    } catch (err) {
      // Only clear the token if the server explicitly rejected it.
      // Network blips and 5xx must NOT log the user out.
      if (err?.status === 401) {
        localStorage.removeItem('dh_token');
        setUser(null);
        setWallet(null);
        setXpInfo(null);
      }
    } finally {
      setLoading(false);
    }
  }

  function login(token) {
    localStorage.setItem('dh_token', token);
    setLoading(true);
    return fetchMe(token);
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      // ignore
    }
    localStorage.removeItem('dh_token');
    setUser(null);
    setWallet(null);
    setXpInfo(null);
  }

  function refreshWallet(newWallet) {
    setWallet(newWallet);
  }

  async function refreshXp() {
    try {
      const data = await api('/api/xp/me');
      setXpInfo(data);
    } catch (e) {
      console.error('Failed to refresh XP:', e);
    }
  }

  return (
    <AuthContext.Provider value={{ user, wallet, xpInfo, loading, login, logout, refreshWallet, refreshXp, fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
