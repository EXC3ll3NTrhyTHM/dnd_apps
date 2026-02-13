const KEY = 'npc_mention_freq';

export function getNpcFreqs(locationId) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY)) || {};
    return locationId ? (all[locationId] || {}) : all;
  } catch { return {}; }
}

export function bumpNpcFreq(npcId, locationId) {
  if (!locationId) return;
  try {
    const all = JSON.parse(localStorage.getItem(KEY)) || {};
    if (!all[locationId]) all[locationId] = {};
    all[locationId][npcId] = (all[locationId][npcId] || 0) + 1;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}
