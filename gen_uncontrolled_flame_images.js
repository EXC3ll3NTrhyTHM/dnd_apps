#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const envContent = fs.readFileSync(path.join(__dirname, '.env.imagegen'), 'utf-8');
const apiKey = envContent.match(/OPENAI_API_KEY=(.+)/)[1].trim();
const client = new OpenAI({ apiKey });

const REFS_DIR = path.join(__dirname, 'characters', 'ximena', 'quests', 'references');
const OUT_DIR = path.join(__dirname, 'characters', 'ximena', 'quests', 'images');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function loadRef(name) {
  const p = path.join(REFS_DIR, `${name}.png`);
  return new File([fs.readFileSync(p)], `${name}.png`, { type: 'image/png' });
}

const CHAR = {
  ximena: "Ximena Reyes: 5'3\", petite but fierce, long flowing black hair, glowing scarlet red eyes, sly confident smirk, navy blue cropped wrap-style kimono top with gold dragon embroidery showing midriff, wide-brimmed conical hat with gold flame ornament, fire elemental master.",
  nalyd: "Nalyd: muscular build, short swept-back golden-blonde hair, golden-amber eyes, strong clean-shaven jawline, navy blue robes with gold dragon embroidery, black belt/sash, forearm wraps.",
  djinn: "Djinn Zenatsu: 6'5\", peak physical condition, bald head with genie-style black ponytail from the crown, sharp dark eyes, strong jawline, midnight blue gi with gold dragon embroidery and high collar.",
  kai: "Kai Xi Yang: muscular young man, sleeveless dark blue martial arts tunic with gold dragon emblem, wide conical hat with ocean wave motifs and silver crescent ornament, water elemental.",
  mai: "Mai Xi Yang: slender young woman, long black hair, deep blue robe with gold dragon embroidery, ornate wide-brimmed hat with silver cloud motifs and horn-like ornaments, wind elemental, sword at side.",
  edgar: "Doc Edgar: massively built, dark skin with stone-like cracked texture across body, open dark blue-gray gi with gold dragon embroidery, wide conical hat made of rock, earth elemental.",
  kumo: "Kumo: 9 feet tall, massive sumo build, short black hair, pointed goatee, warm brown eyes, navy blue kimono with gold dragon embroidery, steel-plated gauntlets."
};

const DOJO_INTERIOR = "Traditional East Asian martial arts training hall with heavy timber post-and-beam architecture, dragon-carved pillars, packed-earth floor with chalked sparring circle, navy banners with gold dragons hanging from rafters, weapon racks along walls, warm amber lighting.";
const DOJO_EXTERIOR = "Fortified East Asian courtyard with grand wooden gate flanked by golden dragon pillars, curved-roof pavilions, watchtower, stone-paved arena, fire pit, small waterfall, dramatic mountain backdrop.";

const STYLE = "Painterly fantasy art style. Rich colors, atmospheric lighting, textured brushwork. High-quality fantasy book illustration. NOT photorealistic, NOT anime. Classic fantasy illustration with modern polish. Semi-realistic with Eastern fantasy influence.";

