const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CACHE_DIR = path.resolve(__dirname, '..', '..', 'data', 'tts_cache');
const CACHE_TTL_MS = 5 * 60 * 1000;

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function loadNpcTtsConfig(npcName) {
  const envFile = path.join(ROOT, `.env.${npcName}`);
  if (!fs.existsSync(envFile)) return {};
  const config = {};
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    config[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return config;
}

function createWavBuffer(pcmBuffer) {
  const numChannels = 1;
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buf, 44);
  return buf;
}

async function generateTTS(text, npcName) {
  const config = loadNpcTtsConfig(npcName);
  const apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error(`No GEMINI_API_KEY for NPC: ${npcName}`);

  const voiceName = config.TTS_VOICE || 'Enceladus';
  const accentCue = config.TTS_ACCENT || '';
  const ttsInput = accentCue ? `${accentCue} ${text}` : text;

  const gemini = new GoogleGenAI({ apiKey });
  const response = await gemini.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: ttsInput }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName } },
      },
    },
  });

  const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) throw new Error('No audio data in TTS response');

  return createWavBuffer(Buffer.from(data, 'base64'));
}

async function generateAndCacheTTS(text, npcName) {
  const wavBuffer = await generateTTS(text, npcName);
  const filename = `${crypto.randomUUID()}.wav`;
  const filePath = path.join(CACHE_DIR, filename);
  fs.writeFileSync(filePath, wavBuffer);
  setTimeout(() => { try { fs.unlinkSync(filePath); } catch {} }, CACHE_TTL_MS);
  return `/api/voice/cache/${filename}`;
}

module.exports = { generateTTS, generateAndCacheTTS, CACHE_DIR };
