import { useEffect, useState, useRef, useCallback } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAudioMuted } from '../hooks/useAudioSettings';
import { useUiSounds } from '../hooks/useUiSounds';
import '../styles/layout.css';

const NAV_ITEMS = [
  { path: '/map', label: 'Map', icon: '🗺️' },
  { path: '/quests', label: 'Quests', icon: '📜' },
  { path: '/profile', label: 'Profile', icon: '⚔️' },
];

// Module-level audio singleton — survives component mount/unmount cycles
let ambientAudio = null;

function getAmbientAudio() {
  if (!ambientAudio) {
    ambientAudio = new Audio('/sounds/bustling-city.mp3');
    ambientAudio.loop = true;
    ambientAudio.volume = 0.4;
  }
  return ambientAudio;
}

// When true, suppresses the click/touchstart tryResume handler
let ambientSuppressed = false;

export function pauseAmbientAudio() {
  ambientSuppressed = true;
  if (ambientAudio) ambientAudio.pause();
}

export default function Layout() {
  const audioMuted = useAudioMuted();
  const playSound = useUiSounds();
  const location = useLocation();
  const isPlayerProfile = /^\/player\//.test(location.pathname);

  // Auto-hide nav on player profile page
  const [navVisible, setNavVisible] = useState(true);
  const hideTimer = useRef(null);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setNavVisible(false), 3000);
  }, []);

  // Reset visibility when entering/leaving player profile
  useEffect(() => {
    if (isPlayerProfile) {
      setNavVisible(true);
      scheduleHide();
    } else {
      setNavVisible(true);
      clearTimeout(hideTimer.current);
    }
    return () => clearTimeout(hideTimer.current);
  }, [isPlayerProfile, scheduleHide]);

  // Show nav on tap anywhere when in overlay mode
  useEffect(() => {
    if (!isPlayerProfile) return;
    const onTap = () => {
      setNavVisible(true);
      scheduleHide();
    };
    window.addEventListener('pointerdown', onTap);
    return () => window.removeEventListener('pointerdown', onTap);
  }, [isPlayerProfile, scheduleHide]);

  // Ambient city audio — plays across all Layout routes, stops on unmount (e.g. entering a location)
  useEffect(() => {
    const audio = getAmbientAudio();
    ambientSuppressed = false;
    audio.currentTime = 0;
    audio.volume = audioMuted ? 0 : 0.4;
    if (!audioMuted) {
      audio.play().catch(() => {});
    }

    const tryResume = () => {
      if (ambientSuppressed) return;
      if (!audioMuted && audio.paused && !document.hidden) {
        audio.play().catch(() => {});
      }
    };

    // Pause when tab/app is hidden, resume when visible
    const onVisibility = () => {
      if (document.hidden) {
        audio.pause();
      } else if (!audioMuted) {
        audio.play().catch(() => {});
      }
    };

    window.addEventListener('click', tryResume);
    window.addEventListener('touchstart', tryResume);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      audio.pause();
      window.removeEventListener('click', tryResume);
      window.removeEventListener('touchstart', tryResume);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [audioMuted]);

  return (
    <div className="app-layout">
      <main className={`main-content${isPlayerProfile ? ' main-content-overlay-nav' : ''}`}>
        <Outlet />
      </main>

      <nav className={`bottom-nav${isPlayerProfile ? ' bottom-nav-overlay' : ''}${isPlayerProfile && !navVisible ? ' bottom-nav-hidden' : ''}`}>
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => playSound('buttonTap')}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
