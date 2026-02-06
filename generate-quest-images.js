#!/usr/bin/env node

/**
 * Quest Image Generator
 * 
 * Generates consistent quest scene images using character reference images
 * and OpenAI's image generation API.
 * 
 * Usage:
 *   node generate-quest-images.js <character> <quest_id>           — Generate all images for a quest
 *   node generate-quest-images.js <character> <quest_id> <stage>   — Generate image for one stage
 *   node generate-quest-images.js --scene "<prompt>" --chars aly,ithrae --out scene.png  — One-off scene
 *   node generate-quest-images.js --test                           — Test API access
 * 
 * Environment:
 *   Uses OPENAI_API_KEY from .env.nibby (or specify with --env <character>)
 *   Set IMAGE_MODEL to override model (default: gpt-image-1)
 *   Set IMAGE_QUALITY to override quality (default: high)
 */

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// ============================================
// CONFIG
// ============================================

const REFERENCES_DIR = path.join(__dirname, 'references');
const CHARACTERS_DIR = path.join(REFERENCES_DIR, 'characters');
const LOCATIONS_DIR = path.join(REFERENCES_DIR, 'locations');
const STYLE_DIR = path.join(REFERENCES_DIR, 'style');

const DEFAULT_MODEL = 'chatgpt-image-latest';
const DEFAULT_QUALITY = 'high';
const DEFAULT_SIZE = '1536x1024'; // Landscape for scene images
const PORTRAIT_SIZE = '1024x1536'; // Portrait for character images

const STYLE_PROMPT = `Painterly fantasy art style. Rich colors, atmospheric lighting, textured brushwork. Looks like a high-quality fantasy book illustration or concept art. NOT photorealistic, NOT anime, NOT cartoonish. Think classic fantasy illustration with modern polish.`;

// ============================================
// HELPERS
// ============================================

function loadApiKey(envCharacter = 'nibby') {
  // Prefer dedicated image generation key if it exists
  const imagegenPath = path.join(__dirname, '.env.imagegen');
  if (fs.existsSync(imagegenPath)) {
    const content = fs.readFileSync(imagegenPath, 'utf-8');
    const match = content.match(/OPENAI_API_KEY=(.+)/);
    if (match) {
      console.log('  🔑 Using .env.imagegen key');
      return match[1].trim();
    }
  }
  
  const envPath = path.join(__dirname, `.env.${envCharacter}`);
  if (!fs.existsSync(envPath)) {
    const envFiles = fs.readdirSync(__dirname).filter(f => f.startsWith('.env.'));
    for (const f of envFiles) {
      const content = fs.readFileSync(path.join(__dirname, f), 'utf-8');
      const match = content.match(/OPENAI_API_KEY=(.+)/);
      if (match) return match[1].trim();
    }
    throw new Error('No OpenAI API key found in any .env file');
  }
  const content = fs.readFileSync(envPath, 'utf-8');
  const match = content.match(/OPENAI_API_KEY=(.+)/);
  if (!match) throw new Error(`No OPENAI_API_KEY in ${envPath}`);
  return match[1].trim();
}

function loadReferenceImage(name, subdir = 'characters') {
  const dir = path.join(REFERENCES_DIR, subdir);
  const extensions = ['.png', '.jpg', '.jpeg', '.webp'];
  
  for (const ext of extensions) {
    const filePath = path.join(dir, `${name}${ext}`);
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      const base64 = buffer.toString('base64');
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { base64, mimeType, filePath };
    }
  }
  return null;
}

function listAvailableReferences() {
  const result = { characters: [], locations: [], style: [] };
  
  for (const [key, dir] of [['characters', CHARACTERS_DIR], ['locations', LOCATIONS_DIR], ['style', STYLE_DIR]]) {
    if (fs.existsSync(dir)) {
      result[key] = fs.readdirSync(dir)
        .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .map(f => path.parse(f).name);
    }
  }
  
  return result;
}

function loadQuest(character, questId) {
  const questPath = path.join(__dirname, 'characters', character, 'quests', `${questId}.json`);
  if (!fs.existsSync(questPath)) {
    throw new Error(`Quest not found: ${questPath}`);
  }
  return JSON.parse(fs.readFileSync(questPath, 'utf-8'));
}

