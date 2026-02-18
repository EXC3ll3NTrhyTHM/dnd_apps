/**
 * BarracksScene - The Barracks stronghold scene
 *
 * Custom scene for the_barracks location with military/shield theming
 */

import { useNavigate } from 'react-router-dom';
import { api } from '../../hooks/useApi';
import {
  SceneEntities,
  SceneHeader,
  GatheringSpot,
  EditPanel,
  useSceneEditor,
  buildPetPlacements,
  splitPlacements
} from './SceneBase';
import '../../styles/location-scene.css';

export default function BarracksScene({
  location,
  isAdmin,
  onNpcClick,
  onGatheringClick,
  onLocationUpdate,
  setToast,
  pets,
  currentUserId,
  onPetClick,
  refreshPets
}) {
  const navigate = useNavigate();
  const { scene } = location;

  const editor = useSceneEditor(scene.npcPlacements);

  const basePlacements = { ...scene.npcPlacements, ...buildPetPlacements(pets) };
  const placements = editor.editMode && editor.editPlacements
    ? editor.editPlacements
    : basePlacements;

  const handleSave = async () => {
    if (!editor.editPlacements) return;
    editor.setSaving(true);

    const { npcPlacements, petPlacements } = splitPlacements(editor.editPlacements);

    try {
      const saves = [
        api(`/api/admin/locations/${location.id}/scene`, {
          method: 'PUT',
          body: JSON.stringify({ npcPlacements })
        })
      ];
      if (Object.keys(petPlacements).length > 0) {
        saves.push(api('/api/admin/pets/placements', {
          method: 'PUT',
          body: JSON.stringify({ placements: petPlacements })
        }));
      }
      await Promise.all(saves);

      setToast?.({ type: 'success', message: 'Placements saved!' });
      onLocationUpdate?.({
        ...location,
        scene: { ...scene, npcPlacements }
      });
      refreshPets?.();
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
      className={`location-scene barracks-scene ${editor.editMode ? 'edit-active' : ''}`}
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
        onEditToggle={() => editor.enterEditMode(basePlacements)}
        isAdmin={isAdmin}
      />

      {/* NPC + Pet Sprites */}
      <SceneEntities
        location={location}
        pets={pets}
        placements={placements}
        particleConfig={scene.particles}
        editMode={editor.editMode}
        editSelectedNpc={editor.editSelectedNpc}
        onSelect={handleNpcSelect}
        onDragStart={editor.handleDragStart}
        onPetClick={onPetClick}
      />

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
