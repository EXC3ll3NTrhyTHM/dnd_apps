# Voice-to-Text Combat Flavor System

*Let players describe their attacks using voice input with optional AI polish.*

---

## Overview

After an attack resolves, players can tap a mic button to speak a short description of their action. The system transcribes it and optionally polishes it with AI. The flavor text displays above the result card for everyone to see.

```
┌─────────────────────────────────────────────────────┐
│  1. ATTACK RESOLVES                                 │
│     Result determined (hit/miss/crit/fumble)        │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  2. MIC BUTTON APPEARS (3-4 sec window)             │
│     Skip → normal result display                    │
│     Tap → recording mode                            │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  3. RECORD (15 sec max)                             │
│     Speech-to-text transcription                    │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  4. CHOOSE: Raw or AI Polish                        │
│     Timeout → auto-send raw                         │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│  5. DISPLAY                                         │
│     Flavor text above result card (extended time)   │
│     Broadcast to all players + combat log           │
└─────────────────────────────────────────────────────┘
```

---

## Implementation

### 0. Extract Speech Recognition into Shared Hook

The speech-to-text logic already exists in `client/src/components/ChatInputCustom.jsx` (lines ~490-560).

**Create:** `client/src/hooks/useSpeechRecognition.js`

```js
// Hook should expose:
const { 
  startListening, 
  stopListening, 
  isListening, 
  transcript, 
  isSupported 
} = useSpeechRecognition();
```

- Extract the existing Web Speech API logic from ChatInputCustom
- Update `ChatInputCustom.jsx` to use the new hook
- Arena will also use this hook

---

### 1. Post-Roll Mic Button

- After an attack resolves and the result shows (hit/miss/crit/fumble), display a small mic button
- Button has a **3-4 second countdown timer** to tap
- If `isSupported` is false (browser doesn't support speech recognition), hide the mic button entirely
- If not tapped, timer expires and result broadcasts as-is (no slowdown for players who skip)
- If tapped, recording mode begins

---

### 2. Recording Mode

- Use the shared `useSpeechRecognition` hook
- **15 second timer** to speak
- Show a pulsing waveform or visual indicator while `isListening` is true
- Play a subtle audio cue when recording starts and stops
- Player releases mic or timer runs out to finish recording
- Get final text from `transcript`

---

### 3. Flavor Selection (No Keyboard)

- After recording, show two buttons only: **"Use Raw"** and **"Use AI Version"**
- **No text editing allowed** - voice only, pick one of the two options
- If timer expires without picking, **auto-send the raw transcription**
- Keep it fast and simple

---

### 4. AI Polish Endpoint

**Create:** `POST /api/encounters/polish-flavor`

**Request:**
```json
{
  "text": "I go for the throat",
  "characterName": "Tyren",
  "action": "attack",
  "outcome": "hit"
}
```

**Response:**
```json
{
  "polished": "With deadly precision, Tyren lunges forward, his blade finding its mark at the creature's exposed throat!"
}
```

**Implementation:**
- Use existing OpenAI API setup
- Model: `gpt-4o-mini` (fast and cheap)
- `max_tokens: 100`
- Fire the AI call immediately after transcription so it's ready quickly

**System prompt:**
```
You dramatize combat actions for a D&D arena battle. Take the player's short description and make it vivid and exciting in 1-2 sentences. The attack resulted in a {outcome}, so make sure your description matches that outcome (misses should describe near-misses or dodges, crits should be extra dramatic). Character name: {characterName}. Action type: {action}.
```

**Outcome values:** `"hit"`, `"miss"`, `"crit"`, `"fumble"`

---

### 5. Display Flavor Text Above Result Card

When showing the result overlay (RollResultOverlay component):

```
*"I go for the throat!"*

HIT! 18 vs AC 15 — 12 damage
```

- Check if flavor text exists
- Display it in **italics above** the main result content
- Style: italic, slightly smaller font, centered, with quotes
- **Extend display time:** If flavor text is present, add 2-3 extra seconds so players have time to read it

---

### 6. Broadcast Flavor Text

- When attack results broadcast to all players AND spectators, include the flavor text
- Show in combat log:
  ```
  **Tyren** attacks — *"I go for the throat!"* — **HIT!** 12 damage
  ```

---

### 7. Audio & Visual Feedback

- **Audio cues:** Soft sound when mic activates, different sound when recording stops
- **Visual:** Pulsing waveform or animated indicator during recording so player knows it's listening

---

## Data Flow

1. Player attacks, dice roll, result determined (hit/miss/crit/fumble)
2. Result overlay shows with mic button + 3-4 second countdown
3. No tap → broadcasts without flavor, normal display time
4. Tap → `startListening()`, 15 second timer starts with visual/audio feedback
5. Release or timeout → `stopListening()`, get `transcript`, send to `/polish-flavor` with outcome
6. Show "Use Raw" and "Use AI Version" buttons
7. Pick one or timeout (auto-sends raw)
8. Flavor text added to result, overlay displays with extended time
9. Broadcast to all players and spectators
10. Appears in combat log

---

## Files to Create

| File | Purpose |
|------|---------|
| `client/src/hooks/useSpeechRecognition.js` | Shared speech recognition hook (extracted from ChatInputCustom) |

---

## Files to Modify

| File | Changes |
|------|---------|
| `client/src/components/ChatInputCustom.jsx` | Refactor to use new shared hook |
| `client/src/components/RollResultOverlay.jsx` | Add flavor text display above result, extend display time when present |
| `client/src/pages/Arena.jsx` | Mic button, recording state, selection modal, timers |
| `client/src/styles/arena.css` | Mic button styling, recording indicator, flavor text styling |
| `server/routes/encounters.js` | Add `/polish-flavor` endpoint using OpenAI |
| Attack broadcast handlers | Include flavor text field in broadcast payload |

---

## Edge Cases

- **Browser doesn't support speech recognition:** Hide mic button entirely
- **Mic permission denied:** Hide mic button, no broken experience
- **AI call slow:** Show "Processing..." on AI button, raw option always available immediately
- **Empty transcription:** Don't show selection, just continue without flavor
- **Very long transcription:** Truncate display if needed, AI will summarize anyway

---

*Added 2026-02-28*
