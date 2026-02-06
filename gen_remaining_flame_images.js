#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REFS_DIR = path.join(__dirname, 'characters', 'ximena', 'quests', 'references');
const OUT_DIR = path.join(__dirname, 'characters', 'ximena', 'quests', 'images');

function loadRef(name) {
  const p = path.join(REFS_DIR, `${name}.png`);
  return new File([fs.readFileSync(p)], `${name}.png`, { type: 'image/png' });
}

const CHAR = {
  ximena: "Ximena Reyes: 5'3\", petite but fierce, long flowing black hair, glowing scarlet red eyes, sly confident smirk, navy blue cropped wrap-style kimono top with gold dragon embroidery showing midriff, wide-brimmed conical hat with gold flame ornament, fire elemental master.",
  nalyd: "Nalyd: muscular build, short swept-back golden-blonde hair, golden-amber eyes, strong clean-shaven jawline, navy blue robes with gold dragon embroidery, black belt/sash, forearm wraps.",
};

const DOJO_INTERIOR = "Traditional East Asian martial arts training hall with heavy timber post-and-beam architecture, dragon-carved pillars, packed-earth floor with chalked sparring circle, navy banners with gold dragons hanging from rafters, weapon racks along walls, warm amber lighting.";
const STYLE = "Painterly fantasy art style. Rich colors, atmospheric lighting, textured brushwork. High-quality fantasy book illustration. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish. Semi-realistic with Eastern fantasy influence.";

const scenes = [
  {
    id: "the_trial",
    filename: "the_trial.png",
    size: "1024x1536",
    refs: ["ximena"],
    prompt: `SCENE: INSIDE an ancient volcanic crucible. Abstract, dreamlike, surreal. Ximena floats at the center of a massive vortex of fire. Around her, fragmented translucent visions of her past swirl like ghostly memories dissolving in flame: a smaller martial arts school, a younger version of herself, silhouettes of students. The fire is BOTH destructive orange-red AND calm golden-white, two sides of her nature spiraling together. Ximena is at the center, no hat, hair wild and flowing in the heat vortex, expression raw and searching, hands open at her sides in surrender. Ethereal and beautiful.

CHARACTERS:
${CHAR.ximena} But stripped of the performance — no hat, hair wild and flowing, expression raw and vulnerable. Open hands, not fists.

ART STYLE: ${STYLE} Surreal, dreamlike, ethereal. Translucent memories dissolving in flame. Rich warm palette with cool golden-white tones. The most BEAUTIFUL image of the quest.`
  },
  {
    id: "emergence",
    filename: "emergence.png",
    size: "1536x1024",
    refs: ["ximena"],
    prompt: `SCENE: Ximena walks OUT of a massive volcanic cave entrance, viewed from the front. The enormous glowing cave mouth is behind her, backlighting her in deep orange and red. The fire around her body is DIFFERENT now — steady, controlled, a warm golden glow. Clean, even, purposeful. Not wild or chaotic. Her hat is back on. Posture upright, confident. A real genuine smile, not the cocky smirk. She walks with the steadiness of someone who faced themselves and came out stronger. In the far background beyond the cave, four small figures wait. Dawn light mixes with volcanic glow. The hero shot.

CHARACTERS:
${CHAR.ximena} But transformed — same clothes, same look, but fire is steady and controlled. Expression is genuine confidence, a real smile.

ART STYLE: ${STYLE} Triumphant emergence. Dramatic backlighting from the cave. Controlled golden glow vs wild red fire behind. Hero shot energy.`
  },
  {
    id: "the_rematch",
    filename: "the_rematch.png",
    size: "1536x1024",
    refs: ["nalyd", "ximena", "dojo_training_hall"],
    prompt: `SCENE: The dojo training hall. ${DOJO_INTERIOR} Nalyd and Ximena spar in the center of the sparring circle. Ximena is in BURST IGNITION — her body blazes with intense controlled fire, eyes glowing bright scarlet, mid-strike with a flaming fist. The flames are CONTROLLED — tight, focused, purposeful. Nalyd is fully engaged, blocking, actually pushed. His expression shows respect and effort. Around the edges, dojo students in navy blue gis watch in awe. Dynamic action, both mid-exchange. Two fire users at the peak of their rivalry.

CHARACTERS:
${CHAR.nalyd}
${CHAR.ximena} In burst Ignition — flames blazing intensely around whole body, eyes glowing bright red, incredible speed. Fire is CONTROLLED and focused.

ART STYLE: ${STYLE} Peak martial arts action. Two masters mid-exchange. Fire everywhere but purposeful. Climax of a martial arts epic.`
  }
];

async function generateScene(scene) {
  console.log(`\n🎨 Generating: ${scene.id} (${scene.filename})...`);
  const start = Date.now();
  try {
    const imageFiles = scene.refs.map(name => loadRef(name));
    const result = await client.images.edit({
      model: 'gpt-image-1',
      prompt: scene.prompt,
      image: imageFiles,
      size: scene.size,
      quality: 'high',
    });
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const buffer = Buffer.from(result.data[0].b64_json, 'base64');
    const outPath = path.join(OUT_DIR, scene.filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`  ✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB`);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  ❌ Failed in ${elapsed}s — ${err.message}`);
  }
}

async function main() {
  console.log('🎨 Generating remaining 3 images...\n');
  for (const scene of scenes) {
    await generateScene(scene);
  }
  console.log('\n✅ All done!');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
