/**
 * Namespace-colored debug logger.
 *
 * Usage:
 *   import { createLogger } from '../utils/debug';
 *   const log = createLogger('audio');
 *   log('loading buffer', url);
 *
 * Enable in browser console:
 *   localStorage.setItem('debug', '*');           // all namespaces
 *   localStorage.setItem('debug', 'audio,dice');  // specific namespaces
 *
 * Disable:
 *   localStorage.removeItem('debug');
 */

const NAMESPACE_COLORS = {
  audio: '#e91e63',
  dice: '#9c27b0',
  chat: '#2196f3',
  keyboard: '#4caf50',
  network: '#ff9800',
  memory: '#795548',
  state: '#607d8b',
  arena: '#f44336',
  scene: '#00bcd4',
  ws: '#ff5722',
};

let _enabledNamespaces = null;

function getEnabled() {
  if (_enabledNamespaces !== null) return _enabledNamespaces;
  try {
    const raw = localStorage.getItem('debug');
    if (!raw) {
      _enabledNamespaces = [];
    } else if (raw === '*') {
      _enabledNamespaces = ['*'];
    } else {
      _enabledNamespaces = raw.split(',').map((s) => s.trim());
    }
  } catch {
    _enabledNamespaces = [];
  }
  return _enabledNamespaces;
}

function isEnabled(namespace) {
  const enabled = getEnabled();
  return enabled.includes('*') || enabled.includes(namespace);
}

export function createLogger(namespace) {
  const color = NAMESPACE_COLORS[namespace] || '#999';

  return function debugLog(...args) {
    if (!isEnabled(namespace)) return;
    const prefix = `%c[${namespace}]`;
    const style = `color: ${color}; font-weight: bold;`;
    console.log(prefix, style, ...args);
  };
}

/** Reset cached namespaces (call after changing localStorage.debug) */
export function resetDebug() {
  _enabledNamespaces = null;
}
