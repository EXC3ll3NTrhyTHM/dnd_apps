# Discord Cleanup — Future Task

Discord has been abandoned. The project is web app only going forward.

## What Can Be Removed

### Root directory (significant cleanup)
- `bot.js` — main Discord bot entry point
- `presence.js` — Discord presence/status
- `start-all.js` — launches all Discord bots
- `characters/<npcname>/` — the SOUL.md, CONTEXT.md, MEMORY.md, journal.md files are
  still used by the web app via `web-app/server/lib/dialogue.js`, so keep the `characters/`
  directory. What can go is any Discord-specific config inside them.
- `questmaster/` — entire directory (Discord-only quest bot)
- `shopkeeper/` — entire directory (Discord-only shop bot)
- `.env.<npcname>` files — currently contain both Discord tokens and Gemini TTS keys.
  The Gemini keys are still needed by the web app's `server/lib/tts.js`. Either strip the
  Discord token lines or migrate TTS config into web-app's own config system.
- All `gen_*.js` image generation scripts (Discord-era tooling)
- `compare_*.js`, `compare_*.png`, `compare_*.json` (old model comparison scripts)
- `*.exe` files (`ffmpeg.exe`, `yt-dlp.exe`) — Windows binaries, not needed on Linux server

### web-app/ (minor cleanup)
- Any routes that reference Discord webhook delivery (check `server/routes/`)
- `DISCORD_TOKEN` references (already not used by web app)

## What Must Stay
- `characters/<npcname>/SOUL.md`, `CONTEXT.md`, `MEMORY.md`, `journal.md` — used by web app NPC dialogue
- `.env.<npcname>` files — needed for `GEMINI_API_KEY`, `TTS_VOICE`, `TTS_ACCENT`
- `web-app/` — everything

## Notes
- The web app NPCs work entirely through `web-app/server/lib/dialogue.js` + OpenAI.
  No Discord bot process is needed for NPC chat.
- TTS voice config currently lives in the Discord bot `.env` files. When cleaning up,
  consider moving `TTS_VOICE` / `TTS_ACCENT` / `GEMINI_API_KEY` into a dedicated
  `web-app/data/npc_voice_config.json` so the Discord `.env` files can be fully removed.
