import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../hooks/useApi';
import { applyTheme } from '../styles/theme-engine';

const ThemeContext = createContext(null);

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function ThemeProvider({ children }) {
  const [phase, setPhase] = useState(1.0);

  useEffect(() => {
    fetchPhase();
    const interval = setInterval(fetchPhase, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // Apply theme whenever phase changes
  useEffect(() => {
    applyTheme(phase);
  }, [phase]);

  async function fetchPhase() {
    try {
      const data = await api('/api/campaign/state');
      if (typeof data.phase === 'number') {
        setPhase(data.phase);
      }
    } catch {
      // If not authenticated or request fails, stay at default phase
    }
  }

  return (
    <ThemeContext.Provider value={{ phase, setPhase }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
