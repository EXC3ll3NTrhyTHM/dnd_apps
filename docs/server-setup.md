# Production Server Setup

## Server
- **Host**: `blake@192.168.1.149` (zoidberg)
- **OS**: Ubuntu 26.04 LTS
- **Project path**: `/home/blake/code/dnd_apps/`
- **Public URL**: `https://okhan-architect.com` (Cloudflare tunnel)

## What's Running
- **Web app**: Express server on port 3420 (`web-app/`)
- **Cloudflare tunnel**: `dragons-hollow` tunnel → `localhost:3420`
- Discord bots are NOT running — abandoned in favour of web app only

## Starting the App Manually
```bash
# Build the React client (only needed after code changes)
cd /home/blake/code/dnd_apps/web-app
npm run build

# Start the server
npm run start:prod

# Start the Cloudflare tunnel (separate terminal)
cloudflared tunnel run dragons-hollow
```

## pm2 (Process Manager)
Both the app and tunnel are managed by pm2 and configured to auto-start on reboot via systemd (`pm2-blake.service`).

```bash
# Check status
pm2 status

# View logs
pm2 logs dragons-hollow-app
pm2 logs cloudflare-tunnel

# Restart
pm2 restart dragons-hollow-app
pm2 restart cloudflare-tunnel

# Stop everything
pm2 stop all
```

### After code changes
```bash
cd /home/blake/code/dnd_apps/web-app
npm run build
pm2 restart dragons-hollow-app
```

### If you add new pm2 processes
```bash
pm2 save   # re-save the process list so it persists on reboot
```

### Remove auto-start
```bash
pm2 unstartup systemd
```

## Cloudflare Tunnel
- **Tunnel name**: `dragons-hollow`
- **Tunnel ID**: `bbc9a0c8-660e-42f8-9a3b-edf0b876004c`
- **Config**: `/home/blake/.cloudflared/config.yml`
- **Credentials**: `/home/blake/.cloudflared/bbc9a0c8-660e-42f8-9a3b-edf0b876004c.json`

## Environment Files
All `.env` files live on the server at:
- `/home/blake/code/dnd_apps/web-app/.env` — main web app config
- `/home/blake/code/dnd_apps/.env.<npcname>` — per-NPC Gemini TTS config

## Dependencies
Node 24, npm 11 installed globally. Three separate `npm install` locations:
- `/home/blake/code/dnd_apps/` (bot deps, still present but unused)
- `/home/blake/code/dnd_apps/web-app/` (server deps)
- `/home/blake/code/dnd_apps/web-app/client/` (React/Vite deps)
