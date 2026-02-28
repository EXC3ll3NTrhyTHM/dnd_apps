#!/usr/bin/env node
/**
 * AI Bug Fix Script
 *
 * Reads structured bug reports from test/bugs/ and invokes Claude Code CLI
 * to fix them, then re-runs the specific test to verify the fix.
 *
 * Usage:
 *   node scripts/fix-bugs.js           # Fix all bugs
 *   node scripts/fix-bugs.js --dry-run # Preview without fixing
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BUGS_DIR = path.resolve(__dirname, '..', 'test', 'bugs');
const FIXED_DIR = path.join(BUGS_DIR, 'fixed');

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };

function loadBugReports() {
  if (!fs.existsSync(BUGS_DIR)) {
    console.log('No bugs directory found.');
    return [];
  }

  const files = fs.readdirSync(BUGS_DIR).filter((f) => f.endsWith('.json') && f.startsWith('bug-'));
  const bugs = files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(BUGS_DIR, f), 'utf8'));
    } catch {
      console.warn(`  Skipping invalid bug file: ${f}`);
      return null;
    }
  }).filter(Boolean);

  // Sort by priority
  bugs.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    return pa - pb;
  });

  return bugs;
}

async function fixBug(bug, dryRun = false) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Bug: ${bug.title}`);
  console.log(`Priority: ${bug.priority}`);
  console.log(`Test: ${bug.testName}`);
  console.log(`Files: ${bug.suspectedFiles?.join(', ') || 'unknown'}`);

  if (bug.diagnostics?.consoleErrors?.length) {
    console.log(`Console errors: ${bug.diagnostics.consoleErrors.length}`);
  }

  const task = bug.forAgent?.task;
  if (!task) {
    console.log('  No agent task found in bug report. Skipping.');
    return false;
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Would invoke Claude Code with:');
    console.log(task.slice(0, 500));
    return false;
  }

  // Invoke Claude Code CLI
  console.log('\nInvoking Claude Code...');
  try {
    const result = execSync(
      `claude -p "${task.replace(/"/g, '\\"')}"`,
      {
        cwd: path.resolve(__dirname, '..'),
        encoding: 'utf8',
        timeout: 300000, // 5 min max per bug
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    console.log('Claude response:', result.slice(0, 500));
  } catch (err) {
    console.error(`  Claude invocation failed: ${err.message}`);
    return false;
  }

  // Re-run the specific test
  console.log(`\nRe-running test: ${bug.testName}...`);
  try {
    execSync(
      `npx playwright test --grep "${bug.testName.replace(/"/g, '\\"')}"`,
      {
        cwd: path.resolve(__dirname, '..'),
        encoding: 'utf8',
        timeout: 120000,
        stdio: 'inherit',
      }
    );
    console.log('  Test PASSED! Moving bug to fixed/');

    // Move bug report to fixed
    fs.mkdirSync(FIXED_DIR, { recursive: true });
    const srcFile = path.join(BUGS_DIR, `${bug.id}.json`);
    const destFile = path.join(FIXED_DIR, `${bug.id}.json`);
    if (fs.existsSync(srcFile)) {
      const fixedBug = { ...bug, fixedAt: new Date().toISOString() };
      fs.writeFileSync(destFile, JSON.stringify(fixedBug, null, 2));
      fs.unlinkSync(srcFile);
    }
    return true;
  } catch {
    console.error('  Test still FAILING after fix attempt.');
    return false;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Bug Fix Pipeline');
  console.log('================');
  if (dryRun) console.log('(DRY RUN MODE)\n');

  const bugs = loadBugReports();
  if (bugs.length === 0) {
    console.log('No bug reports found in test/bugs/. Run tests first: npm run test:e2e');
    return;
  }

  console.log(`Found ${bugs.length} bug report(s):\n`);
  bugs.forEach((b, i) => {
    console.log(`  ${i + 1}. [${b.priority}] ${b.title}`);
  });

  let fixed = 0;
  let failed = 0;

  for (const bug of bugs) {
    const success = await fixBug(bug, dryRun);
    if (success) fixed++;
    else if (!dryRun) failed++;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${fixed} fixed, ${failed} failed, ${bugs.length} total`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
