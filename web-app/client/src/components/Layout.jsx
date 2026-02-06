import { Outlet, NavLink } from 'react-router-dom';
import '../styles/layout.css';

const NAV_ITEMS = [
  { path: '/map', label: 'Map', icon: '🗺️' },
  { path: '/quests', label: 'Quests', icon: '📜' },
  { path: '/profile', label: 'Profile', icon: '⚔️' },
];

export default function Layout() {
  return (
    <div className="app-layout">
      <main className="main-content">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
