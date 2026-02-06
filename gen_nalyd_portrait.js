#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REF_IMAGE = path.join(__dirname, 'references', 'characters', 'nalyd.png');

const PROMPT = `PORTRAIT:
A regal character portrait of Nalyd, master monk and head of the Council of Protectors. Upper body portrait, from the waist up. He stands with quiet confidence and composure, arms crossed or one fist resting in an open palm in a martial arts salute. His expression is calm, focused, and commanding — a leader who earned his place through discipline and courage. 

Behind him, subtle elemental energy swirls — faint wisps of fire, water, wind, and earth orbiting gently, barely contained power at rest. Warm ambient lighting from within a grand stone hall or dojo interior. 

CHARACTER CONSISTENCY:
The reference image shows Nalyd — maintain his exact appearance: strong muscular build, short swept-back blonde hair, sharp clean-shaven jawline, intense golden-amber eyes, navy blue robes with intricate gold dragon embroidery, black belt/sash at the waist. Keep him visually identical to the reference.

ART STYLE:
Painterly fantasy portrait style. Rich colors, warm atmospheric lighting, textured brushwork. High-quality fantasy book illustration — like a character page in a D&D sourcebook. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish. Dignified and powerful.`;

async function main() {
  console.log('🎴 Generating Nalyd Portrait...');
  const start = Date.now();

  const refBuffer = fs.readFileSync(REF_IMAGE);
  const refFile = new File([refBuffer], 'nalyd.png', { type: 'image/png' });

  const result = await client.images.edit({
    model: 'chatgpt-image-latest',
    prompt: PROMPT,
    image: [refFile],
    size: '1024x1536',
    quality: 'high',
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const buffer = Buffer.from(result.data[0].b64_json, 'base64');
  const outPath = path.join(__dirname, 'nalyd_portrait.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB — ${outPath}`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
