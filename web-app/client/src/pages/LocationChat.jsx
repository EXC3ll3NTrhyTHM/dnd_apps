/**
 * LocationChat - Main location page
 * 
 * Loads custom scene components for locations that have them,
 * otherwise shows the default chat interface.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import NpcBar from '../components/NpcBar';
import ChatBubble from '../components/ChatBubble';
import ChatInput from '../components/ChatInput';
import ItemCard from '../components/ItemCard';
import Toast from '../components/Toast';
import { getSceneComponent } from './scenes';
import '../styles/location-chat.css';
import '../styles/location-scene.css';

// Admin IDs who can use edit mode
const ADMIN_IDS = ['424061511833747467'];

export default function LocationChat() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const { user, wallet, refreshWallet } = useAuth();

  const [location, setLocation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selectedNpc, setSelectedNpc] = useState(null);
  const [npcEmotions, setNpcEmotions] = useState({});
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(null);
  const [menuData, setMenuData] = useState(null);
  const [buying, setBuying] = useState(false);
  const [toast, setToast] = useState(null);
  const [viewMode, setViewMode] = useState('scene'); // 'scene' | 'chat'
  const [chatTarget, setChatTarget] = useState(null);

  const messagesEndRef = useRef(null);
  const chatAreaRef = useRef(null);
  
  const isAdmin = ADMIN_IDS.includes(user?.id || '');

  // Load location data + chat history
  useEffect(() => {
    loadLocationAndHistory();
  }, [locationId]);

  async function loadLocationAndHistory() {
    try {
      const [locData, histData] = await Promise.all([
        api('/api/chat/locations'),
        api(`/api/chat/locations/${locationId}/history`)
      ]);

      const loc = locData.locations.find(l => l.id === locationId);
      if (!loc) {
        navigate('/map');
        return;
      }

      // Add locationId to the location object for convenience
      loc.id = locationId;
      setLocation(loc);
      setMessages(histData.history || []);
      
      // Start in scene mode if location has a custom scene, otherwise chat
      const SceneComponent = getSceneComponent(locationId);
      setViewMode(SceneComponent && loc.scene ? 'scene' : 'chat');

      // Restore last emotion per NPC from history
      const emotions = {};
      (histData.history || []).forEach(msg => {
        if (msg.role === 'npc' && msg.emotion) {
          emotions[msg.npc] = msg.emotion;
        }
      });
      setNpcEmotions(emotions);
    } catch (err) {
      console.error('Failed to load location:', err);
      navigate('/map');
    } finally {
      setLoading(false);
    }
  }

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Send message
  const handleSend = useCallback(async (text) => {
    if (sending) return;
    setSending(true);

    const playerMsg = {
      role: 'player',
      text,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, playerMsg]);

    const typingId = Date.now();
    setMessages(prev => [...prev, {
      role: 'npc',
      npc: selectedNpc || (location?.npcs[0]?.id || '?'),
      npcDisplayName: '',
      typing: true,
      _typingId: typingId
    }]);

    try {
      const endpoint = selectedNpc
        ? `/api/chat/locations/${locationId}/npc/${selectedNpc}/message`
        : `/api/chat/locations/${locationId}/message`;

      const data = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ message: text })
      });

      setMessages(prev => {
        const withoutTyping = prev.filter(m => !m._typingId);
        return [...withoutTyping, ...data.responses];
      });

      data.responses.forEach(resp => {
        if (resp.emotion) {
          setNpcEmotions(prev => ({ ...prev, [resp.npc]: resp.emotion }));
        }
      });
    } catch (err) {
      setMessages(prev => prev.filter(m => !m._typingId));
      console.error('Failed to send message:', err);
      setToast({ type: 'error', message: err.message || 'Failed to send message' });
    } finally {
      setSending(false);
    }
  }, [sending, selectedNpc, locationId, location]);

  // Menu handling
  async function openMenu(type) {
    try {
      if (type === 'tavern') {
        const data = await api('/api/tavern/menu');
        setMenuData(data);
      } else if (type === 'shop') {
        const data = await api('/api/shop/catalog');
        setMenuData(data);
      }
      setMenuOpen(type);
    } catch (err) {
      console.error('Failed to load menu:', err);
    }
  }

  async function handleBuy(item) {
    if (buying) return;
    setBuying(true);

    try {
      const endpoint = menuOpen === 'tavern' ? '/api/tavern/buy' : '/api/shop/buy';
      const result = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({ item_id: item.id })
      });

      if (result.wallet) {
        refreshWallet(result.wallet);
      }

      setMenuOpen(null);
      setMenuData(null);

      const purchaseMsg = {
        role: 'player',
        text: menuOpen === 'tavern'
          ? `*orders ${item.name.toLowerCase()} from the menu*`
          : `*buys ${item.name.toLowerCase()} from the shop*`,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, purchaseMsg]);

      setToast({ type: 'success', message: result.message || `Purchased ${item.name}!` });
    } catch (err) {
      setToast({ type: 'error', message: err.data?.error || 'Purchase failed' });
    } finally {
      setBuying(false);
    }
  }

  // Scene interaction handlers
  const handleNpcClick = (npcId) => {
    setSelectedNpc(npcId);
    setChatTarget(npcId);
    setViewMode('chat');
  };

  const handleGatheringClick = () => {
    setSelectedNpc(null);
    setChatTarget(null);
    setViewMode('chat');
  };

  const handleBackToScene = () => {
    setViewMode('scene');
    setChatTarget(null);
  };

  const handleLocationUpdate = (updatedLocation) => {
    setLocation(updatedLocation);
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Entering location...</p>
      </div>
    );
  }

  if (!location) return null;

  const hasTavern = location.features.includes('tavern_menu');
  const hasShop = location.features.includes('shop');

  // Try to get custom scene component
  const SceneComponent = getSceneComponent(locationId);

  // Render custom scene if available and in scene mode
  if (viewMode === 'scene' && SceneComponent && location.scene) {
    return (
      <>
        <SceneComponent
          location={location}
          isAdmin={isAdmin}
          onNpcClick={handleNpcClick}
          onGatheringClick={handleGatheringClick}
          onLocationUpdate={handleLocationUpdate}
          setToast={setToast}
        />
        {toast && (
          <Toast
            type={toast.type}
            message={toast.message}
            onClose={() => setToast(null)}
          />
        )}
      </>
    );
  }

  // Chat View (default)
  return (
    <div className="location-chat">
      {/* Header */}
      <div className="chat-header">
        <button className="chat-back-btn" onClick={SceneComponent && location.scene ? handleBackToScene : () => navigate('/map')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="chat-header-info">
          <div className="chat-header-title">
            {chatTarget
              ? (location.npcs.find(n => n.id === chatTarget)?.displayName || chatTarget)
              : location.name
            }
          </div>
          <div className="chat-header-subtitle">
            {chatTarget ? 'Private conversation' : location.description}
          </div>
        </div>
        <div className="chat-header-actions">
          {hasTavern && (
            <button className="chat-menu-btn" onClick={() => openMenu('tavern')}>
              Menu
            </button>
          )}
          {hasShop && (
            <button className="chat-menu-btn" onClick={() => openMenu('shop')}>
              Shop
            </button>
          )}
        </div>
      </div>

      {/* NPC Bar */}
      <NpcBar
        npcs={location.npcs}
        selectedNpc={selectedNpc}
        onSelectNpc={setSelectedNpc}
        emotions={npcEmotions}
      />

      {/* Chat Messages */}
      <div className="chat-messages" ref={chatAreaRef}>
        {messages.length === 0 ? (
          <div className="chat-messages-empty">
            <span className="chat-messages-empty-icon">💬</span>
            <p>You've entered {location.name}.</p>
            <p>Say something to start a conversation.</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <ChatBubble key={msg.timestamp || i} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input */}
      <ChatInput
        onSend={handleSend}
        selectedNpc={
          selectedNpc
            ? (location.npcs.find(n => n.id === selectedNpc)?.displayName || selectedNpc)
            : null
        }
        disabled={sending}
      />

      {/* Menu Overlay */}
      {menuOpen && menuData && (
        <>
          <div className="menu-overlay" onClick={() => { setMenuOpen(null); setMenuData(null); }} />
          <div className="menu-panel">
            <div className="menu-panel-header">
              <span className="menu-panel-title">
                {menuOpen === 'tavern' ? (menuData.tavern_name || 'Tavern Menu') : 'Shop'}
              </span>
              <button className="menu-panel-close" onClick={() => { setMenuOpen(null); setMenuData(null); }}>
                &times;
              </button>
            </div>
            {Object.entries(menuData.categories || {}).map(([catKey, category]) => (
              <div key={catKey} className="items-grid" style={{ marginBottom: 16 }}>
                <h3 className="section-title">
                  <span className="section-emoji">{category.emoji}</span>
                  {category.display_name}
                </h3>
                {category.items.map(item => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    onBuy={handleBuy}
                    buying={buying}
                    disabled={wallet && wallet.balance < item.price}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
