#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const OUT_DIR = path.join(__dirname, 'references', 'characters');
const STYLE = "Painterly fantasy portrait style. Rich warm colors, atmospheric lighting, textured brushwork. High-quality fantasy book illustration — like a character page in a D&D sourcebook. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish.";

const portraits = [
  {
    name: "djinn",
    prompt: `PORTRAIT:
A clean character reference portrait of Master Djinn Zenatsu, Head of the Dojo of Four Elements. Upper body portrait, waist up. A commanding presence of quiet authority. 6'5", peak physical condition, every muscle defined through discipline. Bald head with a genie-style black ponytail emerging from the crown — his signature look. Strong jawline, sharp dark eyes that miss nothing. Hands clasped behind his back. Expression: calm, measured authority with a hint of quiet charisma. He wears a midnight blue gi with gold dragon embroidery, high collar style, immaculate. No jewelry, no ornamentation beyond the gi. Simple warm dojo interior background.

ART STYLE: ${STYLE} Dignified, commanding, composed.`
  },
  {
    name: "kumo",
    prompt: `PORTRAIT:
A clean character reference portrait of Kumo, the Sumo Master and Gatekeeper of the Dojo. Upper body portrait, waist up. An absolute mountain of a man. 9 feet tall, massive sumo build, wider than most doorways. Short black hair neatly kept, with a fu manchu goatee framing his broad jaw. Warm brown eyes that can shift from kind to terrifying. Ancient metal hands — they look normal from a distance but up close show fine seams and subtle joint articulation, the same skin tone as his body. He wears a midnight blue gi with gold dragon embroidery, reinforced and stretched across his enormous frame. Arms folded across his chest. Expression: steady, watchful, gentle giant energy. Simple dojo gate background.

ART STYLE: ${STYLE} Warm, imposing but approachable, massive scale.`
  }
];

async function generatePortrait(p) {
  console.log(`\n🎴 Generating ${p.name} portrait...`);
  const start = Date.now();
  
  const result = await client.images.generate({
    model: 'chatgpt-image-latest',
    prompt: p.prompt,
    size: '1024x1536',
    quality: 'high',
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const buffer = Buffer.from(result.data[0].b64_json, 'base64');
  const outPath = path.join(OUT_DIR, `${p.name}.png`);
  fs.writeFileSync(outPath, buffer);
  console.log(`  ✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB`);
}

async function main() {
  for (const p of portraits) {
    await generatePortrait(p);
  }
  console.log('\n✅ All portraits done!');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
