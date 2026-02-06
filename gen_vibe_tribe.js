#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REFS = ['bonesy', 'tyren', 'nalyd'].map(name => {
  const p = path.join(__dirname, 'references', 'characters', `${name}.png`);
  return { name, buffer: fs.readFileSync(p) };
});

const PROMPT = `SCENE DESCRIPTION:
Three friends sitting together at a wooden table in a cozy medieval tavern, sharing a relaxed evening. They are the Vibe Tribe — Bonesy, Tyren, and Nalyd — smoking hand-rolled joints together. The atmosphere is warm, hazy with smoke, candlelit, and full of camaraderie. Mugs of ale on the table. They look completely at ease, like old friends who do this every week.

Bonesy (skeleton in purple hooded cloak) sits on the left, leaning back in his chair, holding a joint between his bony fingers with his jaw open in a grin.

Tyren (bald half-elf ranger with grey beard, scar through left eye, dark green ranger armor and cloak) sits in the center, exhaling a cloud of smoke with calm stoic composure, joint resting between two fingers.

Nalyd (muscular monk with short blonde hair, golden eyes, navy blue robes with gold dragon embroidery) sits on the right, relaxed and grinning, holding a joint casually.

Smoke wisps curl through the warm tavern air. Fireplace glowing in the background. Wooden beams overhead. This is their sacred ritual — no rank, no duty, just vibes.

CHARACTER CONSISTENCY:
Reference image 1 shows Bonesy — full skeleton, purple hooded cloak, friendly demeanor.
Reference image 2 shows Tyren — bald, pointed half-elf ears, scar through left eye, grey beard, dark green armor and cloak, broad-shouldered.
Reference image 3 shows Nalyd — muscular, short swept-back blonde hair, golden eyes, navy blue robes with gold dragon embroidery, clean-shaven strong jawline.
Keep all three visually identical to their reference images.

ART STYLE:
Painterly fantasy art style. Rich warm colors, cozy tavern lighting, hazy smoke atmosphere, textured brushwork. High-quality fantasy book illustration. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish. Warm, intimate, brotherly.`;

async function main() {
  console.log('🌿 Generating The Vibe Tribe...');
  const start = Date.now();

  const imageFiles = REFS.map(r => new File([r.buffer], `${r.name}.png`, { type: 'image/png' }));

  const result = await client.images.edit({
    model: 'chatgpt-image-latest',
    prompt: PROMPT,
    image: imageFiles,
    size: '1536x1024', // Landscape for group scene
    quality: 'high',
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const buffer = Buffer.from(result.data[0].b64_json, 'base64');
  const outPath = path.join(__dirname, 'vibe_tribe.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB — ${outPath}`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
