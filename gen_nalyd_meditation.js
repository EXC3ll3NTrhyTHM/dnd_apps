#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REFS_DIR = path.join(__dirname, 'references', 'characters');
const OUT_DIR = __dirname;

function loadRef(name) {
  const p = path.join(REFS_DIR, `${name}.png`);
  return new File([fs.readFileSync(p)], `${name}.png`, { type: 'image/png' });
}

const STYLE = "Painterly fantasy art style. Rich colors, atmospheric lighting, textured brushwork. High-quality fantasy book illustration. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish.";

const scene = {
  id: "nalyd_meditation",
  filename: "nalyd_meditation.png",
  size: "1536x1024",
  refs: ["nalyd"],
  prompt: `SCENE: Early morning sunrise. A muscular man sits cross-legged on a weathered stone wall in deep meditation, eyes closed, perfectly still. Faint elemental energy radiates softly from his body. Behind him, hovering silently above the ground, a mysterious hooded woman shrouded entirely in black. Her body is wrapped in dark ninja-like garments leaving no skin visible. Her face is concealed beneath a deep hood and mask, only two piercing glowing purple eyes visible in the darkness beneath the hood. A subtle purple aura emanates from her form, wisps of violet energy drifting off her like smoke. She watches him intently from behind, ethereal and ominous. Warm golden sunrise light breaks through the trees, casting soft rays across the stone. Morning mist lingers in the air, mixing with the purple aura.

CHARACTERS:
Nalyd: muscular build, short swept-back blonde hair, golden-amber eyes (closed in meditation), strong clean-shaven jawline, midnight blue gi with gold dragon embroidery, black belt/sash. Seated in perfect stillness.
Mysterious Woman: completely covered in black wrappings and garments like a ninja, deep hood, face fully concealed, only glowing purple eyes visible, floating/hovering behind Nalyd, purple aura and violet smoke wisps surrounding her.

ART STYLE: ${STYLE} Warm sunrise atmosphere contrasting with the cold purple energy of the mysterious figure. Serene yet ominous tension.`
};

async function main() {
  console.log(`🎨 Generating: ${scene.id} (${scene.filename})...`);
  const start = Date.now();

  try {
    const imageFiles = scene.refs.map(name => loadRef(name));
    
    const result = await client.images.edit({
      model: 'chatgpt-image-latest',
      prompt: scene.prompt,
      image: imageFiles,
      size: scene.size,
      quality: 'high',
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const buffer = Buffer.from(result.data[0].b64_json, 'base64');
    const outPath = path.join(OUT_DIR, scene.filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB`);
    console.log(`📂 Saved to: ${outPath}`);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`❌ Failed in ${elapsed}s — ${err.message}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
