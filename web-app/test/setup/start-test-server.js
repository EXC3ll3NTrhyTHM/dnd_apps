/**
 * Test Server Bootstrap
 *
 * Copies fixture data to a temp directory, then starts the Express server
 * with env vars pointing to the temp dir. Run by Playwright via webServer config.
 */

const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
const TMP_DIR = path.resolve(__dirname, '..', '.tmp-data');

// Clean and recreate temp directory
if (fs.existsSync(TMP_DIR)) {
  fs.rmSync(TMP_DIR, { recursive: true });
}

// Copy fixtures to temp
copyDirSync(path.join(FIXTURES_DIR, 'data'), path.join(TMP_DIR, 'data'));
copyDirSync(path.join(FIXTURES_DIR, 'economy'), path.join(TMP_DIR, 'economy'));

// Ensure directories that modules expect to exist
fs.mkdirSync(path.join(TMP_DIR, 'data', 'chat_history', 'shared'), { recursive: true });
fs.mkdirSync(path.join(TMP_DIR, 'data', 'uploads'), { recursive: true });

// Set env vars for the server to pick up via dataPaths.js
process.env.TEST_DATA_DIR = path.join(TMP_DIR, 'data');
process.env.TEST_ECONOMY_DIR = path.join(TMP_DIR, 'economy');

// Now start the actual server
require('../../server/server.js');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
