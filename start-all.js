const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================
// CONFIG
// ============================================

const ROOT = __dirname;

// Colors for log output (ANSI escape codes)
const COLORS = [
  '\x1b[32m',  // green
  '\x1b[33m',  // yellow
  '\x1b[34m',  // blue
  '\x1b[35m',  // magenta
  '\x1b[36m',  // cyan
  '\x1b[91m',  // bright red
  '\x1b[92m',  // bright green
  '\x1b[93m',  // bright yellow
  '\x1b[94m',  // bright blue
  '\x1b[95m',  // bright magenta
  '\x1b[96m',  // bright cyan
  '\x1b[31m',  // red
  '\x1b[37m',  // white
  '\x1b[90m',  // gray
  '\x1b[97m',  // bright white
  '\x1b[38;5;208m', // orange
  '\x1b[38;5;141m', // purple
  '\x1b[38;5;45m',  // teal
];
const RESET = '\x1b[0m';

// ============================================
// DISCOVER NPC BOTS
// ============================================

// Find all characters that have a .env file
const npcBots = fs.readdirSync(ROOT)
  .filter(f => f.startsWith('.env.') && !f.includes('example') && !f.includes('template') && !f.includes('imagegen'))
  .map(f => f.replace('.env.', ''))
  .filter(name => {
    // Only include characters that have a character directory (excludes questmaster, shopkeeper, etc.)
    const charDir = path.join(ROOT, 'characters', name);
    return fs.existsSync(charDir);
  });

// ============================================
// BUILD PROCESS LIST
// ============================================

const processes = [];
let colorIndex = 0;

// Add NPC character bots
for (const name of npcBots) {
  processes.push({
    name: name.toUpperCase().padEnd(10),
    cmd: 'node',
    args: ['bot.js', name],
    cwd: ROOT,
    color: COLORS[colorIndex++ % COLORS.length],
  });
}

// Add questmaster (both dev and prod if env files exist)
for (const env of ['dev', 'prod']) {
  const qmEnvPath = path.join(ROOT, 'questmaster', `.env.questmaster.${env}`);
  if (fs.existsSync(qmEnvPath)) {
    processes.push({
      name: `QM-${env.toUpperCase()}`.padEnd(10),
      cmd: 'node',
      args: ['bot.js', env],
      cwd: path.join(ROOT, 'questmaster'),
      color: COLORS[colorIndex++ % COLORS.length],
    });
  }
}

// Add shopkeeper (both dev and prod if env files exist)
for (const env of ['dev', 'prod']) {
  const skEnvPath = path.join(ROOT, 'shopkeeper', `.env.shopkeeper.${env}`);
  if (fs.existsSync(skEnvPath)) {
    processes.push({
      name: `SK-${env.toUpperCase()}`.padEnd(10),
      cmd: 'node',
      args: ['bot.js', env],
      cwd: path.join(ROOT, 'shopkeeper'),
      color: COLORS[colorIndex++ % COLORS.length],
    });
  }
}

// ============================================
// LAUNCH
// ============================================

console.log(`\x1b[1m=== Starting ${processes.length} bots ===\x1b[0m\n`);
for (const p of processes) {
  console.log(`  ${p.color}${p.name}${RESET} ${p.cmd} ${p.args.join(' ')}`);
}
console.log('');

const children = [];

for (const p of processes) {
  const child = spawn(p.cmd, p.args, {
    cwd: p.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });

  child.botName = p.name;

  child.stdout.on('data', (data) => {
    const lines = data.toString().trimEnd().split('\n');
    for (const line of lines) {
      console.log(`${p.color}[${p.name.trim()}]${RESET} ${line}`);
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trimEnd().split('\n');
    for (const line of lines) {
      console.error(`${p.color}[${p.name.trim()}]${RESET} \x1b[31m${line}${RESET}`);
    }
  });

  child.on('exit', (code) => {
    console.log(`${p.color}[${p.name.trim()}]${RESET} Process exited with code ${code}`);
  });

  children.push(child);
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

function shutdown() {
  console.log('\n\x1b[1m=== Shutting down all bots... ===\x1b[0m');
  for (const child of children) {
    child.kill('SIGTERM');
  }
  // Force kill after 5 seconds
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(0);
  }, 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// On Windows, handle Ctrl+C
if (process.platform === 'win32') {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('SIGINT', () => process.emit('SIGINT'));
}
