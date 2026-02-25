import { useState, useEffect } from 'react';
import '../styles/fate-overlay.css';

const FLAVOR_TEXTS = [
  'The threads of fate are being woven...',
  'Destiny holds its breath...',
  'The cosmic scales tip and sway...',
  'Ancient forces shape the outcome...',
  'The stars align in silence...',
  'Fortune turns its gaze upon you...',
];

export default function FateOverlay({ visible }) {
  const [textIndex, setTextIndex] = useState(0);
  const [fading, setFading] = useState(false);

  // Cycle flavor text every 3s
  useEffect(() => {
    if (!visible) return;
    setTextIndex(0);
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setTextIndex(i => (i + 1) % FLAVOR_TEXTS.length);
        setFading(false);
      }, 400);
    }, 3000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fate-overlay">
      <div className="fate-overlay-backdrop" />
      <div className="fate-overlay-content">
        <div className="fate-eye">
          <div className="fate-eye-outer">
            <div className="fate-eye-iris">
              <div className="fate-eye-pupil" />
            </div>
          </div>
          <div className="fate-eye-rays" />
        </div>
        <p className={`fate-text ${fading ? 'fate-text-fading' : ''}`}>
          {FLAVOR_TEXTS[textIndex]}
        </p>
      </div>
    </div>
  );
}
