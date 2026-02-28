#!/usr/bin/env node
/**
 * Scheduled Test Runner
 *
 * Builds the client, runs the full E2E test suite, and optionally
 * invokes the AI fix pipeline if failures are detected.
 *
 * Usage:
 *   node scripts/run-tests-scheduled.js              # Run tests only
 *   node scripts/run-tests-scheduled.js --auto-fix   # Run tests + auto-fix failures
 *   node scripts/run-tests-scheduled.js --notify     # Log results to file for review
 *
 * Designed to be called from:
 *   - Windows Task Scheduler (nightly runs)
 *   - Git post-merge hook (after big changes)
 *   - Manually after a coding session
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'test', 'logs');
const BUGS_DIR = path.join(ROOT, 'test', 'bugs');

const autoFix = process.argv.includes('--auto-fix');
const notify = process.argv.includes('--notify');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  if (notify) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(LOGS_DIR, `run-${timestamp}.log`),
      line + '\n'
    );
  }
}

function run(cmd, opts = {}) {
  try {
    const result = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: opts.timeout || 300000,
      stdio: opts.silent ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    });
    return { success: true, output: result };
  } catch (err) {
    return { success: false, output: err.stdout || err.message };
  }
}

async function main() {
  log('=== Scheduled Test Run ===');
  log(`Mode: ${autoFix ? 'test + auto-fix' : 'test only'}`);
  log(`Logging: ${notify ? 'to file' : 'console only'}`);

  // Step 1: Build the client
  log('\nStep 1: Building client...');
  const build = run('npm run build', { timeout: 120000 });
  if (!build.success) {
    log('BUILD FAILED — aborting test run.');
    log(build.output?.slice(-500) || '(no output)');
    process.exit(1);
  }
  log('Build complete.');

  // Step 2: Run E2E tests
  log('\nStep 2: Running E2E tests...');
  const tests = run('npx playwright test', { timeout: 600000 });

  if (tests.success) {
    log('\nAll tests PASSED!');
    logSummary(0);
    process.exit(0);
  }

  log('\nSome tests FAILED.');

  // Step 3: Count bug reports
  const bugCount = countBugReports();
  log(`Bug reports generated: ${bugCount}`);
  logSummary(bugCount);

  // Step 4: Auto-fix if requested
  if (autoFix && bugCount > 0) {
    log('\nStep 3: Running AI auto-fix pipeline...');
    const fix = run('node scripts/fix-bugs.js', { timeout: 600000 });
    if (fix.success) {
      log('Auto-fix pipeline completed.');
    } else {
      log('Auto-fix pipeline had errors.');
    }

    // Re-count remaining bugs
    const remaining = countBugReports();
    log(`Remaining bugs after auto-fix: ${remaining}`);
  }

  process.exit(tests.success ? 0 : 1);
}

function countBugReports() {
  if (!fs.existsSync(BUGS_DIR)) return 0;
  return fs.readdirSync(BUGS_DIR).filter(
    (f) => f.endsWith('.json') && f.startsWith('bug-')
  ).length;
}

function logSummary(bugCount) {
  if (!notify) return;

  const summary = {
    timestamp: new Date().toISOString(),
    bugs: bugCount,
    autoFix,
    platform: process.platform,
  };

  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(LOGS_DIR, `summary-${timestamp}.json`),
    JSON.stringify(summary, null, 2)
  );
}

main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});
