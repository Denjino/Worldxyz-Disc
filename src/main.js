import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createOutputPass } from './output.js';
import { CONFIG } from './config.js';
import { Orb } from './orb.js';
import { Trail } from './trail.js';
import { Motion } from './motion.js';
import { Word } from './word.js';
import '@fontsource/inter/latin-800.css';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 1);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// World space: the view always spans y in [-1, 1]; x spans [-aspect, aspect].
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);

const orb = new Orb();
const trail = new Trail(renderer);
const motion = new Motion();
const word = new Word();
scene.add(word.mesh);
scene.add(trail.displayMesh);
scene.add(orb.mesh);

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), CONFIG.bloom.strength, CONFIG.bloom.radius, CONFIG.bloom.threshold);
const outputPass = createOutputPass();
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(outputPass);

let radius = 0.3;

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const aspect = width / height;

  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  composer.setPixelRatio(dpr);
  composer.setSize(width, height);
  bloomPass.resolution.set(width, height);

  camera.left = -aspect;
  camera.right = aspect;
  camera.top = 1;
  camera.bottom = -1;
  camera.updateProjectionMatrix();

  // Diameter is a fraction of the shorter side; world height is 2 units.
  radius = CONFIG.diameter * Math.min(aspect, 1);
  const radiusPx = radius * (height * dpr) * 0.5;
  orb.setRadius(radius, radiusPx, dpr);
  motion.setBounds(aspect, 1, radius);
  trail.resize(width * dpr, height * dpr, aspect);
  word.resize(width, height, dpr);
}

window.addEventListener('resize', resize);
resize();

function step(dt) {
  motion.update(dt);
  word.update(dt);
  trail.update(dt, motion.position, motion.direction, radius);
  orb.update(motion.position, motion.direction, motion.quaternion);
  updateCursor();
  composer.render();
}

// ---- tapping the orb ----
const pointer = { x: NaN, y: NaN, type: 'mouse' };

function pointerHitsOrb(clientX, clientY, pointerType) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const x = (((clientX - rect.left) / rect.width) * 2 - 1) * camera.right;
  const y = 1 - ((clientY - rect.top) / rect.height) * 2;
  const tolerance = pointerType === 'touch' ? CONFIG.word.touchHitRadius : CONFIG.word.hitRadius;
  const r = radius * tolerance;
  const dx = x - motion.position.x;
  const dy = y - motion.position.y;
  return dx * dx + dy * dy <= r * r;
}

canvas.addEventListener('pointerdown', (e) => {
  if (pointerHitsOrb(e.clientX, e.clientY, e.pointerType)) word.trigger();
});

canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.type = e.pointerType;
});

canvas.addEventListener('pointerleave', () => {
  pointer.x = NaN;
});

function updateCursor() {
  const hover = pointer.type === 'mouse' && !Number.isNaN(pointer.x) && pointerHitsOrb(pointer.x, pointer.y, 'mouse');
  const cursor = hover ? 'pointer' : '';
  if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
}

let last = performance.now();
let paused = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (!paused) step(dt);
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  last = performance.now();
});

// Optional hooks for deterministic captures: open the page with ?debug.
if (new URLSearchParams(location.search).has('debug')) {
  window.__orb = {
    pause: () => { paused = true; },
    resume: () => { paused = false; last = performance.now(); },
    set: ({ x, y, dx, dy }) => {
      if (x !== undefined) motion.position.set(x, y);
      if (dx !== undefined) {
        motion.velocity.set(dx, dy).normalize();
        motion.direction.copy(motion.velocity);
      }
    },
    tap: () => word.trigger(),
    advance: (seconds, fps = 60) => {
      const n = Math.max(1, Math.round(seconds * fps));
      for (let i = 0; i < n; i++) step(1 / fps);
    },
    state: () => ({
      x: motion.position.x, y: motion.position.y,
      dx: motion.velocity.x, dy: motion.velocity.y,
      q: motion.quaternion.toArray(),
      radius, aspect: camera.right,
    }),
  };
}
