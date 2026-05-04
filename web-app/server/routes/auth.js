/**
 * Auth Routes - Discord OAuth2 Flow
 * 
 * GET  /api/auth/discord-url - Return Discord OAuth2 URL as JSON
 * GET  /api/auth/login      - Redirect to Discord (fallback)
 * GET  /api/auth/callback    - Handle Discord callback, issue JWT
 * GET  /api/auth/me        - Get current user (requires auth)
 * POST /api/auth/logout    - Clear session
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getAuthorizationUrl, exchangeCode, fetchUser, getAvatarUrl } = require('../lib/discord-auth');
const { authRequired } = require('../middleware/auth');
const { getWallet, getInventory } = require('../lib/economy');
const { getXpRecord, getLevelFromXp } = require('../lib/xp');

const DM_USER_IDS = (process.env.DM_USER_IDS || '').split(',').filter(Boolean);

const { PLAYERS_PATH } = require('../lib/dataPaths');

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { return {}; }
}

const router = express.Router();

// Return Discord OAuth2 URL as JSON (avoids server-side redirect for mobile deep linking)
router.get('/discord-url', (req, res) => {
  res.json({ url: getAuthorizationUrl() });
});

// Redirect to Discord OAuth2 (fallback)
router.get('/login', (req, res) => {
  res.redirect(getAuthorizationUrl());
});

// Handle Discord callback
router.get('/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:5173'}/#/?error=no_code`);
  }

  try {
    // Exchange code for token
    const tokenData = await exchangeCode(code);

    // Fetch Discord user profile
    const discordUser = await fetchUser(tokenData.access_token);

    // Create JWT payload
    const payload = {
      id: discordUser.id,
      username: discordUser.username,
      global_name: discordUser.global_name || discordUser.username,
      avatar: getAvatarUrl(discordUser),
      discriminator: discordUser.discriminator
    };

    // Sign JWT — long-lived so a device only has to OAuth once.
    // No refresh-token system; revoking everyone requires rotating JWT_SECRET.
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '10y' });

    // Set HTTP-only cookie and redirect to frontend
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 10 * 365 * 24 * 60 * 60 * 1000 // ~10 years
    });

    // Redirect to frontend with token in URL for the SPA to grab
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${clientUrl}/#/auth-callback?token=${token}`);
  } catch (err) {
    console.error('[Auth] OAuth callback error:', err.message);
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${clientUrl}/#/?error=auth_failed`);
  }
});

// Get current authenticated user with wallet & inventory
router.get('/me', authRequired, (req, res) => {
  const wallet = getWallet(req.user.id, req.user.username);
  const inventory = getInventory(req.user.id);

  const players = loadPlayers();
  const characterName = players[req.user.id]?.characterName || null;

  // Persist avatar so enrichHistory can backfill old chat messages
  if (req.user.avatar && (!players[req.user.id] || players[req.user.id].avatar !== req.user.avatar)) {
    if (!players[req.user.id]) players[req.user.id] = {};
    players[req.user.id].avatar = req.user.avatar;
    try {
      const tmpPath = PLAYERS_PATH + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(players, null, 2));
      fs.renameSync(tmpPath, PLAYERS_PATH);
    } catch {}
  }

  const xpRecord = getXpRecord(req.user.id, req.user.username);
  const levelInfo = getLevelFromXp(xpRecord.total_xp);

  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      global_name: req.user.global_name,
      avatar: req.user.avatar,
      characterName,
      isDM: DM_USER_IDS.includes(req.user.id),
    },
    wallet: {
      balance: wallet.balance,
      lifetime_earned: wallet.lifetime_earned,
      lifetime_spent: wallet.lifetime_spent
    },
    inventory,
    xp: {
      total_xp: xpRecord.total_xp,
      level: levelInfo.level,
      xp_in_level: levelInfo.xpInCurrentLevel,
      xp_for_next: levelInfo.xpForNextLevel,
      xp_to_next: levelInfo.xpToNextLevel
    }
  });
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// === TEST LOGIN (dev/test only — bypasses Discord OAuth) ===
if (process.env.NODE_ENV !== 'production') {
  router.post('/test-login', (req, res) => {
    const { userId, username, characterName } = req.body;
    if (!userId || !username) {
      return res.status(400).json({ error: 'userId and username are required' });
    }

    const payload = {
      id: userId,
      username: username,
      global_name: characterName || username,
      avatar: null,
      discriminator: '0000'
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({ token, user: payload });
  });
}

module.exports = router;
