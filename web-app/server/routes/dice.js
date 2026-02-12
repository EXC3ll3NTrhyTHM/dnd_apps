/**
 * Dice Roll API
 *
 * POST /locations/:locationId/dice-roll
 * Parses dice notation, rolls server-side, saves to chat history, broadcasts via WS.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authRequired } = require('../middleware/auth');
const { acquireLock, releaseLock } = require('../lib/locks');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'chat_history');
const SHARED_DIR = path.join(HISTORY_DIR, 'shared');
const PLAYERS_PATH = path.join(DATA_DIR, 'players.json');
const MAX_HISTORY = 30;

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_PATH, 'utf-8')); }
  catch { return {}; }
}

function getPlayerName(user) {
  const players = loadPlayers();
  return players[user.id]?.characterName || user.global_name || user.username;
}

function getHistoryPath(locationId) {
  if (!fs.existsSync(SHARED_DIR)) {
    fs.mkdirSync(SHARED_DIR, { recursive: true });
  }
  return path.join(SHARED_DIR, `${locationId}.json`);
}

function loadHistory(locationId) {
  const histPath = getHistoryPath(locationId);
  try {
    return JSON.parse(fs.readFileSync(histPath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveHistory(locationId, history) {
  const trimmed = history.slice(-MAX_HISTORY);
  const histPath = getHistoryPath(locationId);
  const tmpPath = histPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(trimmed, null, 2));
  fs.renameSync(tmpPath, histPath);
}

// ── Rate limiting: 3 second cooldown per user ──
const lastRollTime = new Map();
const ROLL_COOLDOWN = 3000;

// ── Notation parser ──
// Supports: NdX, NdXkh1, NdXkl1, NdXdl1, NdX+M, NdX-M
// Also supports compound: 2d20kh1+4, 1d6+1d4+3
const DICE_GROUP_RE = /(\d+)d(\d+)(kh\d+|kl\d+|dl\d+)?/gi;
const MODIFIER_RE = /([+-]\d+)(?!d)/g;

function parseDiceNotation(notation) {
  const groups = [];
  let totalModifier = 0;

  // Extract dice groups
  let match;
  const cleaned = notation.replace(/\s/g, '');
  const diceRegex = new RegExp(DICE_GROUP_RE.source, 'gi');

  while ((match = diceRegex.exec(cleaned)) !== null) {
    const qty = Math.min(parseInt(match[1]), 20); // cap at 20 dice per group
    const sides = parseInt(match[2]);

    if (![4, 6, 8, 10, 12, 20, 100].includes(sides)) continue;
    if (qty < 1) continue;

    groups.push({
      qty,
      sides,
      modifier: match[3] ? match[3].toLowerCase() : null,
    });
  }

  // Extract flat modifiers (e.g., +4, -2) that aren't part of NdX
  const withoutDice = cleaned.replace(/\d+d\d+(?:kh\d+|kl\d+|dl\d+)?/gi, '');
  let modMatch;
  const modRegex = new RegExp(MODIFIER_RE.source, 'g');
  while ((modMatch = modRegex.exec(withoutDice)) !== null) {
    totalModifier += parseInt(modMatch[1]);
  }

  return { groups, modifier: totalModifier };
}

function rollDice(parsed, preRolls = null) {
  const allRolls = [];
  const keptIndices = [];
  let rollOffset = 0;
  let preIdx = 0;

  for (const group of parsed.groups) {
    const rolls = [];
    for (let i = 0; i < group.qty; i++) {
      if (preRolls && preIdx < preRolls.length) {
        // Use client-provided value, clamped to valid range
        const val = Math.max(1, Math.min(group.sides, Math.floor(preRolls[preIdx])));
        rolls.push(val);
        preIdx++;
      } else {
        rolls.push(Math.floor(Math.random() * group.sides) + 1);
      }
    }

    const groupStart = rollOffset;

    if (group.modifier) {
      const modMatch = group.modifier.match(/(kh|kl|dl)(\d+)/);
      if (modMatch) {
        const type = modMatch[1];
        const count = Math.min(parseInt(modMatch[2]), rolls.length);

        // Sort indices by value
        const indexed = rolls.map((v, i) => ({ v, i }));

        if (type === 'kh') {
          // Keep highest N
          indexed.sort((a, b) => b.v - a.v);
          for (let i = 0; i < count; i++) {
            keptIndices.push(groupStart + indexed[i].i);
          }
        } else if (type === 'kl') {
          // Keep lowest N
          indexed.sort((a, b) => a.v - b.v);
          for (let i = 0; i < count; i++) {
            keptIndices.push(groupStart + indexed[i].i);
          }
        } else if (type === 'dl') {
          // Drop lowest N — keep everything except the lowest N
          indexed.sort((a, b) => a.v - b.v);
          for (let i = count; i < indexed.length; i++) {
            keptIndices.push(groupStart + indexed[i].i);
          }
        }
      }
    } else {
      // No modifier — keep all
      for (let i = 0; i < rolls.length; i++) {
        keptIndices.push(groupStart + i);
      }
    }

    allRolls.push(...rolls);
    rollOffset += rolls.length;
  }

  // Calculate total from kept dice + modifier
  let total = 0;
  for (const idx of keptIndices) {
    total += allRolls[idx];
  }
  total += parsed.modifier;

  return {
    rolls: allRolls,
    kept: keptIndices,
    total,
    modifier: parsed.modifier,
  };
}

// ── Route ──

router.post('/locations/:locationId/dice-roll', authRequired, async (req, res) => {
  const { locationId } = req.params;
  const { notation, rolls: clientRolls } = req.body;

  if (!notation || typeof notation !== 'string' || notation.length > 100) {
    return res.status(400).json({ error: 'Invalid notation' });
  }

  // Validate client rolls if provided
  const preRolls = Array.isArray(clientRolls) && clientRolls.length > 0 && clientRolls.every(v => typeof v === 'number')
    ? clientRolls.slice(0, 20) // cap at 20 dice
    : null;

  // Rate limit
  const userId = req.user.id;
  const now = Date.now();
  const lastRoll = lastRollTime.get(userId) || 0;
  if (now - lastRoll < ROLL_COOLDOWN) {
    const retryAfter = Math.ceil((ROLL_COOLDOWN - (now - lastRoll)) / 1000);
    return res.status(429).json({ error: 'Wait a moment before rolling again', retryAfter });
  }
  lastRollTime.set(userId, now);

  // Parse and validate
  const parsed = parseDiceNotation(notation);
  if (parsed.groups.length === 0) {
    return res.status(400).json({ error: 'No valid dice in notation' });
  }

  // Roll — use client-provided values from 3D dice if available, else roll server-side
  const result = rollDice(parsed, preRolls);

  // Build message
  const playerName = getPlayerName(req.user);
  const players = loadPlayers();
  const playerAvatar = players[userId]?.avatar || req.user.avatar || null;

  const message = {
    id: crypto.randomUUID(),
    role: 'player',
    type: 'dice_roll',
    userId,
    playerName,
    playerAvatar,
    notation,
    rolls: result.rolls,
    total: result.total,
    kept: result.kept,
    modifier: result.modifier,
    timestamp: new Date().toISOString(),
  };

  // Save to history
  await acquireLock(locationId);
  try {
    const history = loadHistory(locationId);
    history.push(message);
    saveHistory(locationId, history);
  } finally {
    releaseLock(locationId);
  }

  // Broadcast via WebSocket
  const wss = req.app.get('wss');
  if (wss) {
    const payload = JSON.stringify({
      type: 'dice_roll',
      locationId,
      message,
    });
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(payload);
      }
    });
  }

  // Award XP for rolling dice
  try { require('../lib/xp').awardMessageXp(userId, req.user.username); } catch {}

  res.json({ message });
});

module.exports = router;
