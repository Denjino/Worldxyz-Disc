import * as THREE from 'three';
import { CONFIG } from './config.js';

// Energy trail: a half-resolution feedback buffer. Each frame the previous
// frame is faded, diffused slightly, and a soft cyan glow is deposited on the
// trailing side of the orb. The result follows the orb's actual path, so it
// bends cleanly at every bounce.

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uPrev;
  uniform vec2  uTexel;
  uniform float uDecay;     // per-frame survival factor
  uniform float uDeposit;   // (1 - decay) * strength, keeps it frame-rate independent
  uniform float uSpread;    // diffusion radius in texels
  uniform vec2  uCenter;    // orb centre, world units
  uniform vec2  uDir;       // travel direction
  uniform float uRadius;    // orb radius, world units
  uniform float uAspect;
  uniform vec3  uColor;

  void main() {
    vec2 o = uTexel * uSpread;
    vec3 c = texture2D(uPrev, vUv).rgb * 0.36
           + texture2D(uPrev, vUv + vec2( o.x,  o.y)).rgb * 0.16
           + texture2D(uPrev, vUv + vec2(-o.x,  o.y)).rgb * 0.16
           + texture2D(uPrev, vUv + vec2( o.x, -o.y)).rgb * 0.16
           + texture2D(uPrev, vUv + vec2(-o.x, -o.y)).rgb * 0.16;
    c *= uDecay;

    vec2 w = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
    vec2 q = (w - uCenter) / uRadius;
    float d = length(q);
    float back = smoothstep(0.45, -0.45, dot(q / max(d, 1e-4), uDir));
    float disc = smoothstep(1.2, 0.3, d) * (0.25 + 0.75 * back);
    // A second blob just behind the orb so the trail streams out of its back.
    float d2 = length(q + uDir * 0.6);
    float tail = smoothstep(0.9, 0.0, d2);
    c += uColor * max(disc, tail) * uDeposit;

    gl_FragColor = vec4(c, 1.0);
  }
`;

const displayVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Soft knee: keeps the faint end of the tail from smearing across the screen.
const displayFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform float uKnee;
  void main() {
    vec3 c = texture2D(uMap, vUv).rgb;
    c = c * c / (c + uKnee);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export class Trail {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.uniforms = {
      uPrev: { value: null },
      uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      uDecay: { value: 0.95 },
      uDeposit: { value: 0.05 },
      uSpread: { value: CONFIG.trail.diffuse },
      uCenter: { value: new THREE.Vector2() },
      uDir: { value: new THREE.Vector2(1, 0) },
      uRadius: { value: 0.3 },
      uAspect: { value: 1 },
      uColor: { value: new THREE.Color(CONFIG.colors.trail) },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);

    this.targets = [null, null];
    this.index = 0;

    // Full-screen quad that shows the accumulated trail in the main scene.
    this.displayUniforms = { uMap: { value: null }, uKnee: { value: CONFIG.trail.knee } };
    this.displayMaterial = new THREE.ShaderMaterial({
      uniforms: this.displayUniforms,
      vertexShader: displayVertexShader,
      fragmentShader: displayFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.displayMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.displayMaterial);
    this.displayMesh.renderOrder = 1;
    this.displayMesh.frustumCulled = false;
  }

  resize(width, height, aspect) {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    for (const t of this.targets) t?.dispose();
    this.targets = [0, 1].map(
      () =>
        new THREE.WebGLRenderTarget(w, h, {
          type: THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
          generateMipmaps: false,
        }),
    );
    for (const t of this.targets) {
      this.renderer.setRenderTarget(t);
      this.renderer.clear();
    }
    this.renderer.setRenderTarget(null);
    this.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.uniforms.uAspect.value = aspect;
    this.displayMesh.scale.set(aspect, 1, 1);
    this.index = 0;
  }

  update(dt, position, direction, radius) {
    const read = this.targets[this.index];
    const write = this.targets[1 - this.index];
    const decay = Math.exp(-dt / CONFIG.trail.fade);
    this.uniforms.uPrev.value = read.texture;
    this.uniforms.uDecay.value = decay;
    this.uniforms.uDeposit.value = (1 - decay) * CONFIG.trail.strength;
    this.uniforms.uSpread.value = CONFIG.trail.diffuse * Math.sqrt(Math.max(dt, 1e-4) * 60);
    this.uniforms.uCenter.value.copy(position);
    this.uniforms.uDir.value.copy(direction);
    this.uniforms.uRadius.value = radius;

    this.renderer.setRenderTarget(write);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);

    this.index = 1 - this.index;
    this.displayUniforms.uMap.value = write.texture;
  }
}
