import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './hooks/useAuth';
import { ThemeProvider } from './context/ThemeContext';
import PwaUpdateBanner from './components/PwaUpdateBanner';
import './styles/index.css';

// Lock to portrait orientation
screen.orientation?.lock?.('portrait').catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <ThemeProvider>
          <App />
          <PwaUpdateBanner />
        </ThemeProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);
