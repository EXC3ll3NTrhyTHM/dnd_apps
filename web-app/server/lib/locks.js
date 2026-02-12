/**
 * Per-location mutex locks (prevents concurrent writes to the same chat history)
 * Shared across chat.js and upload.js
 */

const locationLocks = new Map();

function acquireLock(locationId) {
  if (!locationLocks.has(locationId)) {
    locationLocks.set(locationId, { locked: false, queue: [] });
  }
  const lock = locationLocks.get(locationId);

  return new Promise(resolve => {
    if (!lock.locked) {
      lock.locked = true;
      resolve();
    } else {
      lock.queue.push(resolve);
    }
  });
}

function releaseLock(locationId) {
  const lock = locationLocks.get(locationId);
  if (!lock) return;

  if (lock.queue.length > 0) {
    const next = lock.queue.shift();
    next();
  } else {
    lock.locked = false;
  }
}

module.exports = { acquireLock, releaseLock };
