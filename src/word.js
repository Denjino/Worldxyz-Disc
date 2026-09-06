import * as THREE from 'three';
import { CONFIG } from './config.js';

// The wordmark lives on a plane behind the orb. The text is rasterised into a
// canvas texture (plus a blurred copy), and a small shader animates it: blur
// resolving to sharp as it fades in, a diagonal light sweep that catches the
// bloom, then a soft blur-out. Tapping the orb again restarts the sweep and
// the hold without any visible pop.

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform sampler2D uSoftMap;
  uniform float uAlpha;
  uniform float uBlur;
  uniform float uSweep;
  uniform float uSweepAmt;
  uniform float uSweepWidth;
  uniform vec3  uColor;
  uniform vec3  uTintA;
  uniform vec3  uTintB;

  void main() {
    float sharp = texture2D(uMap, vUv).a;
    float soft = texture2D(uSoftMap, vUv).a;
    float m = mix(sharp, soft, uBlur);

    // Diagonal band of light moving across the word.
    float x = vUv.x + (0.5 - vUv.y) * 0.3;
    float d = (x - uSweep) / uSweepWidth;
    float band = exp(-d * d);
    vec3 tint = mix(uTintA, uTintB, clamp(d * 0.5 + 0.5, 0.0, 1.0));
    vec3 col = uColor + (uColor * 0.2 + tint * 0.1) * band * uSweepAmt;

    float a = m * uAlpha;
    gl_FragColor = vec4(col * a, a);
  }
`;

const MAX_TEXTURE = 4096;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Blurred copy of a canvas. Uses the 2D canvas filter where available and
// falls back to a downsample/upsample chain elsewhere.
function blurCanvas(src, radius) {
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext('2d');
  if ('filter' in ctx) {
    ctx.filter = `blur(${radius.toFixed(1)}px)`;
    ctx.drawImage(src, 0, 0);
    return out;
  }
  let cur = src;
  let w = src.width;
  let h = src.height;
  const steps = Math.max(1, Math.round(Math.log2(Math.max(2, radius))));
  for (let i = 0; i < steps; i++) {
    w = Math.max(1, Math.round(w / 2));
    h = Math.max(1, Math.round(h / 2));
    const c = makeCanvas(w, h);
    const cctx = c.getContext('2d');
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(cur, 0, 0, w, h);
    cur = c;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

function makeTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}

export class Word {
  constructor() {
    const w = CONFIG.word;
    this.uniforms = {
      uMap: { value: null },
      uSoftMap: { value: null },
      uAlpha: { value: 0 },
      uBlur: { value: 1 },
      uSweep: { value: -1 },
      uSweepAmt: { value: 0 },
      uSweepWidth: { value: w.sweepWidth },
      uColor: { value: new THREE.Color(w.color) },
      uTintA: { value: new THREE.Color(w.sweepTint[0]) },
      uTintB: { value: new THREE.Color(w.sweepTint[1]) },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;

    this.active = false;
    this.t = 0;
    this.alpha = 0;
    this.blur = 1;
    this.scale = w.scaleIn;
    this.baseScale = new THREE.Vector2(1, 1);
    this.viewport = { width: 1, height: 1, dpr: 1 };
    this.fontReady = false;

    this.loadFont();
  }

  async loadFont() {
    const w = CONFIG.word;
    try {
      await document.fonts.load(`${w.weight} 100px "${w.font}"`, w.text);
    } catch {
      /* fall through to the system fallback face */
    }
    this.fontReady = true;
    this.rebuild();
  }

  resize(width, height, dpr) {
    this.viewport = { width, height, dpr };
    this.rebuild();
  }

  rebuild() {
    const w = CONFIG.word;
    const { width, height, dpr } = this.viewport;
    const family = `"${w.font}", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;

    // Measure at a reference size to pick a font size that fits the layout.
    const probe = makeCanvas(8, 8).getContext('2d');
    probe.font = `${w.weight} 100px ${family}`;
    if ('letterSpacing' in probe) probe.letterSpacing = w.letterSpacing;
    const pm = probe.measureText(w.text);
    const inkPerEm = ((pm.actualBoundingBoxLeft ?? 0) + (pm.actualBoundingBoxRight ?? pm.width)) / 100;
    const widthFrac = width < height ? w.widthPortrait : w.width;
    const fontPx = Math.min((width * widthFrac) / Math.max(inkPerEm, 0.1), height * w.maxHeight);

    // Rasterise at device resolution, capped to a safe texture size.
    const padX = fontPx * 0.18;
    const padY = fontPx * 0.22;
    const cssW = fontPx * inkPerEm + padX * 2;
    const cssH = fontPx * 1.1 + padY * 2;
    const texScale = Math.min(dpr, MAX_TEXTURE / cssW, MAX_TEXTURE / cssH);

    const canvas = makeCanvas(cssW * texScale, cssH * texScale);
    const ctx = canvas.getContext('2d');
    ctx.scale(texScale, texScale);
    ctx.font = `${w.weight} ${fontPx}px ${family}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = w.letterSpacing;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    const m = ctx.measureText(w.text);
    const ascent = m.actualBoundingBoxAscent ?? fontPx * 0.72;
    const descent = m.actualBoundingBoxDescent ?? fontPx * 0.05;
    const left = m.actualBoundingBoxLeft ?? 0;
    const baseline = padY + ascent + (cssH - padY * 2 - ascent - descent) / 2;
    ctx.fillText(w.text, padX + left, baseline);

    const soft = blurCanvas(canvas, fontPx * texScale * w.blurRadius);

    this.uniforms.uMap.value?.dispose();
    this.uniforms.uSoftMap.value?.dispose();
    this.uniforms.uMap.value = makeTexture(canvas);
    this.uniforms.uSoftMap.value = makeTexture(soft);

    // World height is 2 units; convert the CSS-pixel quad to world units.
    const unitsPerPx = 2 / height;
    this.baseScale.set(cssW * unitsPerPx, cssH * unitsPerPx);
    this.applyScale();
  }

  applyScale() {
    this.mesh.scale.set(this.baseScale.x * this.scale, this.baseScale.y * this.scale, 1);
  }

  trigger() {
    const w = CONFIG.word;
    if (!this.active) {
      this.alpha = 0;
      this.blur = 1;
      this.scale = w.scaleIn;
    }
    this.active = true;
    this.t = 0;
    this.mesh.visible = true;
  }

  update(dt) {
    if (!this.active) return;
    const w = CONFIG.word;
    this.t += dt;
    const showing = this.t < w.show + w.hold;

    const ease = (tau) => 1 - Math.exp(-dt / tau);
    this.alpha += ((showing ? 1 : 0) - this.alpha) * ease(showing ? w.show * 0.32 : w.hide * 0.36);
    this.blur += ((showing ? 0 : 1) - this.blur) * ease(showing ? w.show * 0.45 : w.hide * 0.6);
    this.scale += ((showing ? 1 : w.scaleOut) - this.scale) * ease(showing ? w.show * 0.5 : w.hide * 0.6);

    const st = (this.t - w.sweepDelay) / w.sweepDuration;
    const sweepAmt = st <= 0 || st >= 1 ? 0 : Math.sin(st * Math.PI);

    if (!showing && this.alpha < 0.003) {
      this.active = false;
      this.mesh.visible = false;
      this.alpha = 0;
    }

    this.uniforms.uAlpha.value = this.alpha;
    this.uniforms.uBlur.value = this.blur;
    this.uniforms.uSweep.value = -0.25 + st * 1.5;
    this.uniforms.uSweepAmt.value = sweepAmt;
    this.applyScale();
  }
}
