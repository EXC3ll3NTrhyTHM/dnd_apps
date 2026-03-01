# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dragon's Hollow is a mobile-first PWA companion app for a D&D Discord server. It provides location-based NPC chat (powered by OpenAI), real-time combat encounters, an economy system, dice rolling, fishing, pets, and player progression. The app shares live JSON data files with Discord bots running in sibling directories.

## Commands

```bash
# Development (starts Express API on :3420 + Vite dev server on :5173)
npm run dev

# Build client for production
npm run build

# Production (serves API + built React app on :3420)
npm run start:prod

# Run all E2E tests (Playwright, headless)
npm test

# Run a single E2E test file
npx playwright test test/e2e/dice.spec.js

# Run tests matching a pattern
npx playwright test --grep "authentication"

# Run E2E with visible browser
npm run test:headed

# Playwright UI mode (interactive debugger)
npm run test:e2e:ui

# Unit tests
npm run test:unit

# Run a single unit test
node --test test/unit/someTest.js
```

## Architecture

**Monorepo with two packages:** root `package.json` (server + dev tools) and `client/package.json` (React app).

### Server (CommonJS)
- **Express + WebSocket** on port 3420 (`server/server.js`)
- `server/routes/` — 22 REST route modules mounted at `/api/*`
- `server/lib/` — business logic (economy, encounters, dialogue, XP, achievements, etc.)
- `server/middleware/auth.js` — JWT auth with `authRequired` and `authOptional` helpers
- WebSocket at `/ws` — clients send `{ type: 'identify', userId, currentLocation }`, server broadcasts combat events, presence changes, typing indicators, and toasts via `req.app.get('wss')`

### Client (ES modules, React 18 + Vite)
- **HashRouter** (`/#/path`) — not BrowserRouter
- `client/src/pages/` — route pages (Arena, LocationChat, Map, Profile, Admin, etc.)
- `client/src/components/` — ~64 React components
- `client/src/hooks/useAuth.jsx` — auth context providing `user`, `wallet`, XP; JWT stored in `localStorage` as `dh_token`
- `client/src/hooks/useApi.js` — fetch wrapper that attaches `Authorization: Bearer` header
- Vite proxies `/api`, `/images`, `/sounds`, `/uploads`, `/ws` to localhost:3420 in dev

### Data Layer
- **All game state is JSON files** — no database. Files live in `data/`, `../economy/`, `../characters/`, `../questmaster/`
- Paths centralized in `server/lib/dataPaths.js` (overridable via `TEST_DATA_DIR` etc. for tests)
- **Atomic writes required:** write to `.tmp` then `fs.renameSync` to final path (see `economy.js` `atomicWrite`)
- Economy files (`wallets.prod.json`, `inventories.prod.json`, `transactions.prod.json`) are shared with Discord bots — always use prod data regardless of NODE_ENV
- Chat history: `data/chat_history/shared/{locationId}.json` (shared location chat) and `data/chat_history/marcel_dm/{userId}.json` (1-on-1 NPC DMs)

### NPC Dialogue System
- NPC personalities defined in `../characters/{npcName}/` with `SOUL.md`, `CONTEXT.md`, `MEMORY.md`, `journal.md`, `emojis.json`
- `server/lib/dialogue.js` builds system prompts from these files and calls OpenAI API
- NPC responses include `{ text, emotion, repDelta }` — emotions: idle, happy, angry, suspicious, sad, surprised, scared, thoughtful

### Combat Encounter System
- Core engine: `server/lib/encounters.js` (~128KB) — the most complex module
- Encounters are **ephemeral in-memory state** (not persisted, lost on server restart)
- Flow: spawn → join → initiative → action submission → round resolution → rewards
- Client UI: `client/src/pages/Arena.jsx` (~222KB) — the most complex page
- Spell definitions are data-driven objects in encounters.js

## Testing

- **E2E tests** use Playwright against a test server on port 3421 with isolated test data
- Tests run **sequentially** (`workers: 1`) because they share server state
- Mobile viewport: 390x844 (portrait)
- Auth in tests: use `loginAsTestUser(page)` or `getTestAuthHeaders({ request })` from `test/helpers/auth.js` — calls the dev-only `/api/auth/test-login` endpoint
- Navigation in tests: use `window.location.hash = '/#/path'` (HashRouter)

## Key Patterns

- **WebSocket broadcasting:** `const wss = req.app.get('wss'); wss.clients.forEach(c => c.send(JSON.stringify(payload)));` — filter by `client.currentLocation` for location-scoped events
- **Auth middleware:** `authRequired` (401 if no valid JWT) and `authOptional` (attaches user if token present, continues regardless)
- **DM-only routes:** check `req.user.isDM` (set from `DM_USER_IDS` env var)
- **Currency signals:** tavern purchases use signal files in `economy/currency_signals/` for cross-bot coordination rather than direct writes
- **PWA:** Vite PWA plugin with Workbox, service worker in `client/public/sw-push.js` for push notifications
