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
import ChatInputCustom from '../components/ChatInputCustom';
import EffectsOverlay, { useEffects } from '../components/EffectsOverlay';
import ItemCard from '../components/ItemCard';
import Toast from '../components/Toast';
import SceneAudio from './scenes/SceneAudio';
import { getSceneComponent } from './scenes';
import { useUiSounds } from '../hooks/useUiSounds';
import '../styles/location-chat.css';
import '../styles/location-scene.css';
import '../styles/custom-keyboard.css';

// Set to true to use the custom on-screen keyboard (allows fullscreen effects over keyboard)
const USE_CUSTOM_KEYBOARD = true;

// Admin IDs who can use edit mode
const ADMIN_IDS = ['424061511833747467'];

export default function LocationChat() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  const { user, wallet, refreshWallet } = useAuth();

  const [location, setLocation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [npcEmotions, setNpcEmotions] = useState({});
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(null);
  const [menuData, setMenuData] = useState(null);
  const [buying, setBuying] = useState(false);
  const [toast, setToast] = useState(null);
  const [viewMode, setViewMode] = useState('scene'); // 'scene' | 'chat'
  const [insertNpc, setInsertNpc] = useState(null);

  const messagesEndRef = useRef(null);
  const chatAreaRef = useRef(null);
  const playSound = useUiSounds();
  const [effect, triggerEffect, clearEffect] = useEffects();
  const latestTimestampRef = useRef(null);
  const sendingRef = useRef(false);
  const knownIdsRef = useRef(new Set());

  const isAdmin = ADMIN_IDS.includes(user?.id || '');

  // ── Back-button: scene↔chat history management ──
  const hasSceneRef = useRef(false);
  const viewModeRef = useRef('scene');
  const viewChangedByPopRef = useRef(false);

  // Keep hasScene ref in sync
  useEffect(() => {
    const SceneComp = getSceneComponent(locationId);
    hasSceneRef.current = !!(SceneComp && location?.scene);
  }, [locationId, location]);

  // Push/pop history entries when switching between scene and chat views
  useEffect(() => {
    const prev = viewModeRef.current;
    viewModeRef.current = viewMode;

    if (viewMode === 'chat' && prev === 'scene' && hasSceneRef.current) {
      // Entering chat from scene — push history entry so back button can return
      window.history.pushState({ chatView: true }, '');
    } else if (viewMode === 'scene' && prev === 'chat' && !viewChangedByPopRef.current) {
      // Returned to scene via UI button — clean up the history entry
      if (window.history.state?.chatView) {
        window.history.back();
      }
    }
    viewChangedByPopRef.current = false;
  }, [viewMode]);

  // Listen for OS back button to switch chat → scene
  useEffect(() => {
    function onPopState() {
      // If we landed on our chatView entry, something above (keyboard) was just closed
      if (window.history.state?.chatView) return;
      // If in chat and location has a scene, go back to scene view
      if (viewModeRef.current === 'chat' && hasSceneRef.current) {
        viewChangedByPopRef.current = true;
        setViewMode('scene');
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Keep chat layout above the virtual keyboard on iOS/Android
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

  // Presence: join on mount, heartbeat every 10s, leave on unmount
  useEffect(() => {
    api('/api/presence/join', {
      method: 'POST',
      body: JSON.stringify({ locationId })
    }).catch(() => {});

    const interval = setInterval(() => {
      api('/api/presence/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ locationId })
      }).catch(() => {});
    }, 10000);

    return () => {
      clearInterval(interval);
      // Use sendBeacon so the leave request survives component unmount / navigation
      const token = localStorage.getItem('dh_token');
      const blob = new Blob(
        [JSON.stringify({ token })],
        { type: 'application/json' }
      );
      navigator.sendBeacon('/api/presence/leave', blob);
    };
  }, [locationId]);

  // Poll for new messages from other players every 4 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      if (sendingRef.current || !latestTimestampRef.current) return;
      try {
        const data = await api(
          `/api/chat/locations/${locationId}/messages?since=${encodeURIComponent(latestTimestampRef.current)}`
        );
        const newMsgs = (data.messages || []).filter(m => m.id && !knownIdsRef.current.has(m.id));
        if (newMsgs.length > 0) {
          newMsgs.forEach(m => knownIdsRef.current.add(m.id));
          // Update latest timestamp
          const newest = newMsgs[newMsgs.length - 1].timestamp;
          if (newest > latestTimestampRef.current) {
            latestTimestampRef.current = newest;
          }
          setMessages(prev => [...prev, ...newMsgs]);
          // Update NPC emotions from polled messages
          newMsgs.forEach(m => {
            if (m.role === 'npc' && m.emotion) {
              setNpcEmotions(prev => ({ ...prev, [m.npc]: m.emotion }));
            }
          });
          playSound('npcResponse');
        }
      } catch {
        // Polling failure is non-fatal
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [locationId]);

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
      const history = histData.history || [];
      setMessages(history);

      // Seed known IDs and latest timestamp for polling
      const ids = new Set();
      let latest = null;
      history.forEach(msg => {
        if (msg.id) ids.add(msg.id);
        if (msg.timestamp && (!latest || msg.timestamp > latest)) {
          latest = msg.timestamp;
        }
      });
      knownIdsRef.current = ids;
      latestTimestampRef.current = latest;

      // Start in scene mode if location has a custom scene, otherwise chat
      const SceneComponent = getSceneComponent(locationId);
      setViewMode(SceneComponent && loc.scene ? 'scene' : 'chat');

      // Restore last emotion per NPC from history
      const emotions = {};
      history.forEach(msg => {
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

  // Scroll to bottom when new messages arrive (after initial load)
  useEffect(() => {
    if (messages.length === 0) return;
    // column-reverse handles initial position; just smooth-scroll on new messages
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message — always uses room endpoint, server picks responding NPCs
  const handleSend = useCallback(async (text) => {
    if (sending) return;
    setSending(true);
    sendingRef.current = true;

    playSound('messageSent');

    // Optimistic player message (will be replaced by server version with id/userId)
    const optimisticMsg = {
      role: 'player',
      text,
      userId: user?.id,
      playerName: user?.characterName || user?.global_name || user?.username || 'You',
      playerAvatar: user?.avatar,
      timestamp: new Date().toISOString(),
      _optimistic: true
    };
    setMessages(prev => [...prev, optimisticMsg]);

    // Show typing indicators for @mentioned NPCs, or a generic one if none mentioned
    const typingId = Date.now();
    const mentionedNpcs = location?.npcs.filter(npc =>
      text.toLowerCase().includes(`@${npc.displayName.toLowerCase()}`)
    ) || [];

    const typingBubbles = mentionedNpcs.length > 0
      ? mentionedNpcs.map((npc, i) => ({
          role: 'npc',
          npc: npc.id,
          npcDisplayName: npc.displayName,
          typing: true,
          _typingId: typingId + i
        }))
      : [{
          role: 'npc',
          npc: location?.npcs[0]?.id || '?',
          npcDisplayName: '',
          typing: true,
          _typingId: typingId
        }];

    setMessages(prev => [...prev, ...typingBubbles]);

    try {
      const data = await api(`/api/chat/locations/${locationId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: text })
      });

      // Track IDs so polling doesn't re-add these
      const allNew = [data.playerMessage, ...data.responses];
      allNew.forEach(m => { if (m.id) knownIdsRef.current.add(m.id); });

      // Update latest timestamp
      const newest = allNew[allNew.length - 1]?.timestamp;
      if (newest && (!latestTimestampRef.current || newest > latestTimestampRef.current)) {
        latestTimestampRef.current = newest;
      }

      setMessages(prev => {
        // Replace optimistic player msg + typing bubbles with server versions
        const withoutOptimistic = prev.filter(m => !m._typingId && !m._optimistic);
        return [...withoutOptimistic, data.playerMessage, ...data.responses];
      });

      playSound('npcResponse');

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
      sendingRef.current = false;
    }
  }, [sending, locationId, location]);

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
      playSound('menuOpen');
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

      playSound('purchase');
      setToast({ type: 'success', message: result.message || `Purchased ${item.name}!` });
    } catch (err) {
      setToast({ type: 'error', message: err.data?.error || 'Purchase failed' });
    } finally {
      setBuying(false);
    }
  }

  // NPC bar click — prefill @mention in chat input
  const handleNpcBarClick = (npc) => {
    setInsertNpc(npc);
  };

  // Scene interaction handlers
  const handleNpcClick = (npcId) => {
    const npc = location.npcs.find(n => n.id === npcId);
    setViewMode('chat');
    if (npc) setInsertNpc(npc);
  };

  const handleGatheringClick = () => {
    setViewMode('chat');
  };

  const handleBackToScene = () => {
    setViewMode('scene');
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
  const hasScene = SceneComponent && location.scene;
  const sceneAudioConfig = location.scene?.audio;

  return (
    <>
      {/* Scene audio — rendered outside view toggle so it persists across scene↔chat */}
      {sceneAudioConfig && <SceneAudio config={sceneAudioConfig} />}

      {/* Scene View */}
      {viewMode === 'scene' && hasScene ? (
        <SceneComponent
          location={location}
          isAdmin={isAdmin}
          onNpcClick={handleNpcClick}
          onGatheringClick={handleGatheringClick}
          onLocationUpdate={handleLocationUpdate}
          setToast={setToast}
        />
      ) : (
        /* Chat View */
        <div className="location-chat">
          {/* Header */}
          <div className="chat-header">
            <button className="chat-back-btn" onClick={() => { playSound('buttonTap'); hasScene ? handleBackToScene() : navigate('/map'); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="chat-header-info">
              <div className="chat-header-title">{location.name}</div>
              <div className="chat-header-subtitle">{location.description}</div>
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
            onNpcClick={handleNpcBarClick}
            emotions={npcEmotions}
          />

          {/* Chat Messages — column-reverse so browser natively anchors to bottom */}
          <div className="chat-messages" ref={chatAreaRef}>
            <div className="chat-messages-inner">
              {messages.length === 0 ? (
                <div className="chat-messages-empty">
                  <span className="chat-messages-empty-icon">💬</span>
                  <p>You've entered {location.name}.</p>
                  <p>Say something to start a conversation.</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <ChatBubble key={msg.id || msg._typingId || i} message={msg} npcs={location.npcs} currentUserId={user?.id} />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Chat Input */}
          {USE_CUSTOM_KEYBOARD ? (
            <ChatInputCustom
              onSend={handleSend}
              disabled={sending}
              npcs={location.npcs}
              groups={location.groups || {}}
              insertNpc={insertNpc}
              onInsertNpcDone={() => setInsertNpc(null)}
              playSound={playSound}
              scrollContainerRef={chatAreaRef}
            />
          ) : (
            <ChatInput
              onSend={handleSend}
              disabled={sending}
              npcs={location.npcs}
              groups={location.groups || {}}
              insertNpc={insertNpc}
              onInsertNpcDone={() => setInsertNpc(null)}
            />
          )}

          {/* Menu Overlay */}
          {menuOpen && menuData && (
            <>
              <div className="menu-overlay" onClick={() => { playSound('menuClose'); setMenuOpen(null); setMenuData(null); }} />
              <div className="menu-panel">
                <div className="menu-panel-header">
                  <span className="menu-panel-title">
                    {menuOpen === 'tavern' ? (menuData.tavern_name || 'Tavern Menu') : 'Shop'}
                  </span>
                  <button className="menu-panel-close" onClick={() => { playSound('menuClose'); setMenuOpen(null); setMenuData(null); }}>
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
        </div>
      )}

      {/* Effects overlay — renders above custom keyboard */}
      <EffectsOverlay effect={effect} onDone={clearEffect} />

      {/* Toast */}
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
