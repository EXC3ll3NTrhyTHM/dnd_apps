# Dragon's Hollow — AI NPC Voice System

A mobile web app companion for live D&D campaigns featuring AI-powered NPCs with real-time voice synthesis.

## Demo Video
[INSERT YOUTUBE/DRIVE LINK]

## What It Does

Players interact with 14 AI NPCs through a mobile chat interface. Using the `!voice` command, players can request spoken responses — the NPC's reply is synthesized in a character-specific voice and accent and delivered as playable audio directly in the chat bubble.

**Full pipeline:**
```
Player speaks → Speech-to-Text → types !voice @NpcName message → sends
→ Server strips !voice, sends message to GPT-4o-mini with NPC persona prompt
→ GPT returns text with [delivery cues]
→ Gemini TTS synthesizes audio with character accent
→ WAV served to client → ▶ Play voice button appears on NPC message
```

## Models Used

| Model | Purpose |
|-------|---------|
| `gpt-4o-mini` (OpenAI) | NPC dialogue generation |
| `gemini-2.5-flash-preview-tts` (Google) | Text-to-speech voice output |
| Web Speech API (Google ASR) | Speech-to-text player input |

## How to Run

### Prerequisites
- Node.js 18+
- Discord OAuth app (client ID + secret)
- OpenAI API key
- Google Gemini API key

### Setup

```bash
# Install bot dependencies
npm install

# Install web app dependencies
cd web-app && npm install

# Configure environment
cp web-app/.env.template web-app/.env
# Fill in: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, OPENAI_API_KEY

# For each NPC (e.g. bonesy), create .env.bonesy:
# GEMINI_API_KEY=your_key
# TTS_VOICE=Enceladus
# TTS_ACCENT=[optional accent description]
```

### Run

```bash
# Terminal 1 — Discord bots
npm run start:all

# Terminal 2 — Web app (dev)
cd web-app && npm run dev
```

App runs at `http://localhost:5173`

## Using the Voice Feature

1. Open a location chat in the app
2. Tap the **+** keyboard extras button
3. Tap **NPC Speak** (microphone icon)
4. Select an NPC from the portrait grid
5. `!voice @NpcName ` is inserted — type your message after it
6. Send — the NPC's response appears with a **▶ Play voice** button
7. Tap the button to hear the NPC speak

**Speech-to-text input:** Tap the **Speech to Text** button in the extras drawer and speak — your words are transcribed into the message field.

## Project Structure

```
npc-bot/
├── bot.js                    # Discord bot entry point
├── characters/               # NPC character files (SOUL.md, MEMORY.md, etc.)
├── web-app/
│   ├── server/
│   │   ├── server.js         # Express server
│   │   ├── lib/
│   │   │   ├── tts.js        # Gemini TTS integration + audio caching
│   │   │   └── dialogue.js   # NPC prompt construction + GPT calls
│   │   └── routes/
│   │       ├── voice.js      # POST /api/voice/generate, GET /api/voice/cache/:file
│   │       └── chat.js       # Chat handler — detects !voice, attaches audioUrl
│   └── client/src/
│       ├── components/
│       │   ├── CustomKeyboard.jsx   # NPC Speak panel in extras drawer
│       │   ├── ChatInputCustom.jsx  # Inserts !voice @NpcName on NPC selection
│       │   └── ChatBubble.jsx       # Voice tag styling + play button
│       └── styles/
│           └── location-chat.css   # .voice-tag, .chat-bubble-play-btn
├── docs/
│   ├── audio-ai-writeup.md   # Full technical writeup
│   └── slides-content.md     # Slide content
└── .env.<npcname>            # Per-NPC config (TTS_VOICE, TTS_ACCENT, GEMINI_API_KEY)
```

## Libraries Used

### Backend
| Library | Purpose |
|---------|---------|
| `express` | HTTP server |
| `@google/genai` | Gemini TTS API |
| `openai` | GPT-4o-mini API |
| `discord.js` | Discord bot |
| `ws` | WebSocket server |
| `dotenv` | Environment config |

### Frontend
| Library | Purpose |
|---------|---------|
| `react` | UI framework |
| `vite` | Build tool |
| `Web Speech API` | Browser-native STT (no package required) |

## Sample Outputs

### TTS Accent Configs (per NPC)

**Kai (young fighter):**
```
[loud, energetic young Chinese male voice — fast-talking, impulsive, always fired up.
Sentences crash into each other. Talk like you're ready to fight RIGHT NOW.]
```

**Brynleaf (dwarven ranger):**
```
[thick, heavy Scottish highland brogue — rough and weathered, speaks slow and
deliberate with clipped consonants]
```

**Kumo (blacksmith):**
```
[deep, rumbling Japanese male voice — like distant thunder, speaks slowly and
with weight, every word deliberate]
```

### Voice Mode LLM Output (with delivery cues)
```
[low, weary] Another adventurer. [pause] Try not to bleed on the floor this time.
```
```
[excited whisper] Dude... [building intensity] I think that's actually a dragon.
```

## Evaluation Summary

| Metric | Baseline (no cues) | Full System |
|--------|-------------------|-------------|
| Character consistency | Low | High |
| Emotional range | Flat | Natural variation |
| STT latency | 200–400ms | 200–400ms |
| TTS latency | 900–1800ms | 900–1800ms |
| End-to-end voice | N/A | 1.8–3.3 seconds |

## AI Tools Disclosure

| Tool | Use |
|------|-----|
| **Claude Code (Anthropic)** | Primary development assistant — backend routes, React components, architecture |
| **GPT-4o-mini** | Runtime product (NPC dialogue) |
| **Gemini 2.5 Flash TTS** | Runtime product (NPC voice) |
| **Web Speech API** | Runtime product (player STT input) |

All AI-assisted code is clearly part of the application source. Character files (SOUL.md, CONTEXT.md, MEMORY.md, accent strings) were written by the developer.
