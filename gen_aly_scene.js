#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REF_IMAGE = path.join(__dirname, 'references', 'characters', 'aly.png');

const PROMPT = `SCENE DESCRIPTION:
Aly, the Royal Archeress of the Velzari and the Watcher of Okhan, perched silently on the edge of a medieval rooftop at night. She is crouched in a graceful, predatory stance, one knee down, surveying the moonlit city below. Her legendary bone-crafted bow crackles with blue storm energy in her hand. A faint blue arcane glow traces the markings on her skin. Wind catches her long dark hair and her deep green cloak billows behind her. The medieval city of Okhan stretches out beneath her under a starlit sky with a crescent moon. She is the silent guardian, unseen but ever-present.

COMPOSITION:
Full body, dramatic low angle looking up at her on the rooftop edge. She is fully visible against the night sky. Cinematic framing.

CHARACTER CONSISTENCY:
The reference image shows Aly — maintain her exact appearance: elven features with pointed ears, long dark brown hair with braids, warm brown skin, dark teal/green outfit, gold tiara with blue gem, blue arcane markings on her skin, gold bracers and belt, tall leather boots. Her bone bow crackles with blue lightning energy. Keep her visually identical to the reference.

ART STYLE:
Painterly fantasy art style. Rich colors, atmospheric moonlit lighting, textured brushwork. High-quality fantasy book illustration. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish. Moody, atmospheric, powerful.`;

async function main() {
  console.log('🏹 Generating Aly — Watcher of Okhan...');
  const start = Date.now();

  const refBuffer = fs.readFileSync(REF_IMAGE);
  const refFile = new File([refBuffer], 'aly.png', { type: 'image/png' });

  const result = await client.images.edit({
    model: 'chatgpt-image-latest',
    prompt: PROMPT,
    image: [refFile],
    size: '1024x1536',
    quality: 'high',
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const buffer = Buffer.from(result.data[0].b64_json, 'base64');
  const outPath = path.join(__dirname, 'aly_watcher.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB — ${outPath}`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
