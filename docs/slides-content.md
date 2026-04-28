# Dragon's Hollow — Slide Content
### With image generation prompts per slide

---

## STYLE GUIDE (apply to all slides)

**Color Palette:**
- Background: `#1a1510`
- Primary text: `#e8d5a3`
- Headings / accent: `#c4956a`
- Highlight: `#8b5e3c`
- Code blocks: `#2a2218`

**Fonts:** Cinzel or Cormorant Garamond (headings) · IM Fell English or Georgia (body)

**Layout:** Text on a semi-transparent dark panel (like a scroll or stone plaque) overlaid on the generated background image.

**Base prompt (shared across all slides):**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail

---

## SLIDE 1 — Title

**IMAGE PROMPT:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — glowing dragon sigil centerpiece, dramatic god-ray lighting from above, smoke curling upward, epic and mysterious

---

**Dragon's Hollow**
AI-Powered NPC Voice System for D&D App

Blake Simpson | Big Data Anaylatics

---

## SLIDE 2 — Problem Description

**IMAGE PROMPT:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — broken hourglass on a worn table, scattered polyhedral dice, a single dim candle casting long shadows, mood of frustration and silence

---

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

**Theme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — open merchant ledger filled with handwritten numbers, gold coins scattered, a quill dipped in ink, warm candlelight, prosperous and secretive atmosphere

---

**Why It Matters:**
- The tabletop RPG market is ~$2.5B and growing (post-D&D 5e / Critical Role boom)
- AI dungeon masters and NPC companions are an emerging product category
- Voice-driven character interaction is a step beyond current text-only AI companions

**Technical Value:**
- Demonstrates a full speech-in / speech-out pipeline for fictional characters
- Shows how prompt engineering can replace fine-tuning for character consistency
- Architecture is reusable: game NPCs, museum audio guides, interactive fiction, customer service personas

**Multimodal Bonus:**
> **Speech → Text → NPC Dialogue → Voice Narration** — a complete loop

---

## SLIDE 4 — Dataset / Inputs

**Theme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — open ancient spellbook with dense handwritten notes, floating softly glowing runes rising from the pages, ink pot and quill nearby, mystical and scholarly

---

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

**Theme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — large arcane crystal orb on a stone pedestal emanating concentric sound wave rings in gold and amber light, ethereal and powerful

---

| Model | Purpose | Provider |
|-------|---------|---------|
| **GPT-4o-mini** | NPC dialogue generation | OpenAI |
| **Gemini 2.5 Flash TTS** | Text-to-speech voice output | Google DeepMind |
| **Web Speech API** (Google ASR) | Speech-to-text from player mic | Browser-native |

**Why these models:**
- GPT-4o-mini: fast, cost-effective, strong instruction-following for character roleplay
- Gemini TTS: supports natural language prosody cues in brackets — uniquely suited to NPC expressive speech
- Web Speech API: zero-setup STT, works on any modern mobile browser with no API key

---

## SLIDE 6 — Pipeline Architecture

**Theme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — aged parchment map covered in dotted connecting lines and small illustrated nodes like a treasure map or battle plan, compass rose in the corner, top-down blueprint aesthetic

---

```
[ Player speaks ]
       ↓
[ Web Speech API → transcribed text ]
       ↓
[ Player types "!voice @Bonesy <message>" and sends ]
       ↓
[ Server detects !voice flag ]
       ↓
[ Strip !voice → send to GPT-4o-mini with NPC persona + Voice Mode prompt ]
       ↓
[ GPT returns: "[weary] Another day, another bloodstain on my floor." ]
       ↓
[ Prepend TTS_ACCENT cue → send to Gemini 2.5 Flash TTS ]
       ↓
[ Gemini returns PCM audio → wrapped in WAV → cached on server ]
       ↓
[ Client receives message + audioUrl → ▶ Play voice button appears ]
[ Player taps → audio plays ]
```

**Total latency:** ~1.8–3.3 seconds

---

## SLIDE 7 — Prompt / Input Design

**Theme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — ancient scroll unfurling dramatically, glowing golden text rising off the parchment like magic, soft light emanating from the words themselves

---

**Three layers of engineering:**

**Layer 1 — Character System Prompt**
Each NPC's personality documents (SOUL, CONTEXT, MEMORY, journal) are assembled into a structured system prompt at runtime. The model is told it *is* the character — first person, never break character.

**Layer 2 — Voice Mode Block**
When `!voice` is detected, an extra block instructs GPT to write speech-optimized output:
> *"Keep to 1-3 short sentences. Use [cues] in brackets to control tone. Example: [gruff, dismissive] Yeah, don't think so, pal."*

**Layer 3 — TTS Accent Anchoring**
Per-character accent string prepended to every TTS call:

- **Kai:** `[loud, energetic young Chinese male voice — fast-talking, impulsive, always fired up]`
- **Brynleaf:** `[thick, heavy Scottish highland brogue — rough and weathered, slow and deliberate]`

Final TTS input = `{accent cue} + {LLM response with [cues]}`

---

## SLIDE 8 — Results

