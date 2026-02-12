#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REFS = ['tyren', 'nalyd'].map(name => {
  const p = path.join(__dirname, 'references', 'characters', `${name}.png`);
  return { name, buffer: fs.readFileSync(p) };
});

const PROMPT = `SCENE DESCRIPTION:
High in the crown of an ancient, massive tree, inside a hollowed-out throne room. Tyren and Nalyd kneel/sit before a giant squirrel the size of a wolfhound — King Nuttsworth the Third. The squirrel wears a crown made of polished chestnuts and copper wire, sitting regally on a throne of woven branches.

They are sharing "the sacred leaf" — passing joints and smoking together. Smoke wisps curl through the dappled forest light filtering through gaps in the canopy. Dozens of normal-sized squirrels watch from the edges like a royal court.

The atmosphere is surreal, peaceful, slightly absurd but treated with complete sincerity. A sacred stoner moment between warriors and woodland royalty.

Tyren (bald half-elf ranger with grey beard, scar through left eye, dark green ranger armor and cloak) sits cross-legged, exhaling smoke, offering a small leather satchel to the squirrel king.

Nalyd (muscular monk with short blonde hair, golden eyes, navy blue robes with gold dragon embroidery) sits beside him, relaxed, joint in hand, amused expression.

King Nuttsworth — a massive silver-grey furred squirrel with ancient knowing eyes, wearing a crown of chestnuts, holding a tiny acorn-cap pipe that's already lit.

The hollow is decorated with tiny banners, acorn shells arranged like an audience chamber, glinting trinkets in the background.

CHARACTER CONSISTENCY:
Reference image 1 shows Tyren — bald, pointed half-elf ears, scar through left eye, grey beard, dark green armor and cloak, broad-shouldered.
Reference image 2 shows Nalyd — muscular, short swept-back blonde hair, golden eyes, navy blue robes with gold dragon embroidery, clean-shaven strong jawline.
Keep both visually identical to their reference images.

ART STYLE:
Painterly fantasy art style. Warm golden-green forest lighting, textured brushstrokes like oil painting. Dappled sunlight through leaves. Rich shadows. High-quality fantasy book illustration. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish. Whimsical but grounded.`;

async function main() {
  console.log('🐿️ Generating The Sacred Leaf ceremony...');
  const start = Date.now();

  const imageFiles = REFS.map(r => new File([r.buffer], `${r.name}.png`, { type: 'image/png' }));

  const result = await client.images.edit({
    model: 'chatgpt-image-latest',
    prompt: PROMPT,
    image: imageFiles,
    size: '1536x1024',
    quality: 'high',
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const buffer = Buffer.from(result.data[0].b64_json, 'base64');
  const outPath = path.join(__dirname, 'sacred_leaf.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB — ${outPath}`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
