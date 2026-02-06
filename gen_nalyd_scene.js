#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REF_IMAGE = path.join(__dirname, 'references', 'characters', 'nalyd.png');

const PROMPT = `SCENE DESCRIPTION:
Nalyd, master monk and head of the Council of Protectors, standing in the center of his Dojo of the Four Elements during a training demonstration. He holds a focused martial arts stance, one hand extended forward channeling swirling fire, the other pulled back channeling spiraling water. The four elements swirl around him — wisps of fire, arcs of water, gusts of wind, and floating shards of earth — orbiting his body in a controlled elemental display. Young students watch in awe from the edges of the dojo. Warm golden light filters through paper screen windows. Incense smoke drifts through the air.

COMPOSITION:
Full body, centered. Nalyd is the focal point with the elemental display surrounding him. The dojo environment frames the scene. His feet are firmly planted on the wooden dojo floor.

CHARACTER CONSISTENCY:
The reference image shows Nalyd — maintain his exact appearance: strong muscular build, short swept-back blonde hair, sharp jawline, intense golden eyes, navy blue robes with gold dragon embroidery, black belt/sash. Keep him visually identical to the reference.

ART STYLE:
Painterly fantasy art style. Rich warm colors, atmospheric lighting, textured brushwork. High-quality fantasy book illustration. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish. Powerful yet serene.`;

async function main() {
  console.log('🥋 Generating Nalyd — Dojo of the Four Elements...');
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
  const outPath = path.join(__dirname, 'nalyd_dojo.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB — ${outPath}`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
