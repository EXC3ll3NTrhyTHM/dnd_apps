import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './useApi';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState(null);
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
    } catch (err) {
      // Token invalid, clear it
      localStorage.removeItem('dh_token');
      setUser(null);
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }

  function login(token) {
    localStorage.setItem('dh_token', token);
    fetchMe(token);
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
  }

  function refreshWallet(newWallet) {
    setWallet(newWallet);
  }

  return (
    <AuthContext.Provider value={{ user, wallet, loading, login, logout, refreshWallet, fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