**Theme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — triumphant banner hanging in a candlelit great hall, heraldic crests and shields on the walls, warm golden light, sense of achievement and celebration

---

**What was built:**
- 14 NPCs with distinct voices, accents, and personalities
- Full `!voice` pipeline: player message → NPC text → spoken audio → play button in chat
- Speech-to-text mic input in the message keyboard
- NPC memory system: journal auto-updates so NPCs recall past events

**Sample NPC voices:**
- Bonesy (undead barkeep) → Enceladus voice, gravelly delivery
- Kai (young fighter) → Alnilam voice, loud/energetic accent cue
- Kumo (blacksmith) → Umbriel voice, deep/slow Japanese accent cue
- Brynleaf (ranger) → Autonoe voice, Scottish brogue accent cue

| Setup | Character Feel |
|-------|---------------|
| No accent, no cues | Generic, flat |
| Voice only | Some variation |
| Accent cue only | Consistent register, flat emotion |
| Full system (accent + cues) | Strong character, emotional range |

---

## SLIDE 9 — Evaluation

**Theme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — ornate brass scales of justice on a stone table, one side holding glowing vials, the other a flickering candle, alchemical and precise atmosphere

---

**STT Evaluation**

| Condition | Quality |
|-----------|---------|
| Quiet room, clear speech | High — near-perfect |
| Background noise | Medium — word errors |
| D&D proper nouns | Low-medium — no domain vocab |

Latency: 200–400ms to final transcript

**TTS Evaluation**

| Metric | Observation |
|--------|-------------|
| Character consistency | High with full prompt stack |
| Emotional range | Natural — cues produce distinct deliveries |
| Realism | Clearly synthetic but expressive |
| Latency | 900–1800ms per generation |

**End-to-End Latency**

| Step | Time |
|------|------|
| GPT-4o-mini | 800–1500ms |
| Gemini TTS | 900–1800ms |
| **Total** | **1.8–3.3 seconds** |

---

## SLIDE 10 — Demo Video

**THeme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — large mystical crystal ball on a velvet-draped table, glowing softly from within, showing a faint luminous reflection, scrying and revelation atmosphere

---

**[Embed video thumbnail here]**

Demo shows:
1. Opening the NPC Speak panel in the keyboard
2. Selecting an NPC from the portrait grid
3. `!voice @NpcName` auto-inserted into the message field
4. Typing a message and sending
5. NPC text response appearing with "▶ Play voice" button
6. Tapping play — NPC speaks in character with accent

**Link:** [YOUR VIDEO URL HERE]

---

## SLIDE 11 — Limitations

**Theme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — cracked and weathered stone dungeon wall with a single dying torch mounted in an iron bracket, dim and foreboding, sense of obstacle and challenge

---

| Limitation | Impact | Possible Fix |
|-----------|--------|-------------|
| TTS latency (0.9–1.8s) | Noticeable wait | Pre-generate or stream audio |
| Browser autoplay policy | Requires tap to play | Acceptable UX tradeoff |
| STT struggles with proper nouns | NPC names often wrong | Custom vocabulary |
| Purely prompt-based accents | Approximate, not exact | Fine-tune local TTS per character |
| 5-min audio cache TTL | Link expires | Increase TTL or store permanently |
| English only | No multilingual support | Multilingual STT/TTS params |

---

## SLIDE 12 — GitHub & AI Tools

**Theme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — ancient stone tablet with deeply carved runic inscriptions glowing amber, chisel resting beside it, scholarly and archival atmosphere

---

**GitHub:** [YOUR REPO LINK]

**AI Tools Used:**

| Tool | How It Was Used |
|------|----------------|
| **Claude Code** | Primary dev assistant — backend, React components, architecture |
| **GPT-4o-mini** | Runtime NPC dialogue (part of the product) |
| **Gemini 2.5 Flash TTS** | Runtime NPC voice (part of the product) |
| **Web Speech API** | Runtime player STT (part of the product) |

**AI-assisted:** server routes, React components, writeup, slide content

**Human-designed:** concept, NPC character files, accent strings, architecture decisions

---

## SLIDE 13 — Multimodal Bonus

**Theme:**
> Dark fantasy tavern aesthetic, deep charcoal and obsidian backgrounds, aged parchment texture overlaid at low opacity, gold and amber accent lighting from candles or torches, subtle arcane rune patterns faintly glowing in corners, ink-stained wood grain texture, no text, widescreen 16:9, cinematic mood lighting, high detail — three distinct streams of glowing light in gold, amber, and pale blue converging into a single radiant point at the center, magical convergence, awe-inspiring and cosmic

---

**This project qualifies for the multimodal bonus:**

> **Voice Input → Speech-to-Text → NPC Dialogue → Text-to-Speech Voice Output**

Each modality feeds the next:
- Microphone audio → transcribed text (Google ASR)
- Text + character context → in-character dialogue with delivery cues (GPT-4o-mini)
- Dialogue + accent cue → synthesized character voice (Gemini TTS)
- WAV audio → played in mobile browser

A working, end-to-end multimodal speech pipeline in a live app used by real players.
