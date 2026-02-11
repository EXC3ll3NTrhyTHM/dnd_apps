/**
 * Shared Typing Registry
 * 
 * Tracks which NPCs are typing in which locations.
 * Shared between chat and clawdbot routes.
 */

// { locationId: { npcId: { displayName, lastSeen } } }
const typingRegistry = {};

function setNpcTyping(locationId, npcId, displayName, isTyping) {
  if (!typingRegistry[locationId]) typingRegistry[locationId] = {};
  if (isTyping) {
    typingRegistry[locationId][npcId] = { 
      displayName: displayName || npcId, 
      lastSeen: Date.now() 
    };
  } else {
    delete typingRegistry[locationId][npcId];
  }
}

function getTypingInLocation(locationId) {
  return typingRegistry[locationId] || {};
}

// Clean up stale typing indicators (older than 30s) every minute
setInterval(() => {
  const now = Date.now();
  for (const locId in typingRegistry) {
    for (const npcId in typingRegistry[locId]) {
      if (now - typingRegistry[locId][npcId].lastSeen > 30000) {
        delete typingRegistry[locId][npcId];
      }
    }
  }
}, 60000);

module.exports = {
  setNpcTyping,
  getTypingInLocation
};
