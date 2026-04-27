# Dragon's Hollow — Slide Content
### Paste into Gamma, Canva, or PowerPoint

---

## SLIDE 1 — Title

**Dragon's Hollow**
AI-Powered NPC Voice System for Live D&D Campaigns

Blake Simpson | Applied AI

---

## SLIDE 2 — Problem Description

**The Problem:**
Tabletop RPG players want immersive NPC interactions — but text-only chat makes every character feel the same. There's no voice, no personality, no "feel" to the conversation.

**Specific Gaps:**
- Players can't "hear" the NPCs they're talking to
- Generic AI responses break immersion
- Typing messages is slow and disrupts the flow of play
- No memory between sessions — NPCs forget everything

**The Goal:**
Build a system where AI NPCs have consistent personalities, speak in their own voice, and remember past events — all in real time through a mobile web app.

---

## SLIDE 3 — Why It's Interesting / Business Value

**Why It Matters:**
- The tabletop RPG market is ~$2.5B and growing (post-D&D 5e / Critical Role boom)
- AI dungeon masters and NPC companions are an emerging product category
- Voice-driven character interaction is a step beyond current text-only AI companions

**Technical Value:**
- Demonstrates a full speech-in / speech-out pipeline for fictional characters
- Shows how prompt engineering can replace fine-tuning for character consistency
- The architecture is reusable: game NPCs, museum audio guides, interactive fiction, customer service personas

**The "Bonus" Angle:**
This project hits the multimodal bonus requirement:
> **Speech → Text → NPC Dialogue → Voice Narration** — a complete loop

---

## SLIDE 4 — Dataset / Inputs

**No training dataset required** — the system uses prompt-based conditioning instead of fine-tuning.

**Character "Dataset" (per NPC):**

| File | Contents |
|------|----------|
| `SOUL.md` | Personality, backstory, speech patterns, fears, goals |
| `CONTEXT.md` | Campaign lore, world history, NPC's role |
| `MEMORY.md` | Long-term facts accumulated over play sessions |
| `journal.md` | Recent events, auto-updated after every conversation |

**Runtime Inputs:**
- Player typed messages (or voice-transcribed via Web Speech API)
- `!voice @NpcName` command triggers TTS pipeline
- `TTS_VOICE` — one of 30 Gemini voice names (per character)
- `TTS_ACCENT` — natural language style description (per character)

**Scale:** 14 active NPCs, each with unique character files and voice configs

---

## SLIDE 5 — Models Used

| Model | Purpose | Provider |
|-------|---------|---------|
| **GPT-4o-mini** | NPC dialogue generation | OpenAI |
| **Gemini 2.5 Flash TTS** (`gemini-2.5-flash-preview-tts`) | Text-to-speech voice output | Google DeepMind |
| **Web Speech API** (Google ASR) | Speech-to-text input from player microphone | Google / Browser-native |

**Why these models:**
- GPT-4o-mini: fast, cost-effective, strong instruction-following for character roleplay
- Gemini TTS: supports natural language prosody cues in brackets — uniquely suited to NPC-style expressive speech
- Web Speech API: zero-setup STT, available on any modern mobile browser with no API key

---

## SLIDE 6 — Pipeline Architecture

```
[ Player speaks ]
       ↓
[ Web Speech API → transcribed text ]
       ↓
[ Player types "!voice @Bonesy <message>" and sends ]
       ↓
[ Server detects !voice flag ]
       ↓
[ Strip !voice prefix → send cleaned message to GPT-4o-mini ]
[ With: NPC system prompt (SOUL + CONTEXT + MEMORY + journal) ]
[ Plus: Voice Mode block (instructs short, cued speech output) ]
       ↓
[ GPT returns: "[weary] Another day, another bloodstain on my floor." ]
       ↓
[ Prepend TTS_ACCENT cue → send to Gemini 2.5 Flash TTS ]
       ↓
[ Gemini returns PCM audio → wrapped in WAV ]
[ Saved to server cache, URL attached to NPC message ]
       ↓
[ Client receives message with audioUrl ]
[ "▶ Play voice" button appears on NPC's chat bubble ]
[ Player taps → audio plays ]
```

**Total latency:** ~1.8–3.3 seconds

---

## SLIDE 7 — Prompt / Input Design

**Three layers of engineering:**

### Layer 1 — Character System Prompt
Each NPC's personality documents are loaded and assembled into a structured system prompt at runtime. The model is told it *is* the character (first person, never break character, respond as they would).

### Layer 2 — Voice Mode Block
When `!voice` is detected, an extra block is appended to the system prompt:
> *"This response will be spoken aloud via TTS. Keep to 1-3 short sentences. Use [cues] in brackets to control tone and pacing. Example: [gruff, dismissive] Yeah, don't think so, pal."*

The LLM then writes speech-optimized output with embedded delivery instructions.

### Layer 3 — TTS Accent Anchoring
A per-character accent description is prepended to every TTS call:

**Kai (young fighter):**
> `[loud, energetic young Chinese male voice — fast-talking, impulsive, always fired up. Talk like you're ready to fight RIGHT NOW.]`

