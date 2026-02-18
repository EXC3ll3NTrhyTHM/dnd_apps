/**
 * SceneBase - Shared components and utilities for location scenes
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useUiSounds } from '../../hooks/useUiSounds';

// Particle system component - reusable across scenes
export function ParticleLayer({ config, className = '' }) {
  if (!config?.enabled) return null;
  
  const count = config.count || 3;
  const type = config.type || 'embers';
  const color = config.color || 'rgba(196, 160, 53, 0.8)';
  const speed = config.speed || 3;
  
  return (
    <div 
      className={`npc-particles particles-${type} ${className}`}
      style={{
        '--particle-color': color,
        '--particle-speed': `${speed}s`
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`particle p${i + 1}`} />
      ))}
    </div>
  );
}

// NPC Sprite component with hitbox
export function NpcSprite({
  npcId,
  placement,
  displayName,
  editMode,
  isSelected,
  particleConfig,
  onSelect,
  onDragStart,
  spriteUrl,
  fallbackEmoji,
}) {
  const imgSrc = spriteUrl || `/images/sprites/${npcId}.webp`;

  return (
    <div
      className={`scene-npc ${editMode ? 'edit-mode' : ''} ${isSelected ? 'edit-selected' : ''} ${placement.flipX ? 'flipped' : ''}`}
      style={{
        '--npc-x': `${placement.x}%`,
        '--npc-y': `${100 - placement.y}%`,
        '--npc-scale': placement.scale || 1,
        '--hitbox-width': `${placement.hitboxWidth || 60}px`,
        '--hitbox-height': `${placement.hitboxHeight || 120}px`,
        '--hitbox-offset-y': `${placement.hitboxOffsetY || 30}%`,
        zIndex: isSelected ? 100 : (placement.zIndex ?? 10),
      }}
      onMouseDown={(e) => editMode && onDragStart?.(e, npcId)}
      onTouchStart={(e) => editMode && onDragStart?.(e, npcId)}
    >
      {/* Layer 1: Sprite image */}
      <img
        className="npc-sprite"
        src={imgSrc}
        alt={displayName}
        draggable={false}
        onError={fallbackEmoji ? (e) => {
          e.target.style.display = 'none';
          e.target.nextSibling.style.display = 'flex';
        } : undefined}
      />
      {fallbackEmoji && (
        <span className="pet-scene-emoji" style={{ display: 'none' }}>
          {fallbackEmoji}
        </span>
      )}

      {/* Layer 2: Particle effects */}
      <ParticleLayer config={particleConfig} />

      {/* Layer 3: Clickable hitbox */}
      <div
        className={`npc-hitbox ${editMode ? 'edit-visible' : ''}`}
        onClick={() => onSelect?.(npcId)}
      />

      <div className="scene-npc-label">{displayName}</div>
      {editMode && (
        <div className="scene-npc-coords">
          x:{placement.x} y:{placement.y} s:{placement.scale?.toFixed(2) || '1.00'}
        </div>
      )}
    </div>
  );
}

