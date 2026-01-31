/**
 * NPC Presence System
 * Shared utilities for managing NPC online/offline status and activities
 */

const fs = require('fs');
const path = require('path');

// Status types: 'online', 'idle', 'dnd', 'invisible'
const STATUSES = {
  ONLINE: 'online',
  IDLE: 'idle',
  DND: 'dnd',
  INVISIBLE: 'invisible'
};

/**
 * Set the bot's presence on Discord
 */
function setPresence(client, status, activity = null) {
  const presenceData = {
    status: status,
    activities: activity ? [{ name: activity, type: 0 }] : []
  };
  
  client.user.setPresence(presenceData);
  currentStatus = status;  // Track for isActive checks
  console.log(`[Presence] Set status to: ${status}${activity ? ` - "${activity}"` : ''}`);
}

/**
 * Load schedule config for this NPC
 */
function loadSchedule(characterDir) {
  const schedulePath = path.join(characterDir, 'schedule.json');
  
  if (!fs.existsSync(schedulePath)) {
    console.log('[Presence] No schedule.json found, using defaults');
    return null;
  }
  
  try {
    return JSON.parse(fs.readFileSync(schedulePath, 'utf-8'));
  } catch (err) {
    console.error('[Presence] Error loading schedule:', err);
    return null;
  }
}

/**
 * Get current day of week (lowercase)
 */
function getCurrentDay() {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return days[new Date().getDay()];
}

/**
 * Get current hour (0-23)
 */
function getCurrentHour() {
  return new Date().getHours();
}

/**
 * Find matching schedule entry for current time
 */
function findCurrentSchedule(schedule) {
  if (!schedule || !schedule.entries) return schedule?.default || null;
  
  const currentDay = getCurrentDay();
  const currentHour = getCurrentHour();
  
  // Find entry matching current day and time
  for (const entry of schedule.entries) {
    const dayMatch = !entry.days || entry.days.includes(currentDay);
    const hourMatch = !entry.hours || 
      (currentHour >= entry.hours.start && currentHour < entry.hours.end);
    
    if (dayMatch && hourMatch) {
      return entry;
    }
  }
  
  return schedule.default || null;
}

/**
 * Initialize presence system - checks schedule and updates status
 * Returns { shouldAnnounce, message, isLeaving } if status changed
 */
let lastStatus = null;
let lastScheduleEntry = null;  // Track which schedule entry was active
let currentStatus = 'online';  // Track current status for isActive checks
let manualOverride = false;    // When true, scheduler won't override status

/**
 * Check if the NPC is currently "active" (should respond to messages)
 * Returns false if invisible or dnd
 */
function isActive() {
  return currentStatus === 'online' || currentStatus === 'idle';
}

/**
 * Set manual override - prevents scheduler from changing status until next schedule transition
 */
function setManualOverride(enabled) {
  manualOverride = enabled;
  console.log(`[Presence] Manual override: ${enabled ? 'ON (until next schedule change)' : 'OFF'}`);
}

/**
 * Check if manual override is active
 */
function hasManualOverride() {
  return manualOverride;
}

function updatePresence(client, characterDir, announceChannel = null) {
  const schedule = loadSchedule(characterDir);
  if (!schedule) {
    setPresence(client, STATUSES.ONLINE);
    return null;
  }
  
  const current = findCurrentSchedule(schedule);
  if (!current) {
    setPresence(client, STATUSES.ONLINE);
    return null;
  }
  
  // Create a unique identifier for this schedule entry
  const entryId = JSON.stringify({ 
    days: current.days, 
    hours: current.hours, 
    comment: current.comment 
  });
  
  // Check if schedule entry changed
  const scheduleChanged = lastScheduleEntry !== null && lastScheduleEntry !== entryId;
  
  // If manual override is active but schedule changed, clear the override
  if (manualOverride && scheduleChanged) {
    console.log('[Presence] Schedule changed - clearing manual override');
    manualOverride = false;
  }
  
  // Skip update if manual override still active (same schedule period)
  if (manualOverride) {
    console.log('[Presence] Skipping update - manual override active (same schedule period)');
    lastScheduleEntry = entryId;
    return null;
  }
  
  lastScheduleEntry = entryId;
  
  const newStatus = current.status || STATUSES.ONLINE;
  const activity = current.activity || null;
  
  // Check if status changed
  const statusChanged = lastStatus !== null && lastStatus !== newStatus;
  const wasOnline = lastStatus === STATUSES.ONLINE || lastStatus === STATUSES.IDLE;
  const isNowOnline = newStatus === STATUSES.ONLINE || newStatus === STATUSES.IDLE;
  
  // Update presence
  setPresence(client, newStatus, activity);
  lastStatus = newStatus;
  
  // Determine announcement
  if (statusChanged && announceChannel) {
    if (wasOnline && !isNowOnline && current.away_message) {
      // Going away
      return { shouldAnnounce: true, message: current.away_message, isLeaving: true };
    } else if (!wasOnline && isNowOnline) {
      // Coming back
      const returnMsg = current.return_message || schedule.default_return_message;
      if (returnMsg) {
        return { shouldAnnounce: true, message: returnMsg, isLeaving: false };
      }
    }
  }
  
  return null;
}

/**
 * Start the presence scheduler
 * Checks every N minutes and updates status based on schedule
 */
function startPresenceScheduler(client, characterDir, checkIntervalMinutes = 30, announceChannelId = null) {
  console.log(`[Presence] Starting scheduler (checking every ${checkIntervalMinutes} min)`);
  
  // Initial check
  const initialResult = updatePresence(client, characterDir);
  
  // Schedule periodic checks
  setInterval(async () => {
    const result = updatePresence(client, characterDir);
    
    if (result && result.shouldAnnounce && announceChannelId) {
      try {
        const channel = await client.channels.fetch(announceChannelId);
        if (channel) {
          await channel.send(result.message);
          console.log(`[Presence] Announced: ${result.message}`);
        }
      } catch (err) {
        console.error('[Presence] Error sending announcement:', err);
      }
    }
  }, checkIntervalMinutes * 60 * 1000);
  
  return initialResult;
}

module.exports = {
  STATUSES,
  setPresence,
  loadSchedule,
  getCurrentDay,
  getCurrentHour,
  findCurrentSchedule,
  updatePresence,
  startPresenceScheduler,
  isActive,
  setManualOverride,
  hasManualOverride
};
