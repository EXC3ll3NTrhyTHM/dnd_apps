/**
 * Scene Registry
 * 
 * Maps location IDs to their custom scene components.
 * Locations without a custom scene will use the default chat view.
 */

import DojoScene from './DojoScene';
import BarracksScene from './BarracksScene';
// Import future scenes here:
// import TavernScene from './TavernScene';
// import VeilScene from './VeilScene';

// Map of locationId -> Scene Component
const SCENE_REGISTRY = {
  'the_dojo': DojoScene,
  'the_barracks': BarracksScene,
  // Add more scenes as they're created:
  // 'dragons_hollow': TavernScene,
  // 'the_veil': VeilScene,
};

/**
 * Get the scene component for a location
 * @param {string} locationId 
 * @returns {Component|null} Scene component or null if no custom scene
 */
export function getSceneComponent(locationId) {
  return SCENE_REGISTRY[locationId] || null;
}

/**
 * Check if a location has a custom scene
 * @param {string} locationId 
 * @returns {boolean}
 */
export function hasCustomScene(locationId) {
  return locationId in SCENE_REGISTRY;
}

// Export individual scenes for direct imports if needed
export { DojoScene, BarracksScene };
