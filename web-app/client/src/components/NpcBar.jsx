import NpcPortrait from './NpcPortrait';

/**
 * Horizontal scrollable row of NPC portraits.
 * Tap one to prefill an @mention in the chat input.
 */
export default function NpcBar({ npcs, onNpcClick, emotions = {} }) {
  return (
    <div className="npc-bar">
      {npcs.map(npc => (
        <button
          key={npc.id}
          className="npc-bar-item"
          onClick={() => onNpcClick(npc)}
        >
          <NpcPortrait
            npcId={npc.id}
            emotion={emotions[npc.id] || 'idle'}
            size={44}
          />
          <span className="npc-bar-name">{npc.displayName.split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );
}