const scenes = [
  {
    id: "the_surge",
    filename: "the_surge.png",
    size: "1536x1024",
    refs: ["ximena", "dojo_training_hall"],
    prompt: `SCENE: Inside the dojo training hall. ${DOJO_INTERIOR} Ximena stands in the center of the sparring circle, flames erupting WILDLY and chaotically around her during a training drill. The fire is wrong — uneven, too bright, unstable, flickering in random directions. Two students in navy blue gis recoil and stumble backward. Fresh black scorch marks scar the packed-earth floor. Ximena's expression is outwardly confident, a cocky smirk, but her hands are visibly trembling. Smoke curls toward the rafters.

CHARACTERS:
${CHAR.ximena}

ART STYLE: ${STYLE} Dramatic warm lighting from the wild flames contrasting the amber dojo light. The fire should look WRONG — chaotic, uncontrolled, not the elegant flames of a master.`
  },
  {
    id: "alone_with_fire",
    filename: "alone_with_fire.png",
    size: "1024x1536",
    refs: ["ximena"],
    prompt: `SCENE: Ximena's darkened quarters at night. A small spartan room in the dojo. She sits on the floor in the dark, legs crossed, staring at her own hands. Faint orange firelight glows from beneath her skin and between her fingers — her body is radiating heat involuntarily. Behind her, the bedding shows fresh scorch marks and burn holes. The stone floor beneath her mat is cracked from heat. Her conical hat is set aside. Her long black hair falls loose around her face. Her expression is vulnerable, scared, trying to hold it together. No audience. No bravado. The private moment no one else sees. A single candle in the corner casts long shadows.

CHARACTERS:
${CHAR.ximena} But here she is stripped of the performance — no hat, no smirk. Vulnerable, small, afraid. Hair down, expression raw.

ART STYLE: ${STYLE} Dark, intimate, deeply personal. Firelight from her own body is the primary light source. Heavy shadows. This should feel like catching someone in their most private moment.`
  },
  {
    id: "the_confrontation",
    filename: "the_confrontation.png",
    size: "1536x1024",
    refs: ["nalyd", "ximena"],
    prompt: `SCENE: A private training ground behind the dojo. Open air, stone floor, wooden fencing around the perimeter. Nalyd stands calm and grounded on the left, hands at his sides, expression serious but patient. Ximena stands across from him on the right, arms crossed, jaw tight. Faint flames lick involuntarily off her shoulders and forearms — she can't stop them. The heat coming off her warps the air between them. The tension is palpable: a master at peace with his fire facing a prodigy losing control of hers. Mountain backdrop, overcast sky.

CHARACTERS:
${CHAR.nalyd}
${CHAR.ximena}

ART STYLE: ${STYLE} Dramatic tension between two figures. Heat haze effect between them. Nalyd is stillness; Ximena is barely contained chaos.`
  },
  {
    id: "the_eruption",
    filename: "the_eruption.png",
    size: "1536x1024",
    refs: ["ximena", "kai", "mai", "edgar", "djinn", "dojo_training_hall"],
    prompt: `SCENE: CHAOS in the dojo training hall. ${DOJO_INTERIOR} A massive column of wild uncontrolled fire ERUPTS from Ximena at the center of the hall, blasting upward toward the rafters. Kai is being thrown backward through the air by the shockwave, water scattering from his hands. Mai stands firm with arms extended, a visible swirling wall of wind forming a barrier to protect students behind her. Edgar slams his palms downward as earth walls RISE from the packed floor to contain the blast. Djinn is at the side, directing with sharp hand gestures. Smoke, sparks, scorched stone. The navy banners are singed. This is the "oh shit" moment — raw elemental catastrophe.

CHARACTERS:
${CHAR.ximena}
${CHAR.kai}
${CHAR.mai}
${CHAR.edgar}
${CHAR.djinn}

ART STYLE: ${STYLE} Maximum drama. Explosive action shot. Wild orange fire vs blue water vs white wind vs brown earth. Chaos contained by teamwork.`
  },
  {
    id: "on_her_knees",
    filename: "on_her_knees.png",
    size: "1536x1024",
    refs: ["ximena", "dojo_training_hall"],
    prompt: `SCENE: The aftermath. Inside the dojo training hall. ${DOJO_INTERIOR} Ximena kneels in the exact center of a PERFECT scorched black circle burned into the packed-earth floor. Smoke still rises around her in thin wisps. Her hat has fallen off, her long black hair hangs loose and disheveled. She's breathing hard, hands on the ground, expression raw — exhaustion, shock, fear. The scorched circle is maybe 15 feet in diameter, the floor blackened and cracked within it. Beyond the circle's edge, the other fighters watch from a respectful distance, small figures at the edges of the frame. The contrast between the destruction and how SMALL Ximena looks kneeling in its center.

CHARACTERS:
${CHAR.ximena} But here she is broken — no hat, hair loose, on her knees, afraid. The mask is gone.

ART STYLE: ${STYLE} Quiet after the storm. Heavy, somber. Smoke and settling dust. The focus is Ximena small in the center of devastation she caused.`
  },
  {
    id: "the_journey",
    filename: "the_journey.png",
    size: "1536x1024",
    refs: ["djinn", "kai", "ximena", "mai", "edgar"],
    prompt: `SCENE: Five figures traveling through increasingly volcanic terrain. The landscape transitions from sparse green scrubland on the left to dark volcanic rock and steaming vents on the right. Djinn leads in front, walking with purpose. Kai and Ximena walk side by side in the middle — Kai close to her protectively. Ximena is visibly weakened, slightly hunched, faint erratic orange flames flickering off her body involuntarily. Mai walks behind, scanning the horizon, wind subtly flowing around her. Edgar brings up the rear like a walking fortress, steady and immovable. The sky is overcast, tinged orange near the volcanic horizon. Brotherhood on the road to save their friend.

CHARACTERS:
${CHAR.djinn}
${CHAR.kai}
${CHAR.ximena} But weakened — hunched posture, flames flickering erratically, feverish.
${CHAR.mai}
${CHAR.edgar}

ART STYLE: ${STYLE} Epic journey shot. Wide landscape composition. The group small against a big dangerous world. Warm volcanic tones bleeding into the cool overcast sky.`
  },
  {
    id: "containment",
    filename: "containment.png",
    size: "1536x1024",
    refs: ["kai", "mai", "edgar", "ximena"],
    prompt: `SCENE: On the volcanic road. Ximena is having an uncontrolled surge — wild fire erupts from her body. But her teammates are containing it. Kai stands with arms extended, streams of water swirling from his hands and wrapping around the eruption. Mai channels wind in a tight spiral, her robes and hair whipping, creating a visible funnel of air that contains the fire alongside the water. Edgar kneels with palms on the ground, earth rising in a curved wall beneath Ximena to ground the excess energy. Ximena is in the center, engulfed in her own fire, eyes wide. Three elements working together to contain the fourth. Water + wind + earth protecting fire from itself.

CHARACTERS:
${CHAR.kai}
${CHAR.mai}
${CHAR.edgar}
${CHAR.ximena}

ART STYLE: ${STYLE} Dynamic elemental action. Blue water streams, white wind spirals, brown earth walls, wild orange fire at center. Four elements interacting visually. Dramatic and beautiful.`
  },
  {
    id: "entering_the_crucible",
    filename: "entering_the_crucible.png",
    size: "1536x1024",
    refs: ["ximena"],
    prompt: `SCENE: A massive volcanic cave entrance in a dark mountainside. The cave mouth is enormous — 40 feet tall — and glows from deep within with primal, ancient firelight in deep oranges and reds. Heat shimmers distort the air around the entrance. Volcanic rock frames the opening, veined with faintly glowing orange cracks like magma beneath the surface. Ximena walks alone toward the entrance, her figure small against the massive opening. She is viewed from behind, walking forward with determination, not looking back. Far behind her in the distance, four small figures (her teammates) watch from a safe distance. Steam and embers drift from the cave mouth. The moment she steps away from everything she knows.

CHARACTERS:
${CHAR.ximena} Seen from behind, walking into the cave. Small against the massive entrance.

ART STYLE: ${STYLE} Awe-inspiring scale. Tiny figure against a massive glowing cave entrance. The light from within should feel ancient and alive. Epic, lonely, courageous.`
  },
  {
    id: "the_trial",
    filename: "the_trial.png",
    size: "1024x1536",
    refs: ["ximena"],
    prompt: `SCENE: INSIDE the crucible. Abstract, dreamlike, surreal. Ximena floats or stands at the center of a vortex of fire. Around her, fragmented translucent visions of her past: a ghostly image of a smaller martial arts school (her old school she left behind), a younger version of herself training alone, a fragmented vision of Nalyd mid-combat (the standstill), ghostly silhouettes of students she pushed too hard. The fire swirls around her in a massive spiral vortex — but it is BOTH destructive orange-red fire AND calm golden-white flame, representing the two sides of her nature. Ximena is at the center, stripped of her hat and bravado, hair wild, expression raw and honest, hands open at her sides in surrender. The most visually striking and ethereal image of the quest.

CHARACTERS:
${CHAR.ximena} But stripped of the performance — no hat, hair wild and flowing in the heat vortex, expression raw and searching. Open hands, not fists.

ART STYLE: ${STYLE} Surreal, dreamlike, ethereal. The visions should feel like translucent memories dissolving in flame. Rich warm palette but with some cool golden-white tones in the calmer flames. This should be the most BEAUTIFUL image of the quest.`
  },
  {
    id: "emergence",
    filename: "emergence.png",
    size: "1536x1024",
    refs: ["ximena"],
    prompt: `SCENE: Ximena walks OUT of the volcanic cave entrance. Viewed from the front as she emerges. The massive glowing cave mouth is behind her, backlighting her in deep orange and red. But the fire around her is DIFFERENT now — no longer wild and chaotic. A steady, controlled, warm golden glow emanates from her body. Clean, even, purposeful. Her hat is back on. Her posture is upright, confident. Her expression is a real smile — not the cocky smirk, but something genuine and grounded. She walks with the steadiness of someone who faced themselves and came out the other side. In the background beyond the cave, four small figures wait — her teammates. Dawn light mixes with the volcanic glow. The hero shot.

CHARACTERS:
${CHAR.ximena} But transformed — same clothes, same look, but the fire around her is steady and controlled. Expression is genuine confidence, not bravado. A real smile.

ART STYLE: ${STYLE} Triumphant emergence. Backlighting from the cave creates a dramatic silhouette edge. The controlled golden glow around her should contrast with the wild red fire of the cave behind. Hero shot energy. Dawn of a new chapter.`
  },
  {
    id: "the_rematch",
    filename: "the_rematch.png",
    size: "1536x1024",
    refs: ["nalyd", "ximena", "dojo_training_hall"],
    prompt: `SCENE: The dojo training hall. ${DOJO_INTERIOR} Nalyd and Ximena spar in the center of the sparring circle. Ximena is in BURST IGNITION MODE — her body blazes with intense, controlled fire, eyes glowing bright scarlet, moving fast, mid-strike with a flaming fist aimed at Nalyd. The flames around her are powerful but CONTROLLED — tight, focused, purposeful. Different from the wild chaos of earlier. Nalyd is fully engaged, dodging or blocking, actually pushed — this is not a casual spar. His expression shows respect and effort. Around the edges of the hall, dojo students in navy blue gis watch in awe, mouths open. The final image showing the new dynamic: Ximena with her burst power, Nalyd having to actually work. Two fire users at the peak of their rivalry.

CHARACTERS:
${CHAR.nalyd}
${CHAR.ximena} In burst Ignition — flames blazing intensely around her whole body, eyes glowing bright red, moving at incredible speed. The fire is CONTROLLED and focused, not wild.

ART STYLE: ${STYLE} Peak action. Two martial arts masters mid-exchange. Nalyd's calm power vs Ximena's explosive burst. Fire everywhere but purposeful. Students watching in awe. This should feel like the climax of a martial arts epic.`
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
    return { id: scene.id, path: outPath, success: true, time: elapsed };
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`  ❌ Failed in ${elapsed}s — ${err.message}`);
    return { id: scene.id, success: false, error: err.message, time: elapsed };
  }
}

async function main() {
  console.log('🎬 Generating quest images for "The Uncontrolled Flame"');
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