// Scene header component
export function SceneHeader({ title, onBack, editMode, saving, onSave, onEditToggle, isAdmin }) {
  const playSound = useUiSounds();
  return (
    <div className="scene-header">
      <button className="scene-back-btn" onClick={() => { playSound('buttonTap'); onBack(); }}>
        ←
      </button>
      <div className="scene-title">{title}</div>
      <div className="scene-header-actions">
        {editMode && (
          <button 
            className="scene-save-btn" 
            onClick={onSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
        {isAdmin && !editMode && (
          <button className="scene-edit-btn" onClick={onEditToggle}>
            ✏️
          </button>
        )}
      </div>
    </div>
  );
}

// Gathering spot component
export function GatheringSpot({ config, onClick }) {
  if (!config) return null;
  
  return (
    <div
      className="scene-gathering-spot"
      style={{
        left: `${config.position.x}%`,
        bottom: `${100 - config.position.y}%`,
        width: `${config.size.width}%`,
        height: `${config.size.height}%`,
      }}
      onClick={onClick}
    >
      <span className="scene-gathering-label">{config.label}</span>
    </div>
  );
}

// Edit panel component — collapsible
export function EditPanel({
  npcId,
  placement,
  onScaleChange,
  onZIndexChange,
  onFlipToggle,
  onHitboxChange
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (!npcId || !placement) return null;

  return (
    <div className={`edit-panel ${collapsed ? 'edit-panel-collapsed' : ''}`}>
      <div className="edit-panel-header" onClick={() => setCollapsed(c => !c)}>
        <span className="edit-panel-title">{npcId}</span>
        <span className="edit-panel-toggle">{collapsed ? '▲' : '▼'}</span>
      </div>
      {!collapsed && (
        <>
          <div className="edit-panel-row">
            <label>Scale:</label>
            <input
              type="range"
              min="0.3"
              max="1.5"
              step="0.05"
              value={placement.scale || 1}
              onChange={(e) => onScaleChange(npcId, e.target.value)}
            />
            <span>{(placement.scale || 1).toFixed(2)}</span>
          </div>
          <div className="edit-panel-row">
            <label>Layer:</label>
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={placement.zIndex ?? 10}
              onChange={(e) => onZIndexChange(npcId, e.target.value)}
            />
            <span>{placement.zIndex ?? 10}</span>
          </div>
          <div className="edit-panel-row">
            <label>Flip:</label>
            <button
              className={`edit-flip-btn ${placement.flipX ? 'active' : ''}`}
              onClick={() => onFlipToggle(npcId)}
            >
              ↔️ {placement.flipX ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="edit-panel-divider">Hitbox</div>
          <div className="edit-panel-row">
            <label>Width:</label>
            <input
              type="range"
              min="20"
              max="200"
              step="5"
              value={placement.hitboxWidth || 60}
              onChange={(e) => onHitboxChange(npcId, 'hitboxWidth', e.target.value)}
            />
            <span>{placement.hitboxWidth || 60}</span>
          </div>
          <div className="edit-panel-row">
            <label>Height:</label>
            <input
              type="range"
              min="30"
              max="300"
              step="5"
              value={placement.hitboxHeight || 120}
              onChange={(e) => onHitboxChange(npcId, 'hitboxHeight', e.target.value)}
            />
            <span>{placement.hitboxHeight || 120}</span>
          </div>
          <div className="edit-panel-row">
            <label>Y Offset:</label>
            <input
              type="range"
              min="0"
              max="80"
              step="5"
              value={placement.hitboxOffsetY || 30}
              onChange={(e) => onHitboxChange(npcId, 'hitboxOffsetY', e.target.value)}
            />
            <span>{placement.hitboxOffsetY || 30}%</span>
          </div>
          <div className="edit-panel-coords">
            X: {placement.x} | Y: {placement.y}
          </div>
        </>
      )}
    </div>
  );
}

// Build pet entries as placement keys (pet:<userId>) for merging into the editor
export function buildPetPlacements(pets) {
  const result = {};
  for (const { userId, pet } of (pets || [])) {
    result[`pet:${userId}`] = pet.placement || { x: 50, y: 15, scale: 0.35 };
  }
  return result;
}

// Split combined placements back into NPC placements and pet placements
export function splitPlacements(combined) {
  const npcPlacements = {};
  const petPlacements = {};
  for (const [key, val] of Object.entries(combined)) {
    if (key.startsWith('pet:')) {
      petPlacements[key.slice(4)] = val;
    } else {
      npcPlacements[key] = val;
    }
  }
  return { npcPlacements, petPlacements };
}

// Unified NPC + Pet renderer for scenes
export function SceneEntities({
  location, pets, placements, particleConfig,
  editMode, editSelectedNpc, onSelect, onDragStart,
  onPetClick
}) {
  // Build pet lookup by their placement key
  const petLookup = useMemo(() => {
    const lookup = {};
    for (const { userId, pet, username } of (pets || [])) {
      lookup[`pet:${userId}`] = { pet, username, userId };
    }
    return lookup;
  }, [pets]);

  return (
    <div className="scene-npcs">
      {Object.entries(placements).map(([id, placement]) => {
        const petInfo = petLookup[id];

        if (petInfo) {
          const { pet, username, userId } = petInfo;
          return (
            <NpcSprite
              key={id}
              npcId={id}
              placement={placement}
              displayName={pet.petName || 'Unnamed'}
              spriteUrl={`/images/sprites/pets/pet_${pet.petType}_${pet.stage}.webp`}
              fallbackEmoji={pet.typeIcon}
              editMode={editMode}
              isSelected={editSelectedNpc === id}
              onSelect={editMode ? onSelect : () => onPetClick?.(userId)}
              onDragStart={onDragStart}
            />
          );
        }

        const npc = location.npcs.find(n => n.id === id);
        const displayName = npc?.displayName || id.charAt(0).toUpperCase() + id.slice(1);

        return (
          <NpcSprite
            key={id}
            npcId={id}
            placement={placement}
            displayName={displayName}
            editMode={editMode}
            isSelected={editSelectedNpc === id}
            particleConfig={particleConfig}
            onSelect={onSelect}
            onDragStart={onDragStart}
          />
        );
      })}
    </div>
  );
}

// Custom hook for edit mode functionality
export function useSceneEditor(initialPlacements) {
  const [editMode, setEditMode] = useState(false);
  const [editPlacements, setEditPlacements] = useState(null);
  const [editSelectedNpc, setEditSelectedNpc] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const sceneRef = useRef(null);

  // Initialize placements when entering edit mode
  const enterEditMode = useCallback((placements) => {
    setEditPlacements({ ...placements });
    setEditMode(true);
  }, []);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setEditSelectedNpc(null);
  }, []);

  const handleDragStart = useCallback((e, npcId) => {
    if (!editMode || !editPlacements || !sceneRef.current) return;
    e.preventDefault();
    
    const rect = sceneRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const currentX = editPlacements[npcId]?.x || 50;
    const currentY = editPlacements[npcId]?.y || 50;
    
    const mouseX = ((clientX - rect.left) / rect.width) * 100;
    const mouseY = ((clientY - rect.top) / rect.height) * 100;
    
    setDragOffset({
      x: mouseX - currentX,
      y: mouseY - currentY
    });
    
    setDragging(npcId);
    setEditSelectedNpc(npcId);
  }, [editMode, editPlacements]);

  const handleDrag = useCallback((e) => {
    if (!dragging || !sceneRef.current || !editPlacements) return;
    
    const rect = sceneRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    const mouseX = ((clientX - rect.left) / rect.width) * 100;
    const mouseY = ((clientY - rect.top) / rect.height) * 100;
    
    const x = mouseX - dragOffset.x;
    const y = mouseY - dragOffset.y;
    
    const current = editPlacements[dragging] || {};
    
    setEditPlacements(prev => ({
      ...prev,
      [dragging]: {
        ...current,
        x: Math.max(0, Math.min(100, Math.round(x))),
        y: Math.max(0, Math.min(100, Math.round(y)))
      }
    }));
  }, [dragging, editPlacements, dragOffset]);

  const handleDragEnd = useCallback(() => {
    setDragging(null);
  }, []);

  const handleScaleChange = useCallback((npcId, scale) => {
    setEditPlacements(prev => ({
      ...prev,
      [npcId]: { ...prev[npcId], scale: parseFloat(scale) }
    }));
  }, []);

  const handleFlipToggle = useCallback((npcId) => {
    setEditPlacements(prev => ({
      ...prev,
      [npcId]: { ...prev[npcId], flipX: !prev[npcId]?.flipX }
    }));
  }, []);

  const handleZIndexChange = useCallback((npcId, zIndex) => {
    setEditPlacements(prev => ({
      ...prev,
      [npcId]: { ...prev[npcId], zIndex: parseInt(zIndex) }
    }));
  }, []);

  const handleHitboxChange = useCallback((npcId, prop, value) => {
    setEditPlacements(prev => ({
      ...prev,
      [npcId]: { ...prev[npcId], [prop]: parseInt(value) }
    }));
  }, []);

  // Attach drag listeners
  useEffect(() => {
    if (!dragging) return;
    
    const handleMove = (e) => handleDrag(e);
    const handleUp = () => handleDragEnd();
    
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [dragging, handleDrag, handleDragEnd]);

  return {
    editMode,
    editPlacements,
    editSelectedNpc,
    saving,
    sceneRef,
    setSaving,
    setEditSelectedNpc,
    setEditPlacements,
    enterEditMode,
    exitEditMode,
    handleDragStart,
    handleScaleChange,
    handleFlipToggle,
    handleZIndexChange,
    handleHitboxChange
  };
}