function getQuestImagesDir(character, questId) {
  const dir = path.join(__dirname, 'characters', character, 'quests', 'images');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// ============================================
// IMAGE GENERATION
// ============================================

async function generateSceneImage(client, {
  prompt,
  characterRefs = [],
  locationRef = null,
  styleRefs = [],
  size = DEFAULT_SIZE,
  quality = DEFAULT_QUALITY,
  model = DEFAULT_MODEL,
}) {
  // Build the input images array for the edits endpoint
  const images = [];
  
  // Add character reference images
  for (const charName of characterRefs) {
    const ref = loadReferenceImage(charName, 'characters');
    if (ref) {
      images.push({
        name: charName,
        data: ref,
      });
      console.log(`  📸 Character ref: ${charName}`);
    } else {
      console.log(`  ⚠️  No reference image for: ${charName}`);
    }
  }
  
  // Add location reference
  if (locationRef) {
    const ref = loadReferenceImage(locationRef, 'locations');
    if (ref) {
      images.push({ name: locationRef, data: ref });
      console.log(`  📸 Location ref: ${locationRef}`);
    }
  }
  
  // Add style references
  if (styleRefs.length === 0) {
    // Auto-load all style references
    const available = listAvailableReferences();
    styleRefs = available.style;
  }
  for (const styleName of styleRefs) {
    const ref = loadReferenceImage(styleName, 'style');
    if (ref) {
      images.push({ name: `style_${styleName}`, data: ref });
      console.log(`  🎨 Style ref: ${styleName}`);
    }
  }
  
  // Build the full prompt
  const charDescriptions = characterRefs.map((name, i) => 
    `Reference image ${i + 1} shows the character "${name}" - maintain their exact appearance, features, clothing, and proportions.`
  ).join('\n');
  
  const fullPrompt = [
    `SCENE DESCRIPTION:\n${prompt}`,
    '',
    `ART STYLE:\n${STYLE_PROMPT}`,
    '',
    charDescriptions ? `CHARACTER CONSISTENCY:\n${charDescriptions}\nKeep these characters visually identical to their reference images. Same face, same hair, same clothing, same build.` : '',
    '',
    'IMPORTANT: This is a scene illustration for a tabletop RPG quest. Make it atmospheric and evocative. Wide composition suitable for a scene card.',
  ].filter(Boolean).join('\n');

  if (images.length > 0) {
    // Use the edits endpoint with reference images
    // Build a File-like array for the API
    const imageFiles = images.map(img => {
      const buffer = Buffer.from(img.data.base64, 'base64');
      // Create a File-like object
      return new File([buffer], `${img.name}.png`, { type: img.data.mimeType });
    });

    console.log(`  🖼️  Generating with ${imageFiles.length} reference image(s)...`);
    
    const result = await client.images.edit({
      model,
      prompt: fullPrompt,
      image: imageFiles,
      size,
      quality,
    });
    
    return result.data[0].b64_json;
  } else {
    // No reference images, use generation endpoint
    console.log('  🖼️  Generating without references...');
    
    const result = await client.images.generate({
      model,
      prompt: fullPrompt,
      size,
      quality,
    });
    
    return result.data[0].b64_json;
  }
}

// ============================================
// QUEST IMAGE PIPELINE
// ============================================

/**
 * Analyze a quest and determine which images need generating.
 * Returns array of { stageId, actionId?, imageFile, prompt, characters }
 */
function analyzeQuestImages(quest) {
  const images = [];
  
  // Extract character names that appear in the quest
  const questChars = new Set(quest.companions || []);
  if (quest.key_npcs) {
    Object.keys(quest.key_npcs).forEach(k => questChars.add(k));
  }
  
  for (const [stageId, stage] of Object.entries(quest.stages || {})) {
    // Stage-level image
    if (stage.image) {
      images.push({
        stageId,
        actionId: null,
        imageFile: stage.image,
        prompt: stage.narration_prompt || stage.description,
        characters: [...questChars],
        isPortrait: isPortraitImage(stage.image, quest),
      });
    }
    
    // Action-level images
    if (stage.actions) {
      for (const action of stage.actions) {
        if (action.image) {
          images.push({
            stageId,
            actionId: action.id,
            imageFile: action.image,
            prompt: action.narration_prompt || stage.narration_prompt,
            characters: action.cue_npc ? [action.cue_npc] : [...questChars],
            isPortrait: isPortraitImage(action.image, quest),
          });
        }
      }
    }
  }
  
  return images;
}

/**
 * Guess if an image should be portrait (character focus) vs landscape (scene)
 */
function isPortraitImage(filename, quest) {
  const name = path.parse(filename).name.toLowerCase();
  // If the filename matches a key NPC name, it's probably a portrait
  if (quest.key_npcs && quest.key_npcs[name]) return true;
  // If it contains "avatar" or "portrait", portrait
  if (name.includes('avatar') || name.includes('portrait')) return true;
  return false;
}

async function generateQuestImages(client, character, questId, targetStage = null, options = {}) {
  const quest = loadQuest(character, questId);
  const imagesDir = getQuestImagesDir(character, questId);
  const imageSpecs = analyzeQuestImages(quest);
  
  console.log(`\n📜 Quest: ${quest.name}`);
  console.log(`📂 Output: ${imagesDir}`);
  console.log(`🖼️  ${imageSpecs.length} image(s) to generate\n`);
  
  const results = [];
  
  for (const spec of imageSpecs) {
    // Filter to specific stage if requested
    if (targetStage && spec.stageId !== targetStage) continue;
    
    const outPath = path.join(imagesDir, spec.imageFile);
    
    // Skip if already exists (unless --force)
    if (fs.existsSync(outPath) && !options.force) {
      console.log(`⏭️  Skipping ${spec.imageFile} (exists, use --force to regenerate)`);
      results.push({ file: spec.imageFile, status: 'skipped' });
      continue;
    }
    
    console.log(`\n🎨 Generating: ${spec.imageFile}`);
    console.log(`  Stage: ${spec.stageId}${spec.actionId ? ` > ${spec.actionId}` : ''}`);
    console.log(`  Characters: ${spec.characters.join(', ')}`);
    
    try {
      const b64 = await generateSceneImage(client, {
        prompt: spec.prompt,
        characterRefs: spec.characters,
        size: spec.isPortrait ? PORTRAIT_SIZE : DEFAULT_SIZE,
        model: options.model || DEFAULT_MODEL,
        quality: options.quality || DEFAULT_QUALITY,
      });
      
      const buffer = Buffer.from(b64, 'base64');
      fs.writeFileSync(outPath, buffer);
      console.log(`  ✅ Saved: ${outPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
      results.push({ file: spec.imageFile, status: 'generated', size: buffer.length });
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      results.push({ file: spec.imageFile, status: 'failed', error: err.message });
    }
  }
  
  return results;
}

// ============================================
// ONE-OFF SCENE GENERATION
// ============================================

async function generateOneOff(client, { prompt, characters, location, outFile, size, model, quality }) {
  console.log(`\n🎨 One-off scene generation`);
  console.log(`  Prompt: ${prompt.substring(0, 100)}...`);
  
  const b64 = await generateSceneImage(client, {
    prompt,
    characterRefs: characters || [],
    locationRef: location || null,
    size: size || DEFAULT_SIZE,
    model: model || DEFAULT_MODEL,
    quality: quality || DEFAULT_QUALITY,
  });
  
  const buffer = Buffer.from(b64, 'base64');
  const outputPath = outFile || path.join(__dirname, 'generated_scene.png');
  fs.writeFileSync(outputPath, buffer);
  console.log(`✅ Saved: ${outputPath} (${(buffer.length / 1024).toFixed(0)}KB)`);
  return outputPath;
}

// ============================================
// CLI
// ============================================

async function main() {
  const args = process.argv.slice(2);
  
  // Parse flags
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (key === 'force' || key === 'test' || key === 'list' || key === 'dry-run') {
        flags[key] = true;
      } else {
        flags[key] = args[++i];
      }
    } else {
      positional.push(args[i]);
    }
  }
  
  // Load API key
  const envChar = flags.env || 'nibby';
  const apiKey = loadApiKey(envChar);
  const client = new OpenAI({ apiKey });
  
  // --list: Show available references
  if (flags.list) {
    const refs = listAvailableReferences();
    console.log('\n📸 Available Reference Images:\n');
    console.log('Characters:', refs.characters.length > 0 ? refs.characters.join(', ') : '(none)');
    console.log('Locations:', refs.locations.length > 0 ? refs.locations.join(', ') : '(none)');
    console.log('Style:', refs.style.length > 0 ? refs.style.join(', ') : '(none)');
    console.log(`\nDrop images in: ${REFERENCES_DIR}`);
    return;
  }
  
  // --test: Test API access
  if (flags.test) {
    console.log('🧪 Testing image generation API access...');
    try {
      const result = await client.images.generate({
        model: flags.model || DEFAULT_MODEL,
        prompt: 'A simple red circle on a white background. Minimal test image.',
        size: '1024x1024',
        quality: 'low',
        n: 1,
      });
      const buffer = Buffer.from(result.data[0].b64_json, 'base64');
      const testPath = path.join(__dirname, 'test_image.png');
      fs.writeFileSync(testPath, buffer);
      console.log(`✅ API access works! Test image saved to ${testPath}`);
      console.log(`   Model: ${flags.model || DEFAULT_MODEL}`);
      console.log(`   Size: ${(buffer.length / 1024).toFixed(0)}KB`);
    } catch (err) {
      console.error(`❌ API access failed: ${err.message}`);
      if (err.status === 403) {
        console.error('\n🔑 Your project does not have access to this image model.');
        console.error('Go to platform.openai.com > Project Settings > Model Access and enable it.');
      }
    }
    return;
  }
  
  // --scene: One-off scene generation
  if (flags.scene) {
    const characters = flags.chars ? flags.chars.split(',') : [];
    await generateOneOff(client, {
      prompt: flags.scene,
      characters,
      location: flags.location || null,
      outFile: flags.out || null,
      size: flags.size || null,
      model: flags.model || null,
      quality: flags.quality || null,
    });
    return;
  }
  
  // Quest image generation: <character> <quest_id> [stage]
  if (positional.length >= 2) {
    const [character, questId, targetStage] = positional;
    
    // --dry-run: Just show what would be generated
    if (flags['dry-run']) {
      const quest = loadQuest(character, questId);
      const specs = analyzeQuestImages(quest);
      console.log(`\n📜 Quest: ${quest.name}`);
      console.log(`🖼️  Images to generate:\n`);
      for (const spec of specs) {
        const exists = fs.existsSync(path.join(getQuestImagesDir(character, questId), spec.imageFile));
        console.log(`  ${exists ? '✅' : '⬜'} ${spec.imageFile} (${spec.isPortrait ? 'portrait' : 'landscape'})`);
        console.log(`     Stage: ${spec.stageId}${spec.actionId ? ` > ${spec.actionId}` : ''}`);
        console.log(`     Characters: ${spec.characters.join(', ')}`);
        console.log(`     Prompt: ${spec.prompt.substring(0, 80)}...`);
        console.log();
      }
      return;
    }
    
    await generateQuestImages(client, character, questId, targetStage || null, {
      force: flags.force,
      model: flags.model,
      quality: flags.quality,
    });
    return;
  }
  
  // No valid command, show help
  console.log(`
📸 Quest Image Generator

Usage:
  node generate-quest-images.js <character> <quest_id>              Generate all images for a quest
  node generate-quest-images.js <character> <quest_id> <stage>      Generate image for one stage
  node generate-quest-images.js <character> <quest_id> --dry-run    Preview what would be generated
  node generate-quest-images.js --scene "<prompt>" --chars aly,ithrae --out scene.png
  node generate-quest-images.js --test                              Test API access
  node generate-quest-images.js --list                              List available reference images

Options:
  --force          Regenerate existing images
  --model <model>  Override model (default: ${DEFAULT_MODEL})
  --quality <q>    Override quality: low, medium, high (default: ${DEFAULT_QUALITY})
  --env <char>     Load API key from .env.<char> (default: nibby)
  --size <WxH>     Override size (default: ${DEFAULT_SIZE})

Reference images go in:
  ${CHARACTERS_DIR}/    — Character references (aly.png, ithrae.png, etc.)
  ${LOCATIONS_DIR}/     — Location references
  ${STYLE_DIR}/         — Art style references
  `);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
