#!/usr/bin/env node
/**
 * Compare all 4 OpenAI image generation models side-by-side
 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const PROMPT = `A hooded figure with a pale cracked porcelain mask and one glowing amber eye stands at the entrance of an ancient stone dungeon. Atmospheric torchlight casts dramatic shadows. Painterly fantasy art style, rich colors, textured brushwork. Fantasy book illustration quality.`;

const models = [
  { id: 'dall-e-2', name: 'DALL-E 2', size: '1024x1024', quality: 'standard', legacy: true },
  { id: 'gpt-image-1', name: 'GPT Image 1', size: '1024x1024', quality: 'medium', legacy: false },
  { id: 'gpt-image-1.5', name: 'GPT Image 1.5', size: '1024x1024', quality: 'medium', legacy: false },
  { id: 'chatgpt-image-latest', name: 'ChatGPT Image Latest', size: '1024x1024', quality: 'medium', legacy: false },
];

async function generateImage(model) {
  console.log(`\n🎨 Generating with ${model.name} (${model.id})...`);
  const start = Date.now();
  
  try {
    const params = {
      model: model.id,
      prompt: PROMPT,
      size: model.size,
      n: 1,
    };

    if (model.legacy) {
      // dall-e-2 uses response_format for b64
      params.response_format = 'b64_json';
    } else {
      // gpt-image models return b64 by default, support quality
      params.quality = model.quality;
    }

    const result = await client.images.generate(params);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    
    const b64 = result.data[0].b64_json;
    const buffer = Buffer.from(b64, 'base64');
    const outPath = path.join(__dirname, `compare_${model.id.replace(/[^a-z0-9-]/g, '_')}.png`);
    fs.writeFileSync(outPath, buffer);
    
    console.log(`  ✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB — ${outPath}`);
    return { model, path: outPath, time: elapsed, size: buffer.length, success: true };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  ❌ Failed in ${elapsed}s — ${err.message}`);
    if (err.error) console.error(`     Details: ${JSON.stringify(err.error).substring(0, 200)}`);
    return { model, error: err.message, time: elapsed, success: false };
  }
}

async function main() {
  console.log('🔬 Image Model Comparison (4 enabled models)');
  console.log(`📝 Prompt: "${PROMPT.substring(0, 80)}..."`);
  
  const results = [];
  for (const model of models) {
    const result = await generateImage(model);
    results.push(result);
  }
  
  console.log('\n\n📊 RESULTS SUMMARY');
  console.log('═'.repeat(70));
  for (const r of results) {
    if (r.success) {
      console.log(`${r.model.name.padEnd(30)} | ${r.time}s | ${(r.size / 1024).toFixed(0)}KB | ✅`);
    } else {
      console.log(`${r.model.name.padEnd(30)} | ${r.time}s | ❌ ${r.error.substring(0, 50)}`);
    }
  }
  
  fs.writeFileSync(path.join(__dirname, 'compare_results.json'), JSON.stringify(results, null, 2));
  console.log('\n✅ Done!');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
