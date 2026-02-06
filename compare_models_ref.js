#!/usr/bin/env node
/**
 * Compare all 4 OpenAI image models using a character reference image.
 * gpt-image-1, gpt-image-1.5, chatgpt-image-latest use the edit endpoint (reference image support).
 * dall-e-2 uses generate with detailed text description (no reference image support).
 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REF_IMAGE = path.join(__dirname, 'references', 'characters', 'tyren.png');

const SCENE_PROMPT = `Tyren Henvar, a half-elf ranger, stands at the edge of a dense misty forest at dawn. He grips his greatsword Ashril which glows with a faint frost-blue light. His black falcon Calarion circles overhead. The scene is atmospheric with shafts of golden light breaking through ancient trees. Painterly fantasy art style, rich colors, textured brushwork. Fantasy book illustration quality.`;

const CHAR_DESCRIPTION = `The reference image shows Tyren Henvar — maintain his EXACT appearance: shaved bald head, pointed half-elf ears, scar through his left eye, grey beard, dark forest-green ranger armor with layered leather plates, deep green weathered cloak, broad-shouldered imposing build. Keep him visually identical to the reference image.`;

// For dall-e-2 which can't use reference images, we embed the description in the prompt
const DALLE2_PROMPT = `A bald half-elf ranger with pointed ears, a scar through his left eye, grey beard, wearing dark forest-green layered leather armor and a deep green weathered cloak, broad-shouldered and imposing. He stands at the edge of a dense misty forest at dawn gripping a greatsword that glows with faint frost-blue light. A black falcon circles overhead. Shafts of golden light break through ancient trees. Painterly fantasy art style, rich colors, textured brushwork. Fantasy book illustration.`;

const models = [
  { id: 'dall-e-2', name: 'DALL-E 2', supportsRef: false },
  { id: 'gpt-image-1', name: 'GPT Image 1', supportsRef: true },
  { id: 'gpt-image-1.5', name: 'GPT Image 1.5', supportsRef: true },
  { id: 'chatgpt-image-latest', name: 'ChatGPT Image Latest', supportsRef: true },
];

async function generateWithRef(model) {
  console.log(`\n🎨 ${model.name} (${model.id})...`);
  const start = Date.now();

  try {
    let b64;

    if (model.supportsRef) {
      // Use edit endpoint with reference image
      const refBuffer = fs.readFileSync(REF_IMAGE);
      const refFile = new File([refBuffer], 'tyren.png', { type: 'image/png' });

      const fullPrompt = `SCENE DESCRIPTION:\n${SCENE_PROMPT}\n\nCHARACTER CONSISTENCY:\n${CHAR_DESCRIPTION}\n\nIMPORTANT: This is a scene illustration for a tabletop RPG quest. Wide composition, atmospheric and evocative.`;

      const result = await client.images.edit({
        model: model.id,
        prompt: fullPrompt,
        image: [refFile],
        size: '1536x1024',
        quality: 'medium',
      });
      b64 = result.data[0].b64_json;
    } else {
      // dall-e-2: generate without reference
      const result = await client.images.generate({
        model: model.id,
        prompt: DALLE2_PROMPT,
        size: '1024x1024', // dall-e-2 max
        n: 1,
        response_format: 'b64_json',
      });
      b64 = result.data[0].b64_json;
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const buffer = Buffer.from(b64, 'base64');
    const outPath = path.join(__dirname, `compare_ref_${model.id.replace(/[^a-z0-9-]/g, '_')}.png`);
    fs.writeFileSync(outPath, buffer);
    console.log(`  ✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB`);
    return { model, path: outPath, time: elapsed, size: buffer.length, success: true };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  ❌ Failed in ${elapsed}s — ${err.message}`);
    return { model, error: err.message, time: elapsed, success: false };
  }
}

async function main() {
  console.log('🔬 Reference Image Model Comparison');
  console.log(`📸 Reference: ${REF_IMAGE}`);
  console.log(`📝 Scene: Tyren at the forest edge at dawn with Ashril and Calarion\n`);

  const results = [];
  for (const model of models) {
    results.push(await generateWithRef(model));
  }

  console.log('\n📊 RESULTS');
  console.log('═'.repeat(60));
  for (const r of results) {
    if (r.success) {
      console.log(`${r.model.name.padEnd(28)} | ${r.time.padStart(6)}s | ${(r.size / 1024).toFixed(0).padStart(5)}KB | ✅`);
    } else {
      console.log(`${r.model.name.padEnd(28)} | ${r.time.padStart(6)}s | ❌ ${r.error.substring(0, 40)}`);
    }
  }

  fs.writeFileSync(path.join(__dirname, 'compare_ref_results.json'), JSON.stringify(results, null, 2));
  console.log('\n✅ Done!');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
