#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REF_IMAGE = path.join(__dirname, 'references', 'characters', 'nalyd.png');

const PROMPT = `SCENE DESCRIPTION:
Full body portrait of Nalyd in his Ignition form — Aspect of Will: Ignition. He has undergone a powerful super saiyan-like transformation. He is shirtless, revealing his muscular physique. His skin has glowing molten fire-like cracks and veins running across his chest, arms, and torso, like magma breaking through stone. His eyes blaze with intense golden-amber fire. A massive fiery aura engulfs his entire body, towering flames erupting around him. He stands firmly on solid ground in a wide power stance, fists clenched, screaming a battle cry of raw elemental fury. He wears dark training pants with a sash/belt at the waist. His feet and legs are fully visible, standing on top of the ground. Dark dramatic background with flames rising behind him.

COMPOSITION:
Full body shot. His entire body from head to feet must be clearly visible and not obscured by the ground or environment. He is standing ON the surface, not sinking into it.

CHARACTER CONSISTENCY:
The reference image shows Nalyd — maintain his exact facial structure, jawline, short swept-back hair, and muscular build. Same face, same person, but transformed by fire. His hair may appear to glow or have fiery highlights but keeps its shape.

ART STYLE:
Painterly fantasy art style. Rich colors, atmospheric lighting, textured brushwork. High-quality fantasy book illustration. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish. Dramatic and epic.`;

async function main() {
  console.log('🔥 Generating Nalyd Ignition Form...');
  const start = Date.now();

  const refBuffer = fs.readFileSync(REF_IMAGE);
  const refFile = new File([refBuffer], 'nalyd.png', { type: 'image/png' });

  const result = await client.images.edit({
    model: 'chatgpt-image-latest',
    prompt: PROMPT,
    image: [refFile],
    size: '1024x1536', // Portrait for character focus
    quality: 'high',
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const buffer = Buffer.from(result.data[0].b64_json, 'base64');
  const outPath = path.join(__dirname, 'nalyd_ignition.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB — ${outPath}`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
