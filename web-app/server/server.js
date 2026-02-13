/**
 * Dragon's Hollow - Express API Server
 * 
 * Serves the React frontend and provides API endpoints for
 * the D&D game economy, tavern, shop, quests, and leaderboard.
 * 
 * Reads/writes the same JSON files the Discord bots use.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const http = require('http');
const { WebSocketServer } = require('ws');

const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const shopRoutes = require('./routes/shop');
const tavernRoutes = require('./routes/tavern');
const questRoutes = require('./routes/quests');
const leaderboardRoutes = require('./routes/leaderboard');
const chatRoutes = require('./routes/chat');
const clawdbotRoutes = require('./routes/clawdbot');
const campaignRoutes = require('./routes/campaign');
const adminRoutes = require('./routes/admin');
const presenceRoutes = require('./routes/presence');
const marcelDmRoutes = require('./routes/marcelDm');
const uploadRoutes = require('./routes/upload');
const xpRoutes = require('./routes/xp');
const notificationRoutes = require('./routes/notifications');
const achievementRoutes = require('./routes/achievements');
const diceRoutes = require('./routes/dice');
const playersRoutes = require('./routes/players');
const characterSheetRoutes = require('./routes/characterSheet');
const encounterRoutes = require('./routes/encounters');
const fishingRoutes = require('./routes/fishing');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const PORT = process.env.PORT || 3420;

wss.on('connection', (ws, req) => {
  console.log(`[wss] New client connected from ${req.socket.remoteAddress}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'identify') {
        ws.userId = msg.userId || null;
        ws.currentLocation = msg.currentLocation || null;
      } else if (msg.type === 'updateLocation') {
        ws.currentLocation = msg.currentLocation || null;
      }
    } catch {
      // ignore non-JSON messages
    }
  });

  ws.on('close', () => console.log('[wss] Client disconnected'));
});

// Export wss for use in routes
app.set('wss', wss);

// ============================================
// MIDDLEWARE
// ============================================

// CORS - allow the Vite dev server in development
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// Request logging (dev only)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    }
    next();
  });
}

// ============================================
// STATIC ASSETS (images, maps, etc.)
// ============================================

const staticCache = { maxAge: '7d' };
app.use('/images', express.static(path.join(__dirname, '..', 'images'), staticCache));
app.use('/sounds', express.static(path.join(__dirname, '..', 'sounds'), staticCache));
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads'), {
  maxAge: '30d',
  immutable: true
}));

// ============================================
// API ROUTES
// ============================================

app.use('/api/auth', authRoutes);
app.use('/api', walletRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/tavern', tavernRoutes);
app.use('/api/quests', questRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/chat', uploadRoutes);
app.use('/api/chat', diceRoutes);
clawdbotRoutes.app = app;
app.use('/api/clawdbot', clawdbotRoutes);
app.use('/api/campaign', campaignRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/presence', presenceRoutes);
app.use('/api/marcel-dm', marcelDmRoutes);
app.use('/api/xp', xpRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/achievements', achievementRoutes);
app.use('/api/players', playersRoutes);
app.use('/api/character-sheet', characterSheetRoutes);
app.use('/api/encounters', encounterRoutes);
app.use('/api/fishing', fishingRoutes);

// Start encounter timeout checker
encounterRoutes.startTimeoutChecker(app);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// STATIC FILES (production)
// ============================================

// In production, serve the built React app
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  // Images already served above via /images route

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });
}

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// START
// ============================================

server.listen(PORT, () => {
  console.log(`\n🐉 Dragon's Hollow API server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`   API: http://localhost:${PORT}/api`);
    console.log(`   Client: ${process.env.CLIENT_URL || 'http://localhost:5173'}\n`);
  }
});
