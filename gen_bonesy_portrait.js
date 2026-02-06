#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REF_IMAGE = path.join(__dirname, 'references', 'characters', 'bonesy.png');

const PROMPT = `PORTRAIT:
A warm, friendly character reference portrait of Bonesy, a lovable undead skeleton bard. Upper body portrait, from the waist up. He is a full skeleton — bare bone, no flesh, no skin. He wears a weathered purple hooded cloak draped over his shoulders with the hood up. His skull is tilted slightly to one side with his jaw open in a wide cheerful grin, as if he just told a joke. His posture is relaxed and inviting, NOT menacing or scary. He is NOT holding anything. No props, no objects. Just him.

Warm golden background glow, like firelight from a nearby hearth. Bright, inviting lighting that makes him look approachable and charming, not dark or sinister.

CHARACTER CONSISTENCY:
The reference image shows Bonesy — maintain his exact appearance: full skeleton with aged yellowed bone, purple hooded cloak, empty dark eye sockets. He should look FRIENDLY and ENDEARING, like everyone's favorite drinking buddy who happens to be a skeleton. NOT scary, NOT grim reaper, NOT menacing.

ART STYLE:
Painterly fantasy portrait style. Warm bright colors, cozy golden lighting, textured brushwork. High-quality fantasy book illustration — like a character page in a D&D sourcebook. NOT photorealistic, NOT anime, NOT horror. Classic fantasy illustration with modern polish. Charming, warm, lovable.`;

async function main() {
  console.log('💀 Generating Bonesy Portrait...');
  const start = Date.now();

  const refBuffer = fs.readFileSync(REF_IMAGE);
  const refFile = new File([refBuffer], 'bonesy.png', { type: 'image/png' });

  const result = await client.images.edit({
    model: 'chatgpt-image-latest',
    prompt: PROMPT,
    image: [refFile],
    size: '1024x1536',
    quality: 'high',
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const buffer = Buffer.from(result.data[0].b64_json, 'base64');
  const outPath = path.join(__dirname, 'bonesy_portrait.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB — ${outPath}`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
