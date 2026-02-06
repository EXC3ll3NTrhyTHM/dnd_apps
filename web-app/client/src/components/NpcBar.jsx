import NpcPortrait from './NpcPortrait';

/**
 * Horizontal scrollable row of NPC portraits.
 * Tap one to enter 1-on-1 mode. Tap again or "Everyone" to return to room mode.
 */
export default function NpcBar({ npcs, selectedNpc, onSelectNpc, emotions = {} }) {
  return (
    <div className="npc-bar">
      <button
        className={`npc-bar-item ${!selectedNpc ? 'npc-bar-item-active' : ''}`}
        onClick={() => onSelectNpc(null)}
      >
        <div className="npc-bar-everyone">
          <span>All</span>
        </div>
        <span className="npc-bar-name">Everyone</span>
      </button>

      {npcs.map(npc => (
        <button
          key={npc.id}
          className={`npc-bar-item ${selectedNpc === npc.id ? 'npc-bar-item-active' : ''}`}
          onClick={() => onSelectNpc(selectedNpc === npc.id ? null : npc.id)}
        >
          <NpcPortrait
            npcId={npc.id}
            emotion={emotions[npc.id] || 'idle'}
            size={44}
            selected={selectedNpc === npc.id}
          />
          <span className="npc-bar-name">{npc.displayName.split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );
}
