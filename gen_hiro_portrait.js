#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const PROMPT = `PORTRAIT:
A warm, dignified character reference portrait of Hiro Zenatsu, an elderly martial arts master nearing the end of his life. Upper body portrait, from the waist up. He is a gaunt, weathered Japanese man of 62. He was clearly powerful once — tall but stooped now, as if the years caught up all at once. Sharp dark eyes set deep in a deeply lined face, identical to his son Djinn's eyes. Grey hair pulled back in a thin topknot. He wears a faded black martial arts gi with no embroidery, patched and re-patched over decades. His hands are calloused and scarred from a lifetime of training. He holds a dark wooden walking stick, worn smooth from years of use. There is a quiet dignity to him even in his frailty. He is NOT holding anything else. Simple warm background.

CHARACTER DETAILS:
Gaunt elderly Japanese man. Tall but stooped. Sharp dark piercing eyes. Grey thinning hair in a topknot. Deeply lined weathered face with a strong jawline. Faded patched black martial arts gi. Calloused scarred hands. Dark wooden walking stick. Expression: quiet dignity, patience, and deep sadness held in check.

ART STYLE:
Painterly fantasy portrait style. Rich warm colors, soft atmospheric lighting, textured brushwork. High-quality fantasy book illustration — like a character page in a D&D sourcebook. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish. Dignified and bittersweet.`;

async function main() {
  console.log('🎴 Generating Hiro Zenatsu Portrait...');
  const start = Date.now();

  const result = await client.images.generate({
    model: 'chatgpt-image-latest',
    prompt: PROMPT,
    size: '1024x1536',
    quality: 'high',
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const buffer = Buffer.from(result.data[0].b64_json, 'base64');
  const outPath = path.join(__dirname, 'references', 'characters', 'hiro.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB — ${outPath}`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
