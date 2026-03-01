/**
 * Generate condensed character sheets from D&D Beyond exports.
 *
 * Reads raw exports from players_stat/raw/, runs parseSheet(),
 * and writes:
 *   - players_stat/parsed/{name}.json  (condensed JSON, ~3-6KB)
 *   - players_stat/summaries/{name}.md (human-readable Markdown)
 *
 * Usage:
 *   node scripts/generate-character-sheets.js            # all characters
 *   node scripts/generate-character-sheets.js acacia.json # single character
 */

const fs = require('fs');
const path = require('path');
const { parseSheet, CHARACTER_MAP } = require('../server/lib/characterSheets');

const RAW_DIR = path.join(__dirname, '..', 'players_stat', 'raw');
const PARSED_DIR = path.join(__dirname, '..', 'players_stat', 'parsed');
const SUMMARIES_DIR = path.join(__dirname, '..', 'players_stat', 'summaries');

function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

function formatModifier(mod) {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function generateMarkdown(sheet, filename) {
  const lines = [];

  // Header
  lines.push(`# ${sheet.name}`);
  lines.push('');
  const classStr = sheet.classes.map(c => {
    const sub = c.subclass ? ` (${c.subclass})` : '';
    return `${c.name}${sub} ${c.level}`;
  }).join(' / ');
  lines.push(`**Race:** ${sheet.race} | **Background:** ${sheet.background || 'None'} | **Level:** ${sheet.totalLevel}`);
  lines.push(`**Classes:** ${classStr}`);
  lines.push(`**HP:** ${sheet.hp} | **AC:** ${sheet.ac} | **Proficiency Bonus:** +${sheet.profBonus}`);
  lines.push('');

  // Ability Scores
  lines.push('## Ability Scores');
  lines.push('');
  lines.push('| STR | DEX | CON | INT | WIS | CHA |');
  lines.push('|-----|-----|-----|-----|-----|-----|');
  const scores = sheet.stats.map(s => `${s.score} (${formatModifier(s.modifier)})`);
  lines.push(`| ${scores.join(' | ')} |`);
  lines.push('');

  // Equipment
  if (sheet.equipment && sheet.equipment.length > 0) {
    lines.push('## Equipment');
    lines.push('');
    for (const item of sheet.equipment) {
      lines.push(`- ${item.name} (${item.type})`);
    }
    lines.push('');
  }

  // Spellcasting
  if (sheet.spellcasting) {
    const sc = sheet.spellcasting;
    lines.push('## Spellcasting');
    lines.push('');
    lines.push(`- **Class:** ${sc.className} | **Ability:** ${sc.abilityName} (${formatModifier(sc.abilityModifier)})`);
    lines.push(`- **Spell Save DC:** ${sc.spellSaveDC} | **Spell Attack:** ${formatModifier(sc.spellAttackBonus)}`);
    const slotStr = sc.slots.map(s => `${ordinal(s.level)} level: ${s.total}`).join(', ');
    lines.push(`- **Slots:** ${slotStr}`);
    lines.push('');
  }

  // Channel Divinity
  if (sheet.channelDivinityMax > 0) {
    lines.push(`**Channel Divinity:** ${sheet.channelDivinityMax} use(s) per short rest`);
    lines.push('');
  }

  // Class Features
  if (sheet.classFeatures && sheet.classFeatures.length > 0) {
    lines.push('## Class Features');
    lines.push('');
    lines.push(sheet.classFeatures.join(', '));
    lines.push('');
  }

  // Traits
  const traits = sheet.traits || {};
  if (traits.personalityTraits || traits.ideals || traits.bonds || traits.flaws) {
    lines.push('## Traits');
    lines.push('');
    if (traits.personalityTraits) lines.push(`**Personality:** ${traits.personalityTraits}`);
    if (traits.ideals) lines.push(`**Ideals:** ${traits.ideals}`);
    if (traits.bonds) lines.push(`**Bonds:** ${traits.bonds}`);
    if (traits.flaws) lines.push(`**Flaws:** ${traits.flaws}`);
    lines.push('');
  }

  // Physical Description
  const phys = sheet.physical || {};
  const physParts = [];
  if (phys.age) physParts.push(`Age ${phys.age}`);
  if (phys.gender) physParts.push(phys.gender);
  if (phys.hair) physParts.push(`${phys.hair} hair`);
  if (phys.eyes) physParts.push(`${phys.eyes} eyes`);
  if (phys.skin) physParts.push(`${phys.skin} skin`);
  if (phys.height) physParts.push(phys.height);
  if (phys.weight) physParts.push(phys.weight);
  if (physParts.length > 0) {
    lines.push('## Physical Description');
    lines.push('');
    lines.push(physParts.join(' | '));
    lines.push('');
  }

  // Backstory
  if (sheet.backstory) {
    lines.push('## Backstory');
    lines.push('');
    lines.push(sheet.backstory);
    lines.push('');
  }

  // Enemies
  if (sheet.enemies) {
    lines.push('## Enemies');
    lines.push('');
    lines.push(sheet.enemies);
    lines.push('');
  }

  // Organizations
  if (sheet.organizations) {
    lines.push('## Organizations');
    lines.push('');
    lines.push(sheet.organizations);
    lines.push('');
  }

  return lines.join('\n');
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Main ──

// Ensure output directories exist
for (const dir of [PARSED_DIR, SUMMARIES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Determine which files to process
const targetFile = process.argv[2];
const filenames = targetFile
  ? [targetFile]
  : [...new Set(Object.values(CHARACTER_MAP))];

let generated = 0;

for (const filename of filenames) {
  const rawPath = path.join(RAW_DIR, filename);
  if (!fs.existsSync(rawPath)) {
    console.warn(`  SKIP ${filename} — not found in ${RAW_DIR}`);
    continue;
  }

  const content = fs.readFileSync(rawPath, 'utf8');
  const raw = JSON.parse(content);
  const sheet = parseSheet(raw);

  if (!sheet) {
    console.warn(`  SKIP ${filename} — parseSheet returned null`);
    continue;
  }

  const baseName = path.basename(filename, '.json');

  // Write condensed JSON
  const parsedPath = path.join(PARSED_DIR, filename);
  atomicWrite(parsedPath, JSON.stringify(sheet, null, 2));

  // Write Markdown summary
  const mdPath = path.join(SUMMARIES_DIR, `${baseName}.md`);
  atomicWrite(mdPath, generateMarkdown(sheet, filename));

  const rawSize = (fs.statSync(rawPath).size / 1024).toFixed(0);
  const parsedSize = (fs.statSync(parsedPath).size / 1024).toFixed(1);
  console.log(`  ${filename}: ${rawSize}KB raw → ${parsedSize}KB parsed + ${baseName}.md`);
  generated++;
}

console.log(`\nGenerated ${generated} character sheet(s).`);
