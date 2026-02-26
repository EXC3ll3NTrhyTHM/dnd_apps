/**
 * Centralized data directory paths.
 *
 * In normal operation, resolves to the standard directories.
 * In test mode, TEST_DATA_DIR / TEST_ECONOMY_DIR env vars override
 * so tests use isolated copies of the data.
 */

const path = require('path');

const DATA_DIR = process.env.TEST_DATA_DIR
  ? path.resolve(process.env.TEST_DATA_DIR)
  : path.resolve(__dirname, '..', '..', 'data');

const ECONOMY_DIR = process.env.TEST_ECONOMY_DIR
  ? path.resolve(process.env.TEST_ECONOMY_DIR)
  : path.resolve(__dirname, '..', '..', '..', 'economy');

const CHARACTERS_DIR = process.env.TEST_CHARACTERS_DIR
  ? path.resolve(process.env.TEST_CHARACTERS_DIR)
  : path.resolve(__dirname, '..', '..', '..', 'characters');

const QUESTMASTER_DIR = process.env.TEST_QUESTMASTER_DIR
  ? path.resolve(process.env.TEST_QUESTMASTER_DIR)
  : path.resolve(__dirname, '..', '..', '..', 'questmaster');

const PLAYERS_PATH = path.join(DATA_DIR, 'players.json');

module.exports = {
  DATA_DIR,
  ECONOMY_DIR,
  CHARACTERS_DIR,
  QUESTMASTER_DIR,
  PLAYERS_PATH,
};
