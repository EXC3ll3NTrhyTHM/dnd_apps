#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REFS_DIR = path.join(__dirname, 'references', 'characters');
const refs = ['nalyd', 'tyren'].map(name => {
  const p = path.join(REFS_DIR, `${name}.png`);
  if (!fs.existsSync(p)) return null;
  return new File([fs.readFileSync(p)], `${name}.png`, { type: 'image/png' });
}).filter(Boolean);

// Nibby doesn't have a reference yet so we describe him in text

const PROMPT = `SCENE:
An intense battle in a moonlit forest clearing. Four heroes fight a massive Shadow Stalker — a towering creature of pure darkness standing on two legs, twice the size of a horse, its body held together by glowing red veins, with a mouth full of white light.

Nalyd (muscular monk, short blonde hair, golden eyes, navy blue robes with gold dragon embroidery) charges forward with fists blazing with elemental fire.

Tyren (bald half-elf ranger, scar through left eye, grey beard, dark green armor and cloak) swings his glowing frost-blue greatsword Ashril at the creature.

Ximena (small but fierce woman, long black hair, scarlet red eyes, navy blue fitted gi) unleashes a torrent of flames from both hands at the beast.

Nibby (small young goblin boy in oversized clothes) stays back behind the fighters, eyes wide, ready to help.

Two smaller shadow cats with smoky black fur press against the Stalker's legs.

CHARACTERS:
Reference 1: Nalyd — maintain his exact appearance.
Reference 2: Tyren — maintain his exact appearance.
Reference 3: Ximena — maintain her exact appearance.

ART STYLE:
Painterly fantasy art. Rich colors, dramatic moonlit lighting, dynamic action composition. Fantasy book illustration quality. Epic and intense.`;

async function main() {
  console.log('⚔️ Generating Shadow Stalker battle...');
  const start = Date.now();

  const result = await client.images.edit({
    model: 'chatgpt-image-latest',
    prompt: PROMPT,
    image: refs,
    size: '1536x1024',
    quality: 'high',
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const buffer = Buffer.from(result.data[0].b64_json, 'base64');
  const outPath = path.join(__dirname, 'shadow_stalker_fight.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
