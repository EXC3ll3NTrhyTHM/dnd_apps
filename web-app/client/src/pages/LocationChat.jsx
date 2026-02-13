/**
 * LocationChat - Main location page
 *
 * Loads custom scene components for locations that have them,
 * otherwise shows the default chat interface.
 */

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, apiUpload } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import ChatBubble from '../components/ChatBubble';
import ChatInput from '../components/ChatInput';
import ChatInputCustom from '../components/ChatInputCustom';
import EmojiReactionBar from '../components/EmojiReactionBar';
import EmojiPickerSheet from '../components/EmojiPickerSheet';
import EffectsOverlay, { useEffects } from '../components/EffectsOverlay';
import ItemCard from '../components/ItemCard';
import Toast from '../components/Toast';
import XpFloat from '../components/XpFloat';
import AchievementToast from '../components/AchievementToast';
import LevelUpOverlay from '../components/LevelUpOverlay';
import PresenceStrip from '../components/PresenceStrip';
import Arena from './Arena';
const DiceOverlay = lazy(() => import('../components/DiceOverlay'));
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

  // Arena gets its own dedicated full-screen page
  if (locationId === 'the_arena') return <Arena />;

  const [location, setLocation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [npcEmotions, setNpcEmotions] = useState({});
  const [typingNpcs, setTypingNpcs] = useState({}); // { npcId: { displayName, timestamp } }
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(null);
  const [menuData, setMenuData] = useState(null);
  const [buying, setBuying] = useState(false);
  const [toast, setToast] = useState(null);
  const [viewMode, setViewMode] = useState('scene'); // 'scene' | 'chat'
  const [insertNpc, setInsertNpc] = useState(null);
  const [players, setPlayers] = useState([]);
  const [reactionBar, setReactionBar] = useState(null); // { messageId, targetRect, canDelete }
  const [emojiSheet, setEmojiSheet] = useState(null); // { messageId }
  const [xpFloat, setXpFloat] = useState(null);
  const [achievementQueue, setAchievementQueue] = useState([]);
  const [diceRoll, setDiceRoll] = useState(null);
  const [levelUp, setLevelUp] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [diceOverlayEnabled] = useState(() => {
    const stored = localStorage.getItem('dh_dice_overlay');
    return stored !== 'false';
  });
  const [presence, setPresence] = useState([]);

  const showXpFloat = (amount) => {
    if (amount > 0) setXpFloat({ amount, key: Date.now() });
  };

  const triggerLevelUp = useCallback((newLevel) => {
    if (newLevel) setLevelUp(prev => Math.max(prev || 0, newLevel));
  }, []);

  const queueAchievements = useCallback((arr) => {
    if (arr && arr.length > 0) {
      setAchievementQueue(prev => [...prev, ...arr]);
    }
  }, []);

  const dismissAchievement = useCallback(() => {
    setAchievementQueue(prev => prev.slice(1));
  }, []);

  const messagesEndRef = useRef(null);
  const chatAreaRef = useRef(null);
  const scrollThumbRef = useRef(null);
  const scrollFadeRef = useRef(null);
  const playSound = useUiSounds();
  const [effect, triggerEffect, clearEffect] = useEffects();
  const latestTimestampRef = useRef(null);
  const sendingRef = useRef(false);
  const knownIdsRef = useRef(new Set());

  const isAdmin = ADMIN_IDS.includes(user?.id || '');

  // Marcel DM detection
  const isMarcelDm = locationId?.startsWith('marcel_dm_');
  const marcelDmUserId = isMarcelDm ? locationId.replace('marcel_dm_', '') : null;

  // ── WebSocket: Real-time typing and messages ──
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use the hostname, but force port 3420 if we're on the dev port 5173
    const host = window.location.hostname;
    const port = window.location.port === '5173' ? '3420' : window.location.port;
    const wsUrl = `${protocol}//${host}${port ? `:${port}` : ''}/ws`;
    
    let ws;
    let reconnectTimer;

    function connect() {
      console.log(`[LocationChat] Connecting to WS: ${wsUrl}`);
      ws = new WebSocket(wsUrl);

      ws.onopen = () => console.log('[LocationChat] WS Connected');

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.locationId !== locationId) return;

          if (payload.type === 'typing') {
            setTypingNpcs(prev => {
              const next = { ...prev };
              if (payload.typing) {
                next[payload.npc] = {
                  displayName: payload.npcDisplayName || 'Marcel',
                  timestamp: Date.now()
                };
              } else {
                delete next[payload.npc];
              }
              return next;
            });
          }

          if (payload.type === 'reaction') {
            setMessages(prev => prev.map(msg =>
              msg.id === payload.messageId
                ? { ...msg, reactions: payload.reactions }
                : msg
            ));
          }

          if (payload.type === 'dice_roll' && payload.message) {
            const msg = payload.message;
            if (msg.id && !knownIdsRef.current.has(msg.id)) {
              knownIdsRef.current.add(msg.id);
              if (msg.timestamp && (!latestTimestampRef.current || msg.timestamp > latestTimestampRef.current)) {
                latestTimestampRef.current = msg.timestamp;
              }
              setMessages(prev => [...prev, msg]);
            }
          }

          // Item used — smoke effect + action message from other players
          if (payload.type === 'item_used' && payload.userId !== user?.id) {
            triggerEffect(payload.effect || 'smoke');
            const actionMsg = {
              role: 'system',
              text: `*${payload.characterName || payload.username} ${payload.use_message}*`,
              timestamp: new Date().toISOString(),
            };
            setMessages(prev => [...prev, actionMsg]);
          }
        } catch (err) {
          console.error('[LocationChat] WS message error:', err);
        }
      };

      ws.onclose = () => {
        console.warn('[LocationChat] WS Disconnected, reconnecting in 3s...');
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => console.error('[LocationChat] WS Error:', err);
    }

    connect();
    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [locationId]);

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

  // Presence: join on mount, heartbeat every 10s, leave on unmount
  useEffect(() => {
    api('/api/presence/join', {
      method: 'POST',
      body: JSON.stringify({ locationId })
    }).then(data => {
      if (data?.xpAwarded) showXpFloat(data.xpAwarded);
      if (data?.newAchievements) queueAchievements(data.newAchievements);
      if (data?.levelUp) triggerLevelUp(data.levelUp.newLevel);
    }).catch(() => {});

    // Fetch presence list initially and on heartbeat
    const fetchPresence = () => {
      api('/api/presence').then(data => {
        if (data?.presence?.[locationId]) {
          setPresence(data.presence[locationId]);
        } else {
          setPresence([]);
        }
      }).catch(() => {});
    };
    fetchPresence();

    const interval = setInterval(() => {
      api('/api/presence/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ locationId })
      }).catch(() => {});
      fetchPresence(); // Also refresh presence list
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

      // Mark as read on leave so own messages don't trigger the unread dot
      fetch(`/api/chat/locations/${locationId}/mark-read`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        keepalive: true
      }).catch(() => {});
    };
  }, [locationId]);

  // Poll for new messages from other players every 4 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      if (sendingRef.current || !latestTimestampRef.current) return;
      try {
        const pollUrl = isMarcelDm
          ? `/api/marcel-dm/channel/messages?userId=${marcelDmUserId}&since=${encodeURIComponent(latestTimestampRef.current)}`
          : `/api/chat/locations/${locationId}/messages?since=${encodeURIComponent(latestTimestampRef.current)}`;
        const data = await api(pollUrl);
        
        // Handle new messages
        const newMsgs = (data.messages || []).filter(m => m.id && !knownIdsRef.current.has(m.id));
        if (newMsgs.length > 0) {
          newMsgs.forEach(m => knownIdsRef.current.add(m.id));
          const newest = newMsgs[newMsgs.length - 1].timestamp;
          if (newest > latestTimestampRef.current) {
            latestTimestampRef.current = newest;
          }
          setMessages(prev => [...prev, ...newMsgs]);

          newMsgs.forEach(m => {
            if (m.role === 'npc' && m.emotion) {
              setNpcEmotions(prev => ({ ...prev, [m.npc]: m.emotion }));
            }
          });
          playSound('npcResponse');
        }

        // Remove deleted messages
        if (data.deletedIds && data.deletedIds.length > 0) {
          const deletedSet = new Set(data.deletedIds);
          setMessages(prev => prev.filter(m => !m.id || !deletedSet.has(m.id)));
          data.deletedIds.forEach(id => knownIdsRef.current.delete(id));
        }

        // Merge reactions from polling into existing messages
        if (data.reactions) {
          setMessages(prev => {
            let changed = false;
            const updated = prev.map(msg => {
              if (!msg.id || !data.reactions[msg.id]) return msg;
              const incoming = data.reactions[msg.id];
              if (JSON.stringify(msg.reactions || {}) !== JSON.stringify(incoming)) {
                changed = true;
                return { ...msg, reactions: incoming };
              }
              return msg;
            });
            return changed ? updated : prev;
          });
        }

        // Handle typing indicators from API response
        if (data.typing) {
          const typingMap = {};
          data.typing.forEach(t => {
            typingMap[t.id] = { displayName: t.displayName };
          });
          setTypingNpcs(typingMap);
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
      let loc, histData;

      if (isMarcelDm) {
        // Marcel DM: fetch channel info and history from DM endpoints
        const [channelData, histResult] = await Promise.all([
          api(`/api/marcel-dm/channel?userId=${marcelDmUserId}`),
          api(`/api/marcel-dm/channel/history?userId=${marcelDmUserId}`)
        ]);
        loc = channelData.location;
        histData = histResult;
        queueAchievements(channelData.newAchievements);
      } else {
        const [locData, histResult] = await Promise.all([
          api('/api/chat/locations'),
          api(`/api/chat/locations/${locationId}/history`)
        ]);
        loc = locData.locations.find(l => l.id === locationId);
        histData = histResult;
        if (locData.players) setPlayers(locData.players);
      }

      if (!loc) {
        navigate('/map');
        return;
      }

      // Add locationId to the location object for convenience
      loc.id = locationId;
      setLocation(loc);
      const history = histData.messages || histData.history || [];
      setHasMore(!!histData.hasMore);
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

      // Mark location as read for this user
      api(`/api/chat/locations/${locationId}/mark-read`, { method: 'POST' }).catch(() => {});

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

  // Load older messages when scrolling to top (infinite scroll)
  const loadMoreRef = useRef(false);
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    loadMoreRef.current = true;
    setLoadingMore(true);

    const oldestMsg = messages[0];
    if (!oldestMsg?.id) { setLoadingMore(false); return; }

    try {
      const url = isMarcelDm
        ? `/api/marcel-dm/channel/history?userId=${marcelDmUserId}&before=${oldestMsg.id}&limit=30`
        : `/api/chat/locations/${locationId}/history?before=${oldestMsg.id}&limit=30`;
      const data = await api(url);
      const older = data.messages || [];
      setHasMore(!!data.hasMore);

      if (older.length > 0) {
        older.forEach(m => { if (m.id) knownIdsRef.current.add(m.id); });
        setMessages(prev => [...older, ...prev]);
      }
    } catch (err) {
      console.error('Failed to load more messages:', err);
    } finally {
      setLoadingMore(false);
      loadMoreRef.current = false;
    }
  }, [loadingMore, hasMore, messages, locationId, isMarcelDm, marcelDmUserId]);

  // Detect scroll to top for infinite scroll (column-reverse: top = most negative scrollTop)
  useEffect(() => {
    const el = chatAreaRef.current;
    if (!el) return;

    const onScroll = () => {
      if (loadMoreRef.current || !hasMore) return;
      // In column-reverse, scrollTop is 0 at bottom and negative going up.
      // When near the top: -scrollTop approaches (scrollHeight - clientHeight).
      const distFromTop = el.scrollHeight - el.clientHeight + el.scrollTop;
      if (distFromTop < 100) {
        handleLoadMore();
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [handleLoadMore, hasMore]);

  // Auto-scroll only when new messages arrive at the END (not when prepending older messages)
  // AND user is already near the bottom.
  // column-reverse: scrollTop 0 = at bottom, negative = scrolled up.
  const prevMsgCountRef = useRef(0);
  const prevOldestIdRef = useRef(null);
  useEffect(() => {
    if (messages.length === 0) return;
    const oldestId = messages[0]?.id;
    const wasPrepend = prevOldestIdRef.current && oldestId !== prevOldestIdRef.current;
    prevOldestIdRef.current = oldestId;

    if (messages.length > prevMsgCountRef.current && !wasPrepend) {
      const el = chatAreaRef.current;
      const nearBottom = !el || Math.abs(el.scrollTop) < 150;
      if (nearBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  // Custom scroll indicator — shows translucent thumb on scroll, fades after idle
  useEffect(() => {
    const el = chatAreaRef.current;
    const thumb = scrollThumbRef.current;
    if (!el || !thumb) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight <= clientHeight + 1) return;

      const rect = el.getBoundingClientRect();
      const maxScroll = scrollHeight - clientHeight;
      const thumbH = Math.max(30, (clientHeight / scrollHeight) * clientHeight);
      // column-reverse uses negative scrollTop; abs gives distance from bottom
      const ratio = maxScroll > 0 ? Math.min(1, Math.abs(scrollTop) / maxScroll) : 0;
      const top = (1 - ratio) * (clientHeight - thumbH);

      thumb.style.height = `${thumbH}px`;
      thumb.style.top = `${rect.top + top}px`;
      thumb.style.right = `${window.innerWidth - rect.right + 2}px`;
      thumb.style.opacity = '1';

      clearTimeout(scrollFadeRef.current);
      scrollFadeRef.current = setTimeout(() => {
        thumb.style.opacity = '0';
      }, 800);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(scrollFadeRef.current);
    };
  }, [location, viewMode]);

  // Send message — always uses room endpoint, server picks responding NPCs
  const handleSend = useCallback(async (text) => {
    if (sending) return;
    setSending(true);
    sendingRef.current = true;

    playSound('messageSent');

    // Optimistic player message
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

    // Show typing indicators only for @mentioned NPCs (except Marcel, who is handled via WS)
    // Expand group @mentions to their member NPCs
    const textLower = text.toLowerCase();
    const groupMemberIds = new Set();
    for (const group of Object.values(location?.groups || {})) {
      if (textLower.includes(`@${group.displayName.toLowerCase()}`)) {
        (group.memberIds || []).forEach(id => groupMemberIds.add(id));
      }
    }
    const mentionedNpcs = (location?.npcs || []).filter(npc =>
      npc.id !== 'marcel' && (textLower.includes(`@${npc.displayName.toLowerCase()}`) || groupMemberIds.has(npc.id))
    );

    if (mentionedNpcs.length > 0) {
      setTypingNpcs(prev => {
        const next = { ...prev };
        mentionedNpcs.forEach(npc => {
          next[npc.id] = { displayName: npc.displayName, timestamp: Date.now() };
        });
        return next;
      });
    }

    try {
      const sendUrl = isMarcelDm
        ? `/api/marcel-dm/channel/message?userId=${marcelDmUserId}`
        : `/api/chat/locations/${locationId}/message`;
      const data = await api(sendUrl, {
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
        // Remove optimistic player msg
        const filtered = prev.filter(m => !m._optimistic);
        return [...filtered, data.playerMessage, ...data.responses];
      });

      // Clear typing indicators for NPCs who just responded
      setTypingNpcs(prev => {
        const next = { ...prev };
        data.responses.forEach(resp => {
          delete next[resp.npc];
        });
        return next;
      });

      playSound('npcResponse');

      data.responses.forEach(resp => {
        if (resp.emotion) {
          setNpcEmotions(prev => ({ ...prev, [resp.npc]: resp.emotion }));
        }
      });

      queueAchievements(data.newAchievements);
      if (data.levelUp) triggerLevelUp(data.levelUp.newLevel);
    } catch (err) {
      // Clear manual typing bubbles on error
      setTypingNpcs(prev => {
        const next = { ...prev };
        mentionedNpcs.forEach(npc => delete next[npc.id]);
        return next;
      });
      setMessages(prev => prev.filter(m => !m._optimistic));
      console.error('Failed to send message:', err);
      setToast({ type: 'error', message: err.message || 'Failed to send message' });
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [sending, locationId, location, user, playSound]);

  // Send GIF message — no NPC response expected
  const handleSendGif = useCallback(async (gif) => {
    if (sending) return;
    setSending(true);
    sendingRef.current = true;

    playSound('messageSent');

    const optimisticMsg = {
      role: 'player',
      type: 'gif',
      gifUrl: gif.url,
      gifWidth: gif.width,
      gifHeight: gif.height,
      text: gif.title || '',
      userId: user?.id,
      playerName: user?.characterName || user?.global_name || user?.username || 'You',
      playerAvatar: user?.avatar,
      timestamp: new Date().toISOString(),
      _optimistic: true
    };
    setMessages(prev => [...prev, optimisticMsg]);

    try {
      const gifSendUrl = isMarcelDm
        ? `/api/marcel-dm/channel/message?userId=${marcelDmUserId}`
        : `/api/chat/locations/${locationId}/message`;
      const data = await api(gifSendUrl, {
        method: 'POST',
        body: JSON.stringify({
          type: 'gif',
          gifUrl: gif.url,
          gifWidth: gif.width,
          gifHeight: gif.height,
          message: gif.title || ''
        })
      });

      if (data.playerMessage?.id) knownIdsRef.current.add(data.playerMessage.id);
      const newest = data.playerMessage?.timestamp;
      if (newest && (!latestTimestampRef.current || newest > latestTimestampRef.current)) {
        latestTimestampRef.current = newest;
      }

      setMessages(prev => {
        const filtered = prev.filter(m => !m._optimistic);
        return [...filtered, data.playerMessage];
      });

      queueAchievements(data.newAchievements);
      if (data.levelUp) triggerLevelUp(data.levelUp.newLevel);
    } catch (err) {
      setMessages(prev => prev.filter(m => !m._optimistic));
      console.error('Failed to send GIF:', err);
      setToast({ type: 'error', message: err.message || 'Failed to send GIF' });
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }, [sending, locationId, user, playSound]);

  // Send image — file upload with optimistic blob preview
  const handleSendImage = useCallback(async (file) => {
    if (sending) return;
    setSending(true);
    sendingRef.current = true;

    playSound('messageSent');

    // Create optimistic preview with blob URL
    const blobUrl = URL.createObjectURL(file);

    // Read image dimensions before upload
    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: null, h: null });
      img.src = blobUrl;
    });

    const optimisticMsg = {
      role: 'player',
      type: 'image',
      imageUrl: blobUrl,
      imageWidth: dims.w,
      imageHeight: dims.h,
      text: '',
      userId: user?.id,
      playerName: user?.characterName || user?.global_name || user?.username || 'You',
      playerAvatar: user?.avatar,
      timestamp: new Date().toISOString(),
      _optimistic: true,
      _blobUrl: blobUrl
    };
    setMessages(prev => [...prev, optimisticMsg]);

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('channelId', locationId);
      formData.append('caption', '');
      if (dims.w) formData.append('imageWidth', String(dims.w));
      if (dims.h) formData.append('imageHeight', String(dims.h));

      const data = await apiUpload('/api/chat/upload', formData);

      // Preload the server URL so the swap is instant (no flash)
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = resolve;
        img.src = data.playerMessage.imageUrl;
      });

      if (data.playerMessage?.id) knownIdsRef.current.add(data.playerMessage.id);
      const newest = data.playerMessage?.timestamp;
      if (newest && (!latestTimestampRef.current || newest > latestTimestampRef.current)) {
        latestTimestampRef.current = newest;
      }

      setMessages(prev => {
        const filtered = prev.filter(m => !m._optimistic);
        return [...filtered, data.playerMessage];
      });

      queueAchievements(data.newAchievements);
      if (data.levelUp) triggerLevelUp(data.levelUp.newLevel);
    } catch (err) {
      setMessages(prev => prev.filter(m => !m._optimistic));
      console.error('Failed to upload image:', err);
      setToast({ type: 'error', message: err.message || 'Failed to upload image' });
    } finally {
      URL.revokeObjectURL(blobUrl);
      setSending(false);
      sendingRef.current = false;
    }
  }, [sending, locationId, user, playSound]);

  // Item use handler — POST to consume, trigger smoke effect, add chat message
  const handleUseItem = useCallback(async (itemId) => {
    try {
      const data = await api('/api/shop/use', {
        method: 'POST',
        body: JSON.stringify({ item_id: itemId, locationId })
      });
      if (data.success) {
        triggerEffect('smoke');
        const characterName = user?.characterName || user?.global_name || user?.username || 'You';
        const actionMsg = {
          role: 'system',
          text: `*${characterName} ${data.use_message}*`,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, actionMsg]);
      }
      return data.inventory;
    } catch (err) {
      setToast({ type: 'error', message: err.data?.error || err.message || 'Failed to use item' });
      throw err;
    }
  }, [locationId, user, triggerEffect]);

  // Dice roll handler — show 3D dice first, then POST results after they settle
  const handleDiceRoll = useCallback((notation) => {
    setDiceRoll({ notation, diceColor: '#F97316' });
  }, []);

  const handleDiceResult = useCallback(async (rolls) => {
    // Regular dice roll — POST to server
    const notation = diceRoll?.notation;
    if (!notation) return;
    try {
      const data = await api(`/api/chat/locations/${locationId}/dice-roll`, {
        method: 'POST',
        body: JSON.stringify({ notation, rolls })
      });
      if (data.message) {
        if (data.message.id && !knownIdsRef.current.has(data.message.id)) {
          knownIdsRef.current.add(data.message.id);
          if (data.message.timestamp && (!latestTimestampRef.current || data.message.timestamp > latestTimestampRef.current)) {
            latestTimestampRef.current = data.message.timestamp;
          }
          setMessages(prev => [...prev, data.message]);
        }
      }
      queueAchievements(data.newAchievements);
      if (data.levelUp) triggerLevelUp(data.levelUp.newLevel);
    } catch (err) {
      const msg = err.data?.error || err.message || 'Failed to save dice roll';
      setToast({ type: 'error', message: msg });
    }
  }, [locationId, diceRoll?.notation]);

  const handleDiceDone = useCallback(() => {
    setDiceRoll(null);
  }, []);

  // Reaction handlers
  const handleLongPress = useCallback((messageId, targetRect) => {
    // Find the message to determine if it can be deleted
    const msg = messages.find(m => m.id === messageId);
    let canDelete = false;
    if (msg) {
      if (isAdmin) {
        canDelete = true;
      } else if (msg.role === 'player' && msg.userId === user?.id) {
        canDelete = true;
      }
    }
    setReactionBar({ messageId, targetRect, canDelete });
  }, [messages, isAdmin, user]);

  const handleReact = useCallback(async (messageId, emoji) => {
    setReactionBar(null);
    setEmojiSheet(null);

    try {
      const reactUrl = isMarcelDm
        ? `/api/marcel-dm/channel/messages/${messageId}/react?userId=${marcelDmUserId}`
        : `/api/chat/locations/${locationId}/messages/${messageId}/react`;
      const data = await api(reactUrl, {
        method: 'POST',
        body: JSON.stringify({ emoji })
      });

      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { ...msg, reactions: Object.keys(data.reactions).length > 0 ? data.reactions : undefined }
          : msg
      ));

      if (data.xpAwarded) showXpFloat(data.xpAwarded);
      queueAchievements(data.newAchievements);
      if (data.levelUp) triggerLevelUp(data.levelUp.newLevel);
    } catch (err) {
      console.error('Failed to toggle reaction:', err);
    }
  }, [locationId]);

  const handleOpenFullPicker = useCallback((messageId) => {
    setReactionBar(null);
    setEmojiSheet({ messageId });
  }, []);

  const handleDelete = useCallback(async (messageId) => {
    try {
      // Marcel DM channels don't currently support delete, but keep the path for consistency
      await api(`/api/chat/locations/${locationId}/messages/${messageId}`, {
        method: 'DELETE'
      });
      setMessages(prev => prev.filter(m => m.id !== messageId));
      knownIdsRef.current.delete(messageId);
    } catch (err) {
      console.error('Failed to delete message:', err);
      setToast({ type: 'error', message: err.message || 'Failed to delete message' });
    }
  }, [locationId]);

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
      if (result.xpAwarded) showXpFloat(result.xpAwarded);
      queueAchievements(result.newAchievements);
      if (result.levelUp) triggerLevelUp(result.levelUp.newLevel);
      setToast({ type: 'success', message: result.message || `Purchased ${item.name}!` });
    } catch (err) {
      setToast({ type: 'error', message: err.data?.error || 'Purchase failed' });
    } finally {
      setBuying(false);
    }
  }

  // Scene interaction handlers
  const handleNpcClick = (npcId) => {
    const npc = location.npcs.find(n => n.id === npcId);
    if (npc) {
      setViewMode('chat');
      setInsertNpc(npc);
      return;
    }
    // Player sprites are in npcPlacements but not in npcs — match by character name
    const player = players.find(p => p.characterName.toLowerCase() === npcId.toLowerCase());
    setViewMode('chat');
    if (player) setInsertNpc({ displayName: player.characterName });
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
            <button className="chat-back-btn" onClick={() => { playSound('buttonTap'); (hasScene && !isMarcelDm) ? handleBackToScene() : navigate('/map'); }}>
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

          {/* Presence Strip — who's here */}
          <PresenceStrip users={presence} currentUserId={user?.id} />

          {/* Chat Messages — column-reverse so browser natively anchors to bottom */}
          <div className="chat-messages-container">
            <div className="chat-messages" ref={chatAreaRef}>
              <div className="chat-messages-inner">
                {messages.length === 0 ? (
                  <div className="chat-messages-empty">
                    <span className="chat-messages-empty-icon">💬</span>
                    <p>You've entered {location.name}.</p>
                    <p>Say something to start a conversation.</p>
                  </div>
                ) : (
                  <>
                    {hasMore && (
                      <div className="chat-load-more">
                        {loadingMore ? (
                          <div className="chat-load-more-spinner" />
                        ) : (
                          <button className="chat-load-more-btn" onClick={handleLoadMore}>Load older messages</button>
                        )}
                      </div>
                    )}
                    {messages.map((msg, i) => (
                      <ChatBubble
                        key={msg.id || i}
                        message={msg}
                        npcs={location.npcs}
                        players={players}
                        groups={location.groups}
                        currentUserId={user?.id}
                        onLongPress={handleLongPress}
                        onReact={handleReact}
                        onNameTap={setInsertNpc}
                      />
                    ))}
                    {Object.entries(typingNpcs).map(([npcId, data]) => (
                      <ChatBubble 
                        key={`typing-${npcId}`} 
                        message={{ 
                          role: 'npc', 
                          npc: npcId, 
                          npcDisplayName: data.displayName, 
                          typing: true 
                        }} 
                        npcs={location.npcs} 
                      />
                    ))}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
            <div ref={scrollThumbRef} className="chat-scroll-thumb" />
          </div>

          {/* Chat Input */}
          {USE_CUSTOM_KEYBOARD ? (
            <ChatInputCustom
              onSend={handleSend}
              onSendGif={handleSendGif}
              onSendImage={handleSendImage}
              disabled={sending}
              npcs={location.npcs}
              npcEmotions={npcEmotions}
              groups={location.groups || {}}
              players={players}
              insertNpc={insertNpc}
              onInsertNpcDone={() => setInsertNpc(null)}
              playSound={playSound}
              scrollContainerRef={chatAreaRef}
              onDiceRoll={handleDiceRoll}
              onUseItem={handleUseItem}
              locationId={locationId}
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

          {/* Reaction Bar (long-press quick emojis) */}
          {reactionBar && (
            <EmojiReactionBar
              messageId={reactionBar.messageId}
              targetRect={reactionBar.targetRect}
              onSelect={handleReact}
              onOpenFullPicker={handleOpenFullPicker}
              onClose={() => setReactionBar(null)}
              canDelete={reactionBar.canDelete}
              onDelete={handleDelete}
            />
          )}

          {/* Emoji Picker Sheet (full grid) */}
          {emojiSheet && (
            <EmojiPickerSheet
              messageId={emojiSheet.messageId}
              onSelect={handleReact}
              onClose={() => setEmojiSheet(null)}
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

      {/* 3D Dice Overlay */}
      {diceRoll && diceOverlayEnabled && (
        <Suspense fallback={null}>
          <DiceOverlay
            key={diceRoll.key || 0}
            notation={diceRoll.notation}
            themeColor={diceRoll.diceColor || '#F97316'}
            onResult={handleDiceResult}
            onDone={handleDiceDone}
          />
        </Suspense>
      )}

      {/* XP Float */}
      {xpFloat && (
        <XpFloat
          key={xpFloat.key}
          amount={xpFloat.amount}
          onDone={() => setXpFloat(null)}
        />
      )}

      {/* Achievement Toast */}
      {achievementQueue.length > 0 && (
        <AchievementToast
          key={achievementQueue[0].id}
          achievement={achievementQueue[0]}
          onDismiss={dismissAchievement}
        />
      )}

      {/* Level-Up Overlay — shows after achievements clear */}
      {levelUp && achievementQueue.length === 0 && (
        <LevelUpOverlay
          key={levelUp}
          level={levelUp}
          onDismiss={() => setLevelUp(null)}
        />
      )}

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
