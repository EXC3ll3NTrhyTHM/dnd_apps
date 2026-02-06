#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REFS_DIR = path.join(__dirname, 'references', 'characters');
const OUT_DIR = path.join(__dirname, 'characters', 'djinn', 'quests', 'images');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function loadRef(name) {
  const p = path.join(REFS_DIR, `${name}.png`);
  return new File([fs.readFileSync(p)], `${name}.png`, { type: 'image/png' });
}

const CHAR_CONSISTENCY = {
  kumo: "Kumo: 9 feet tall, massive sumo build, short black hair, fu manchu goatee, warm brown eyes, ancient metal hands, midnight blue gi with gold dragon embroidery stretched across enormous frame.",
  djinn: "Djinn Zenatsu: 6'5\", peak physical condition, bald head with genie-style black ponytail from the crown, sharp dark eyes, strong jawline, midnight blue gi with gold dragon embroidery and high collar, immaculate.",
  hiro: "Hiro Zenatsu: 62, gaunt elderly Japanese man, tall but stooped, sharp dark eyes identical to Djinn's, grey hair in thin topknot, deeply lined face, faded patched black martial arts gi, dark wooden walking stick.",
  nalyd: "Nalyd: muscular build, short swept-back blonde hair, golden-amber eyes, strong clean-shaven jawline, navy blue robes with gold dragon embroidery, black belt/sash."
};

const STYLE = "Painterly fantasy art style. Rich colors, atmospheric lighting, textured brushwork. High-quality fantasy book illustration. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish.";

const scenes = [
  {
    id: "arrival",
    filename: "the_arrival.png",
    size: "1536x1024",
    refs: ["kumo", "hiro"],
    prompt: `SCENE: The dojo gate at dawn. Kumo stands immovable in the gateway, arms folded across his massive chest, his nine-foot frame filling the entrance. On the other side of the gate stands Hiro Zenatsu, leaning on his dark wooden walking stick, patient and still. Morning light washes the scene in warm gold. The dojo's wooden architecture rises behind Kumo. A few students watch from a respectful distance. The tension is quiet, not hostile — a mountain and a man who will not move.

CHARACTERS:
${CHAR_CONSISTENCY.kumo}
${CHAR_CONSISTENCY.hiro}

ART STYLE: ${STYLE} Warm dawn lighting, dramatic scale contrast between the massive gatekeeper and the frail old man.`
  },
  {
    id: "djinn_training_hall",
    filename: "djinn_alone.png",
    size: "1024x1536",
    refs: ["djinn"],
    prompt: `SCENE: Djinn stands alone in the center of an empty wooden training hall. Perfect posture, hands clasped behind his back, eyes closed. Shafts of light filter through paper screen windows. The hall is serene and still, but there is visible tension in Djinn's frame — tight forearms, clenched jaw. A man holding himself together through sheer discipline. The emptiness of the hall amplifies his isolation.

CHARACTERS:
${CHAR_CONSISTENCY.djinn}

ART STYLE: ${STYLE} Quiet, intimate, tense. The stillness should feel heavy, not peaceful.`
  },
  {
    id: "hiro_kata",
    filename: "hiro_kata.png",
    size: "1536x1024",
    refs: ["hiro"],
    prompt: `SCENE: Before dawn, outside the dojo gate. Hiro Zenatsu performs an ancient martial arts kata in the dirt beside his small camp — a thin bedroll and a clay teapot. Despite his frailty and illness, his forms are extraordinary — fluid, precise, beautiful. Ancient movements that predate modern martial arts by centuries. His faded black gi moves with him. First light is just beginning to break on the horizon, painting the sky in deep purple and gold. A small camp fire's embers glow nearby. It is a lonely, beautiful image — an old master practicing forms that will die with him.

CHARACTERS:
${CHAR_CONSISTENCY.hiro}

ART STYLE: ${STYLE} Pre-dawn atmosphere, melancholy beauty, sense of something ancient and fading.`
  },
  {
    id: "the_meeting",
    filename: "the_open_gate.png",
    size: "1536x1024",
    refs: ["djinn", "hiro"],
    prompt: `SCENE: The dojo courtyard at night under moonlight. Djinn and Hiro stand face to face, three paces apart. Father and son seeing each other for the first time in twelve years. Djinn is rigid, controlled, but his mask is cracking. Hiro looks up at his son with an expression of quiet awe and deep sadness — his boy grew into a man he barely recognizes. Silver moonlight bathes the courtyard in pale blue. The dojo buildings frame the scene. They are alone. The gate stands open behind Hiro.

CHARACTERS:
${CHAR_CONSISTENCY.djinn}
${CHAR_CONSISTENCY.hiro}

ART STYLE: ${STYLE} Moonlit, emotionally charged, cinematic. The space between them should feel like an ocean.`
  },
  {
    id: "the_kata_together",
    filename: "kata_together.png",
    size: "1536x1024",
    refs: ["djinn", "hiro"],
    prompt: `SCENE: Sunrise in the dojo courtyard. Djinn and Hiro move through an ancient kata together, mirroring each other perfectly. Father and son, side by side, performing the same forms — Hiro's movements slower and more weathered, Djinn's powerful and precise, but the forms are identical. Golden sunrise light washes over them. It is the most beautiful and heartbreaking image — a martial lineage being passed from dying father to living son. Students watch silently from the walls in the background.

CHARACTERS:
${CHAR_CONSISTENCY.djinn}
${CHAR_CONSISTENCY.hiro}

ART STYLE: ${STYLE} Golden sunrise, deeply emotional, beautiful. This is the heart of the quest.`
  },
  {
    id: "kumo_watching",
    filename: "kumo_watching.png",
    size: "1024x1536",
    refs: ["kumo"],
    prompt: `SCENE: Kumo the gatekeeper stands at his post, watching the courtyard where Djinn and Hiro train together in the distance (seen small, blurred in the background). The massive sumo master's expression is unreadable at first glance, but there is moisture in his eyes. One enormous metal hand is raised near his face, as if he just wiped something away. The morning light catches the fine craftsmanship of his ancient metal fingers. A deeply personal moment for a man who never talks about his own past, watching someone else face theirs.

CHARACTERS:
${CHAR_CONSISTENCY.kumo}

ART STYLE: ${STYLE} Intimate character moment, warm morning light, emotional depth. Focus on Kumo's expression and the metal hand near his face.`
  }
];

async function generateScene(scene) {
  console.log(`\n🎨 Generating: ${scene.id} (${scene.filename})...`);
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
    console.log(`  ✅ Done in ${elapsed}s — ${(buffer.length / 1024).toFixed(0)}KB`);
    return { id: scene.id, path: outPath, success: true, time: elapsed };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  ❌ Failed in ${elapsed}s — ${err.message}`);
    return { id: scene.id, success: false, error: err.message, time: elapsed };
  }
}

async function main() {
  console.log('🎬 Generating quest images for "The Man at the Gate"');
  console.log(`📂 Output: ${OUT_DIR}`);
  console.log(`🖼️  ${scenes.length} images to generate\n`);

  const results = [];
  for (const scene of scenes) {
    results.push(await generateScene(scene));
  }

  console.log('\n\n📊 RESULTS');
  console.log('═'.repeat(50));
  for (const r of results) {
    console.log(`${r.id.padEnd(25)} | ${r.success ? '✅' : '❌'} | ${r.time}s`);
  }
  console.log('\n✅ Done!');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
