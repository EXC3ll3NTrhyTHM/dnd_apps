/**
 * BluntSmokeOverlay - Pure Three.js particle smoke effect
 *
 * Triggered when a user uses a blunt from inventory.
 * Smoke blooms from the center of the screen, expands outward,
 * and fills the screen in a medium-density haze before fading.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// Larger, softer smoke texture for better coverage
function createSmokeTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.3)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

const MAX_PARTICLES = 350;
const EMIT_DURATION = 2;     // seconds of active emission (fast burst)
const TOTAL_DURATION = 5;    // total seconds before calling onDone

export default function BluntSmokeOverlay({ onDone }) {
  const containerRef = useRef(null);
  const onDoneRef = useRef(onDone);
  const [fading, setFading] = useState(false);

  onDoneRef.current = onDone;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // ── Scene setup ──
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, width, height, 0, 0.1, 1000);
    camera.position.z = 10;

    const renderer = new THREE.WebGLRenderer({ alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const texture = createSmokeTexture();

    // ── Particle data (GPU buffers) ──
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);
    const alphas = new Float32Array(MAX_PARTICLES);

    // Per-particle state (CPU only)
    const vx = new Float32Array(MAX_PARTICLES);
    const vy = new Float32Array(MAX_PARTICLES);
    const ages = new Float32Array(MAX_PARTICLES);
    const lifespans = new Float32Array(MAX_PARTICLES);
    const alive = new Uint8Array(MAX_PARTICLES);
    const baseSize = new Float32Array(MAX_PARTICLES);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        pixelRatio: { value: renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying float vAlpha;
        uniform float pixelRatio;
        void main() {
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * pixelRatio;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(0.6, 0.6, 0.6, tex.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // ── Spawn logic ──
    // Bloom from center of screen in all directions
    const cx = width / 2;
    const cy = height / 2;
    let nextSlot = 0;
    let emitting = true;

    function spawn() {
      for (let attempt = 0; attempt < MAX_PARTICLES; attempt++) {
        const i = nextSlot % MAX_PARTICLES;
        nextSlot++;
        if (!alive[i]) {
          // Spawn at center with slight random offset
          positions[i * 3] = cx + (Math.random() - 0.5) * 30;
          positions[i * 3 + 1] = cy + (Math.random() - 0.5) * 30;
          positions[i * 3 + 2] = 0;

          // Radial velocity — random angle, outward from center
          const angle = Math.random() * Math.PI * 2;
          const speed = 100 + Math.random() * 200;
          vx[i] = Math.cos(angle) * speed;
          vy[i] = Math.sin(angle) * speed;

          ages[i] = 0;
          lifespans[i] = 2.5 + Math.random() * 2.5;
          baseSize[i] = 40 + Math.random() * 50;
          alphas[i] = 0;
          sizes[i] = baseSize[i];
          alive[i] = 1;
          return;
        }
      }
    }

    // ── Animation loop ──
    let frameId;
    let lastTime = performance.now();

    function animate() {
      frameId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      if (emitting) {
        for (let s = 0; s < 8; s++) spawn();
      }

      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (!alive[i]) continue;

        ages[i] += dt;
        const t = ages[i] / lifespans[i]; // 0 → 1

        if (t >= 1) {
          alive[i] = 0;
          alphas[i] = 0;
          sizes[i] = 0;
          continue;
        }

        // Slow drift as smoke settles
        vx[i] *= (1 - 0.6 * dt);
        vy[i] *= (1 - 0.6 * dt);

        // Add slight random wander for organic feel
        vx[i] += (Math.random() - 0.5) * 20 * dt;
        vy[i] += (Math.random() - 0.5) * 20 * dt;

        positions[i * 3] += vx[i] * dt;
        positions[i * 3 + 1] += vy[i] * dt;

        sizes[i] = baseSize[i] * (1 + t * 2.5);

        // Fade: quick in, brief hold, then fade
        if (t < 0.05) {
          alphas[i] = (t / 0.05) * 0.3;
        } else if (t < 0.35) {
          alphas[i] = 0.3;
        } else {
          alphas[i] = 0.3 * (1 - (t - 0.35) / 0.65);
        }
      }

      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.size.needsUpdate = true;
      geometry.attributes.alpha.needsUpdate = true;

      renderer.render(scene, camera);
    }
    animate();

    // ── Timers ──
    const stopTimer = setTimeout(() => {
      emitting = false;
      setFading(true);
    }, EMIT_DURATION * 1000);

    const doneTimer = setTimeout(() => {
      onDoneRef.current?.();
    }, TOTAL_DURATION * 1000);

    // ── Cleanup ──
    return () => {
      clearTimeout(stopTimer);
      clearTimeout(doneTimer);
      cancelAnimationFrame(frameId);
      texture.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        opacity: fading ? 0 : 1,
        transition: 'opacity 2s ease-out',
      }}
    />
  );
}
