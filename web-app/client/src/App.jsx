import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import AuthCallback from './pages/AuthCallback';
import Map from './pages/Map';
import LocationChat from './pages/LocationChat';
import Tavern from './pages/Tavern';
import Shop from './pages/Shop';
import Profile from './pages/Profile';
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

export default function App() {
  const { user, loading } = useAuth();

  // Track visual viewport height globally so all pages respond to
  // iOS address bar and virtual keyboard changes
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function onResize() {
      document.documentElement.style.setProperty('--vv-height', `${vv.height}px`);
    }

    onResize();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  return (
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
        <Route path="/admin" element={<Admin />} />
        {/* Legacy routes redirect to new structure */}
        <Route path="/tavern" element={<Navigate to="/map" replace />} />
        <Route path="/shop" element={<Navigate to="/map" replace />} />
        <Route path="/leaderboard" element={<Navigate to="/profile" replace />} />
      </Route>
    </Routes>
  );
}
