/**
 * DojoScene - The Dojo training grounds scene
 * 
 * Custom scene for the_dojo location with martial arts theming
 */

import { useNavigate } from 'react-router-dom';
import { api } from '../../hooks/useApi';
import {
  NpcSprite,
  SceneHeader,
  GatheringSpot,
  EditPanel,
  useSceneEditor
} from './SceneBase';
import '../../styles/location-scene.css';

export default function DojoScene({
  location,
  isAdmin,
  onNpcClick,
  onGatheringClick,
  onLocationUpdate,
  setToast 
}) {
  const navigate = useNavigate();
  const { scene } = location;
  
  const editor = useSceneEditor(scene.npcPlacements);
  const placements = editor.editMode && editor.editPlacements 
    ? editor.editPlacements 
    : scene.npcPlacements;

  const handleSave = async () => {
    if (!editor.editPlacements) return;
    editor.setSaving(true);
    
    try {
      const result = await api(`/api/admin/locations/${location.id}/scene`, {
        method: 'PUT',
        body: JSON.stringify({ npcPlacements: editor.editPlacements })
      });
      
      setToast?.({ type: 'success', message: 'Placements saved!' });
      onLocationUpdate?.({
        ...location,
        scene: { ...scene, npcPlacements: editor.editPlacements }
      });
    } catch (err) {
      setToast?.({ type: 'error', message: 'Failed to save: ' + (err.data?.error || err.message) });
    } finally {
      editor.setSaving(false);
    }
  };

  const handleBack = () => {
    if (editor.editMode) {
      editor.exitEditMode();
    } else {
      navigate('/map');
    }
  };

  const handleNpcSelect = (npcId) => {
    if (editor.editMode) {
      editor.setEditSelectedNpc(npcId);
    } else {
      onNpcClick?.(npcId);
    }
  };

  return (
    <div 
      className={`location-scene dojo-scene ${editor.editMode ? 'edit-active' : ''}`} 
      ref={editor.sceneRef}
    >
      {/* Background */}
      <div
        className="scene-background"
        style={{ backgroundImage: `url(${scene.background})` }}
      />

      {/* Header */}
      <SceneHeader
        title={location.name}
        onBack={handleBack}
        editMode={editor.editMode}
        saving={editor.saving}
        onSave={handleSave}
        onEditToggle={() => editor.enterEditMode(scene.npcPlacements)}
        isAdmin={isAdmin}
      />

      {/* NPC Sprites */}
      <div className="scene-npcs">
        {Object.entries(placements).map(([npcId, placement]) => {
          const npc = location.npcs.find(n => n.id === npcId);
          const displayName = npc?.displayName || npcId.charAt(0).toUpperCase() + npcId.slice(1);
          
          return (
            <NpcSprite
              key={npcId}
              npcId={npcId}
              placement={placement}
              displayName={displayName}
              editMode={editor.editMode}
              isSelected={editor.editSelectedNpc === npcId}
              particleConfig={scene.particles}
              onSelect={handleNpcSelect}
              onDragStart={editor.handleDragStart}
            />
          );
        })}
      </div>

      {/* Gathering Spot - hidden in edit mode */}
      {!editor.editMode && (
        <GatheringSpot config={scene.gatheringSpot} onClick={onGatheringClick} />
      )}

      {/* Hint */}
      {!editor.editMode && (
        <div className="scene-hint">Tap a character to chat</div>
      )}

      {/* Edit Mode UI */}
      {editor.editMode && (
        <>
          <EditPanel
            npcId={editor.editSelectedNpc}
            placement={editor.editPlacements?.[editor.editSelectedNpc]}
            onScaleChange={editor.handleScaleChange}
            onZIndexChange={editor.handleZIndexChange}
            onFlipToggle={editor.handleFlipToggle}
            onHitboxChange={editor.handleHitboxChange}
          />
          <div className="edit-hint">
            Drag NPCs to reposition. Click to select, use slider for scale.
          </div>
        </>
      )}
    </div>
  );
}
