import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useUiSounds } from './hooks/useUiSounds';
import LevelUpOverlay from './components/LevelUpOverlay';
import DmAwardEffect from './components/DmAwardEffect';
import AudioConsentOverlay from './components/AudioConsentOverlay';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import AuthCallback from './pages/AuthCallback';
import Map from './pages/Map';
import LocationChat from './pages/LocationChat';
import Tavern from './pages/Tavern';
import Shop from './pages/Shop';
import Profile from './pages/Profile';
import PlayerProfile from './pages/PlayerProfile';
import Quests from './pages/Quests';
import Leaderboard from './pages/Leaderboard';
import Admin from './pages/Admin';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Entering the realm...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function MentionToast({ mention, onDismiss }) {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on next frame
    requestAnimationFrame(() => setVisible(true));
  }, []);

  function handleClick() {
    if (mention.locationId) {
      navigate('/location/' + mention.locationId);
    }
    onDismiss();
  }

  return (
    <div className={`mention-toast ${visible ? 'mention-toast-visible' : ''}`} onClick={handleClick}>
      <div className="mention-toast-header">
        <strong>{mention.fromName}</strong>
        <span className="mention-toast-location">{mention.locationName}</span>
      </div>
      <div className="mention-toast-body">{mention.text}</div>
      <div className="mention-toast-tap">Tap to open</div>
    </div>
  );
}

export default function App() {
  const { user, loading, fetchMe } = useAuth();
  const location = useLocation();
  const playSound = useUiSounds();
  const [toast, setToast] = useState(null);
  const [levelUp, setLevelUp] = useState(null);
  const [dmAward, setDmAward] = useState(null);
  const wsRef = useRef(null);
  const toastTimer = useRef(null);
  const reconnectTimer = useRef(null);
  const locationRef = useRef(null);

  // Keep locationRef in sync so WS callbacks always have current value
  const getCurrentLocation = useCallback(() => {
    const match = location.pathname.match(/^\/location\/(.+)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  locationRef.current = getCurrentLocation();

  // Global WebSocket connection with auto-reconnect
  useEffect(() => {
    if (!user) return;

    let alive = true;

    function connect() {
      if (!alive) return;

      // Build WS URL — works in both dev (Vite proxy) and production
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          type: 'identify',
          userId: user.id,
          currentLocation: locationRef.current
        }));
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'mention') {
            // Don't show notification if already viewing this chat
            if (msg.locationId && msg.locationId === locationRef.current) return;
            playSound('npcResponse');
            setToast(msg);
            clearTimeout(toastTimer.current);
            toastTimer.current = setTimeout(() => setToast(null), 8000);
          }
          if (msg.type === 'level_up' && msg.userId === user.id) {
            setLevelUp(prev => Math.max(prev || 0, msg.newLevel));
          }
          if (msg.type === 'dm_award' && msg.userId === user.id) {
            fetchMe();
            if (msg.awardType && msg.change) {
              setDmAward({ awardType: msg.awardType, change: msg.change });
            }
          }
        } catch {
          // ignore non-JSON
        }
      });

      ws.addEventListener('close', () => {
        wsRef.current = null;
        if (alive) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      });

      ws.addEventListener('error', () => {
        ws.close();
      });
    }

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, [user?.id]);

  // Update location on route change
  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'updateLocation',
        currentLocation: getCurrentLocation()
      }));
    }
  }, [location.pathname, getCurrentLocation]);

  function dismissToast() {
    setToast(null);
    clearTimeout(toastTimer.current);
  }

  return (
    <>
      <AudioConsentOverlay />
      {toast && <MentionToast mention={toast} onDismiss={dismissToast} />}
      {dmAward && (
        <DmAwardEffect
          key={`${dmAward.awardType}-${dmAward.change}-${Date.now()}`}
          type={dmAward.awardType}
          amount={dmAward.change}
          onDone={() => setDmAward(null)}
        />
      )}
      {levelUp && (
        <LevelUpOverlay
          key={levelUp}
          level={levelUp}
          onDismiss={() => setLevelUp(null)}
        />
      )}
      <Routes>
        <Route path="/" element={
          !loading && user ? <Navigate to="/map" replace /> : <Landing />
        } />
        <Route path="/auth-callback" element={<AuthCallback />} />

        {/* Location chat - full screen, no bottom nav */}
        <Route path="/location/:locationId" element={
          <ProtectedRoute>
            <LocationChat />
          </ProtectedRoute>
        } />

        {/* Protected routes with bottom nav */}
        <Route element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route path="/map" element={<Map />} />
          <Route path="/quests" element={<Quests />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/player/:playerId" element={<PlayerProfile />} />
          <Route path="/admin" element={<Admin />} />
          {/* Legacy routes redirect to new structure */}
          <Route path="/tavern" element={<Navigate to="/map" replace />} />
          <Route path="/shop" element={<Navigate to="/map" replace />} />
          <Route path="/leaderboard" element={<Navigate to="/profile" replace />} />
        </Route>
      </Routes>
    </>
  );
}