**Brynleaf (dwarven ranger):**
> `[thick, heavy Scottish highland brogue — rough and weathered, speaks slow and deliberate with clipped consonants]`

Final TTS input = `{accent cue} + {LLM response with [cues]}`

---

## SLIDE 8 — Results

**What was built:**
- 14 NPCs with distinct voices, accents, and personalities
- Full `!voice` pipeline: player message → NPC text → spoken audio → play button in chat
- Speech-to-text mic input in the message keyboard
- NPC memory system: journal auto-updates after sessions so NPCs recall past events

**Sample NPC voices (describe or show screenshots of chat bubbles with play buttons):**
- Bonesy (undead barkeep) → Enceladus voice, gravelly delivery
- Kai (young fighter) → Alnilam voice, loud/energetic accent cue
- Kumo (blacksmith) → Umbriel voice, deep/slow Japanese accent cue
- Brynleaf (ranger) → Autonoe voice, Scottish brogue accent cue

**Expressiveness comparison:**
| Setup | Character Feel |
|-------|---------------|
| No accent, no cues | Generic, flat |
| Voice only | Some variation |
| Accent cue only | Consistent register, flat emotion |
| Full system (accent + cues) | Strong character, emotional range |

---

## SLIDE 9 — Evaluation

### STT Evaluation

| Condition | Quality |
|-----------|---------|
| Quiet room, clear speech | High — near-perfect |
| Background noise | Medium — common word errors |
| D&D proper nouns (NPC names, locations) | Low-medium — no domain vocab |

**Latency:** 200–400ms to final transcript

### TTS Evaluation

| Metric | Observation |
|--------|-------------|
| Character consistency | High with full prompt stack |
| Emotional range | Natural — cues produce distinct deliveries |
| Realism | Clearly synthetic but expressive |
| Latency | 900–1800ms per generation |

### End-to-End Latency

| Step | Time |
|------|------|
| GPT-4o-mini response | 800–1500ms |
| Gemini TTS generation | 900–1800ms |
| **Total** | **1.8–3.3 seconds** |

---

## SLIDE 10 — Demo Video

**[Embed YouTube/Drive thumbnail here]**

Demo shows:
1. Opening the NPC Speak panel in the keyboard
2. Selecting an NPC from the portrait grid
3. `!voice @NpcName` auto-inserted into the message field
4. Typing a message and sending
5. NPC text response appearing with "▶ Play voice" button
6. Tapping play — audio of the NPC speaking in character

**Link:** [YOUR VIDEO URL HERE]

---

## SLIDE 11 — Limitations

| Limitation | Impact | Possible Fix |
|-----------|--------|-------------|
| Gemini TTS latency (0.9–1.8s) | Noticeable wait on voice messages | Pre-generate or stream audio |
| Browser autoplay policy | Audio requires explicit tap to play | Acceptable UX tradeoff |
| STT struggles with D&D proper nouns | Names like "Okhan" often mistranscribed | Custom vocabulary / post-correction |
| No voice fine-tuning — purely prompt-based | Accent cues are approximate, not exact | Fine-tune a local TTS model per character |
| 5-minute audio cache TTL | Audio link expires | Increase TTL or store permanently |
| Single language (en-US) | No multilingual support | Change `lang` param in STT, multilingual TTS |

---

## SLIDE 12 — GitHub & AI Tools Used

**GitHub:** [YOUR REPO LINK]

**AI Tools Used (Required Disclosure):**

| Tool | How It Was Used |
|------|----------------|
| **Claude Code (Anthropic)** | Primary development assistant — wrote majority of backend routes, React components, and system architecture. Used throughout the entire build. |
| **GPT-4o-mini (OpenAI)** | Runtime NPC dialogue generation (part of the product itself) |
| **Gemini 2.5 Flash TTS (Google)** | Runtime NPC voice synthesis (part of the product itself) |
| **Web Speech API** | Runtime speech-to-text input (part of the product itself) |

**What was AI-assisted:**
- Server route code (`server/routes/voice.js`, `server/lib/tts.js`)
- React components (`CustomKeyboard.jsx`, `ChatBubble.jsx`, `ChatInputCustom.jsx`)
- This written writeup and slide content

**What was human-designed:**
- Overall concept and feature design
- NPC character files (SOUL.md, CONTEXT.md, MEMORY.md per character)
- TTS accent strings
- System architecture decisions

---

## SLIDE 13 (Bonus) — Multimodal Innovation

**This project qualifies for the multimodal bonus:**

The full pipeline is:
> **Voice Input → Speech-to-Text → NPC Dialogue Generation → Text-to-Speech Voice Output**

Each modality transitions to the next:
- Raw microphone audio → transcribed text (Google ASR)
- Text + character context → in-character spoken dialogue (GPT-4o-mini)
- Dialogue text + accent/delivery cues → synthesized character voice (Gemini TTS)
- WAV audio → played through mobile browser

This is a working, deployed end-to-end multimodal speech pipeline integrated into a live application used by real players.
