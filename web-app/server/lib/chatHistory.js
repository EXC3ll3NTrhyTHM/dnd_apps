/**
 * Chat History — Shared storage module
 *
 * Centralizes chat history file I/O for all routes (chat, dice, upload,
 * clawdbot, marcelDm). Supports cursor-based pagination for loading older
 * messages.
 *
 * Channel IDs:
 *   - Regular locations  → data/chat_history/shared/{id}.json
 *   - Marcel DM channels → data/chat_history/marcel_dm/{userId}.json
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'chat_history');
const SHARED_DIR = path.join(HISTORY_DIR, 'shared');
const DM_HISTORY_DIR = path.join(HISTORY_DIR, 'marcel_dm');

// Maximum messages stored per channel (oldest are dropped on save)
const MAX_STORED = 5000;

// Default page size for pagination
const DEFAULT_PAGE_SIZE = 30;

/**
 * Resolve the file path for a channel's history.
 * Handles both shared locations and marcel_dm_* channels.
 */
function resolveHistoryPath(channelId) {
  const dmMatch = channelId.match(/^marcel_dm_(.+)$/);
  if (dmMatch) {
    if (!fs.existsSync(DM_HISTORY_DIR)) {
      fs.mkdirSync(DM_HISTORY_DIR, { recursive: true });
    }
    return path.join(DM_HISTORY_DIR, `${dmMatch[1]}.json`);
  }
  if (!fs.existsSync(SHARED_DIR)) {
    fs.mkdirSync(SHARED_DIR, { recursive: true });
  }
  return path.join(SHARED_DIR, `${channelId}.json`);
}

/**
 * Load full chat history for a channel.
 */
function loadHistory(channelId) {
  const histPath = resolveHistoryPath(channelId);
  try {
    return JSON.parse(fs.readFileSync(histPath, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Save chat history for a channel (atomic write).
 * Trims to MAX_STORED messages from the end.
 */
function saveHistory(channelId, history) {
  const trimmed = history.length > MAX_STORED ? history.slice(-MAX_STORED) : history;
  const histPath = resolveHistoryPath(channelId);
  const tmpPath = histPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(trimmed, null, 2));
  fs.renameSync(tmpPath, histPath);
}

/**
 * Get a page of history for a channel (cursor-based pagination).
 *
 * @param {string} channelId
 * @param {object} opts
 * @param {string} [opts.before] - Message ID cursor; returns messages older than this
 * @param {number} [opts.limit]  - Number of messages to return (default 30, max 100)
 * @returns {{ messages: Array, hasMore: boolean }}
 */
function getHistoryPage(channelId, { before, limit } = {}) {
  const pageSize = Math.min(Math.max(1, limit || DEFAULT_PAGE_SIZE), 100);
  const history = loadHistory(channelId);

  if (!before) {
    // No cursor — return the latest N messages
    const start = Math.max(0, history.length - pageSize);
    return {
      messages: history.slice(start),
      hasMore: start > 0,
    };
  }

  // Find the cursor message
  const cursorIdx = history.findIndex(m => m.id === before);
  if (cursorIdx <= 0) {
    // Cursor not found or is the first message — no older messages
    return { messages: [], hasMore: false };
  }

  const start = Math.max(0, cursorIdx - pageSize);
  return {
    messages: history.slice(start, cursorIdx),
    hasMore: start > 0,
  };
}

module.exports = {
  resolveHistoryPath,
  loadHistory,
  saveHistory,
  getHistoryPage,
  MAX_STORED,
  DEFAULT_PAGE_SIZE,
  SHARED_DIR,
  DM_HISTORY_DIR,
};
