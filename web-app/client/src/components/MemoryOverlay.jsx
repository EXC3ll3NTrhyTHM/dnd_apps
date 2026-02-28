import { useState, useEffect, useCallback } from 'react';
import { start, stop, subscribe, getSnapshot, getHistory } from '../lib/memoryTracker';
import '../styles/memory-overlay.css';

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function pressureColor(score) {
  if (score < 40) return 'green';
  if (score < 70) return 'yellow';
  return 'red';
}

export default function MemoryOverlay() {
  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState(null);

  useEffect(() => {
    const unsub = subscribe(setSnapshot);
    start();
    // Seed initial state in case start() already took a sample
    const initial = getSnapshot();
    if (initial) setSnapshot(initial);
    return () => { unsub(); stop(); };
  }, []);

  const handleFlushAudio = useCallback(() => {
    // Dynamically import to avoid circular deps
    import('../lib/sceneAudioEngine').then(m => {
      m.stopAll(0);
      m.clearBufferCache();
    });
  }, []);

  if (!snapshot) return null;

  const color = pressureColor(snapshot.pressure);

  if (!expanded) {
    return (
      <div className="memory-overlay" onClick={() => setExpanded(true)}>
        <div className="memory-pill">
          <span className={`memory-pill-dot ${color}`} />
          <span>{snapshot.pressure} &middot; {snapshot.audio.totalMB.toFixed(1)}MB</span>
        </div>
      </div>
    );
  }

  const history = getHistory();
  const { audio, webgl, components } = snapshot;

  return (
    <div className="memory-overlay">
      <div className="memory-panel">
        <div className="memory-panel-header">
          <span className="memory-panel-title">
            Memory <span className={`memory-pill-dot ${color}`} style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }} />
            {' '}{snapshot.pressure}/100
          </span>
          <button className="memory-panel-close" onClick={() => setExpanded(false)}>x</button>
        </div>

        {/* Sparkline */}
        <div className="memory-sparkline">
          {history.map((s, i) => (
            <div
              key={i}
              className={`memory-spark-bar ${pressureColor(s.pressure)}`}
              style={{ height: `${Math.max(2, s.pressure)}%` }}
            />
          ))}
        </div>

        {/* Audio section */}
        <div className="memory-panel-section">
          <div className="memory-section-label">Audio Buffers</div>
          <Row label="Scene" value={`${audio.scene.count} / ${formatMB(audio.scene.bytes)}MB`} />
          <Row label="Arena" value={`${audio.arena.count} / ${formatMB(audio.arena.bytes)}MB`} />
          <Row label="Dice" value={`${audio.dice.count} / ${formatMB(audio.dice.bytes)}MB`} />
          <Row label="UI" value={`${audio.ui.count} / ${formatMB(audio.ui.bytes)}MB`} />
          <Row label="Total" value={`${audio.totalMB.toFixed(1)}MB`} />
        </div>

        {/* WebGL section */}
        <div className="memory-panel-section">
          <div className="memory-section-label">WebGL (Dice)</div>
          <Row label="Textures" value={webgl.textures} />
          <Row label="Created/Disposed" value={`${webgl.totalCreated}/${webgl.totalDisposed}`} />
          <Row label="Rolls" value={webgl.rolls} />
          {webgl.contextLost > 0 && <Row label="Context Lost" value={webgl.contextLost} />}
        </div>

        {/* System section */}
        <div className="memory-panel-section">
          <div className="memory-section-label">System</div>
          <Row label="DOM Nodes" value={snapshot.domNodes} />
          <Row label="Long Tasks/min" value={snapshot.longTasksPerMin} />
          {snapshot.chromeHeapMB && <Row label="JS Heap" value={`${snapshot.chromeHeapMB}MB`} />}
        </div>

        {/* Component metrics */}
        {Object.keys(components).length > 0 && (
          <div className="memory-panel-section">
            <div className="memory-section-label">Components</div>
            {Object.entries(components).map(([key, val]) => (
              <Row key={key} label={key} value={val} />
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="memory-actions">
          <button className="memory-action-btn" onClick={handleFlushAudio}>
            Flush Audio
          </button>
          <button
            className="memory-action-btn"
            onClick={() => { localStorage.removeItem('dh_memory_overlay'); window.location.reload(); }}
          >
            Hide Overlay
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="memory-row">
      <span className="memory-row-label">{label}</span>
      <span className="memory-row-value">{value}</span>
    </div>
  );
}
