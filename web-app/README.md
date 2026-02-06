# 🐉 Dragon's Hollow - D&D Companion Web App

A mobile-first Progressive Web App (PWA) for the D&D Discord server. Browse the tavern menu, shop for items, check quests, and view the leaderboard — all from your phone.

## Architecture

```
web-app/
├── server/                 # Express API server
│   ├── server.js           # Main Express app
│   ├── lib/
│   │   ├── economy.js      # Economy data layer (reads/writes bot JSON files)
│   │   └── discord-auth.js # Discord OAuth2 helpers
│   ├── middleware/
│   │   └── auth.js         # JWT authentication middleware
│   └── routes/
│       ├── auth.js         # /api/auth/* - Discord OAuth flow
│       ├── wallet.js       # /api/wallet, /api/inventory
│       ├── shop.js         # /api/shop/* - Grumm's Shop
│       ├── tavern.js       # /api/tavern/* - Big Tam's tavern
│       ├── quests.js       # /api/quests/* - Quest board
│       └── leaderboard.js  # /api/leaderboard
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Route pages
│   │   ├── hooks/          # Auth & API hooks
│   │   └── styles/         # CSS (theme variables, page styles)
│   └── public/             # Static assets & PWA icons
├── .env.template           # Environment variables template
└── package.json            # Root package with dev/build scripts
```

## Setup

### 1. Create Discord OAuth2 Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application (or use existing bot's application)
3. Go to **OAuth2** → **General**
4. Add redirect URL: `http://localhost:3420/api/auth/callback`
5. Copy the **Client ID** and **Client Secret**

### 2. Configure Environment

```bash
cd web-app
copy .env.template .env
```

Edit `.env` with your Discord credentials:
```
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
JWT_SECRET=generate_a_random_string_here
```

### 3. Install Dependencies

```bash
# Install server dependencies
npm install

# Install client dependencies
cd client
npm install
cd ..
```

### 4. Run Development

```bash
npm run dev
```

This starts both the Express API (port 3420) and the Vite dev server (port 5173).

- **Frontend:** http://localhost:5173
- **API:** http://localhost:3420/api

### 5. Build for Production

```bash
npm run build
npm run start:prod
```

In production mode, the Express server serves both the API and the built React app on port 3420.

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/auth/login` | No | Redirect to Discord OAuth |
| GET | `/api/auth/callback` | No | Handle OAuth callback |
| GET | `/api/auth/me` | Yes | Current user + wallet + inventory |
| POST | `/api/auth/logout` | No | Clear session |
| GET | `/api/wallet` | Yes | Gold balance |
| GET | `/api/inventory` | Yes | Player inventory |
| GET | `/api/shop/catalog` | No | Full shop catalog |
| POST | `/api/shop/buy` | Yes | Purchase shop item |
| GET | `/api/tavern/menu` | No | Tavern menu |
| POST | `/api/tavern/buy` | Yes | Buy from tavern (via signal) |
| GET | `/api/quests/all` | No* | All quests |
| GET | `/api/quests/available` | No* | Available quests |
| GET | `/api/quests/active` | No* | Active quests |
| GET | `/api/quests/completed` | No* | Completed quests |
| GET | `/api/leaderboard` | No* | Gold leaderboard |

*These endpoints work without auth but may include personalized data when authenticated.

## Data Integration

This app reads and writes the **same JSON files** the Discord bots use:

- `economy/wallets.prod.json` — Player gold balances
- `economy/inventories.prod.json` — Player items/badges
- `economy/transactions.prod.json` — Transaction log
- `economy/shop_catalog.json` — Grumm's shop items
- `economy/currency_signals/` — Signal files for cross-bot purchases
- `characters/bigtam/tavern_menu.json` — Tavern menu
- `questmaster/party_quests.prod.json` — Quest data

**Tavern purchases** use the currency signal system (write signal → shopkeeper processes → read result) so the shopkeeper bot stays in control of gold deductions.

**Shop purchases** write directly to economy files using the same atomic write pattern (write .tmp → rename) as the bots.

## PWA Installation

On mobile:
1. Open the app in your phone's browser
2. **iOS:** Tap Share → "Add to Home Screen"
3. **Android:** Tap the menu → "Install App" or "Add to Home Screen"

The app runs in standalone/fullscreen mode when installed.

## Tech Stack

- **Backend:** Express.js, JWT, cookie-parser
- **Frontend:** React 18, React Router 6, Vite
- **PWA:** vite-plugin-pwa (Workbox)
- **Fonts:** Cinzel (headings), Inter (body)
- **Theme:** Dark fantasy (CSS custom properties)
