import * as THREE from 'three';
import { CONFIG } from './config.js';

// The orb is drawn analytically on a single screen-aligned quad: every pixel
// reconstructs the sphere normal, which gives a perfectly anti-aliased
// silhouette, a smooth wireframe with no tessellation, and lets the soft halo
// live in the same shader.

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  #define PI 3.14159265359
  #define TWO_PI 6.28318530718

  varying vec2 vUv;

  uniform vec2  uDir;         // smoothed travel direction (view space)
  uniform mat3  uRotInv;      // view -> orb object space (for the rolling grid)
  uniform mat3  uRot;         // orb object space -> view
  uniform float uRadiusPx;    // orb radius in device pixels
  uniform float uPx;          // line width scale (device pixels per CSS pixel)
  uniform float uQuadScale;   // quad half-size in orb radii
  uniform vec2  uGridDiv;     // meridians, parallels
  uniform float uGridStrength;
  uniform float uGlintStrength;

  uniform vec3 uPal[8];       // rim colours, 45 deg apart, starting at the leading edge
  uniform vec3 uCore;         // warm white core
  uniform vec3 uWhite;        // highlight white
  uniform vec2 uCoreOffset;   // where on the disc the core sits (screen-fixed)
  uniform float uCoreSize;
  uniform float uCoreEdge;

  uniform vec3 uKeyDir;       // broad key light (white core)
  uniform vec3 uGlintA;       // half vectors of the two sparkle lights
  uniform vec3 uGlintB;

  float gauss(float x, float s) { return exp(-(x * x) / (2.0 * s * s)); }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0 * uQuadScale;
    float r = length(p);
    float aa = fwidth(r);
    float cover = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);

    // Point on the unit disc (clamped to the rim outside) and its normal.
    vec2 pc = (r > 1.0) ? p / r : p;
    float nz = sqrt(max(0.0, 1.0 - dot(pc, pc)));
    vec3 n = vec3(pc, nz);

    // ---------- direction-based gradient ----------
    // Angle around the disc measured from the direction of travel:
    // 0 = leading edge, PI = trailing edge (cyan). The palette rotates with
    // the heading; the white core stays put toward the key light.
    vec2 perp = vec2(-uDir.y, uDir.x);
    float f = dot(pc, uDir);
    float sgn = dot(pc, perp);
    float phi = atan(sgn, f);
    float trailW = smoothstep(-0.1, -0.9, f);

    float a = mod(phi / (PI * 0.25) + 8.0, 8.0);
    int i0 = int(floor(a));
    int i1 = (i0 + 1) - 8 * int(i0 == 7);
    float ft = fract(a);
    ft = mix(ft, ft * ft * (3.0 - 2.0 * ft), 0.5);
    vec3 rim = mix(uPal[i0], uPal[i1], ft);

    // Soft warm-white core, offset toward the key light.
    float rEff = length(pc - uCoreOffset);
    float coreW = smoothstep(uCoreEdge, uCoreSize, rEff);
    coreW = coreW * coreW * (3.0 - 2.0 * coreW);
    vec3 col = mix(rim, uCore, coreW);

    // Gentle extra lift toward the key light, rim brightening at the edge.
    float lam = max(dot(n, uKeyDir), 0.0);
    col = mix(col, uWhite, pow(lam, 6.0) * 0.08);
    float fres = pow(1.0 - nz, 3.0);
    col *= 1.0 + fres * 0.15;
    vec3 baseCol = col;

    // ---------- rolling wireframe ----------
    vec3 no = uRotInv * n;
    float lon = atan(no.z, no.x);
    float lat = asin(clamp(no.y, -1.0, 1.0));

    // Screen-space derivatives of longitude computed analytically so the
    // atan seam does not produce a spurious line.
    vec2 dxz = vec2(dFdx(no.x), dFdx(no.z));
    vec2 dyz = vec2(dFdy(no.x), dFdy(no.z));
    float rr = max(dot(no.xz, no.xz), 1e-5);
    float dlon = (abs(no.x * dxz.y - no.z * dxz.x) + abs(no.x * dyz.y - no.z * dyz.x)) / rr;
    float dlat = fwidth(lat) + 1e-6;

    float cm = lon * uGridDiv.x / TWO_PI;
    float cp = lat * uGridDiv.y / PI;
    // Distance (in pixels) to the nearest meridian / parallel.
    float dm = abs(fract(cm + 0.5) - 0.5) / max(dlon * uGridDiv.x / TWO_PI, 1e-5);
    float dp = abs(fract(cp + 0.5) - 0.5) / max(dlat * uGridDiv.y / PI, 1e-5);

    float poleFade = smoothstep(1.0, 0.82, abs(no.y));
    float lw = 0.75 * uPx;
    float lineM = gauss(dm, lw) * poleFade;
    float lineP = gauss(dp, lw);
    float line = max(lineM, lineP);

    // The lines catch the light: faint everywhere, bright in the highlights.
    float specA = pow(max(dot(n, uGlintA), 0.0), 120.0);
    float specB = pow(max(dot(n, uGlintB), 0.0), 120.0);
    float sheen = 0.35 + 0.65 * pow(lam, 2.0);
    float lineI = line * uGridStrength * (0.045 * sheen + 0.1 * (specA + specB));
    col += (uWhite - col) * clamp(lineI, 0.0, 1.0);
    col += uWhite * lineI * 0.35;

    // Four-point star glints where grid crossings pass through a highlight.
    float len = max(uRadiusPx * 0.3, 4.0);
    float armM = exp(-dm / (0.8 * uPx)) * exp(-dp / len);
    float armP = exp(-dp / (0.8 * uPx)) * exp(-dm / len);
    float sc = gauss(sqrt(dm * dm + dp * dp), 1.4 * uPx);
    float star = (armM + armP) * 0.9 + sc * 1.4;
    // Light the whole star by how close its crossing sits to a highlight,
    // so each glint reads as one complete star rather than a lit cell.
    float lonC = floor(cm + 0.5) * TWO_PI / uGridDiv.x;
    float latC = floor(cp + 0.5) * PI / uGridDiv.y;
    vec3 nc = uRot * vec3(cos(latC) * cos(lonC), sin(latC), cos(latC) * sin(lonC));
    float specC = pow(max(dot(nc, uGlintA), 0.0), 120.0) + pow(max(dot(nc, uGlintB), 0.0), 120.0);
    // Crossings bunch up toward the poles; ease the sparkle off there.
    float starFade = smoothstep(0.95, 0.7, abs(no.y));
    float glint = star * specC * starFade * uGlintStrength;
    col += uWhite * glint * 1.6;

    // ---------- halo outside the silhouette ----------
    float rOut = max(r - 1.0, 0.0);
    float win = pow(clamp(1.0 - rOut / (uQuadScale - 1.0), 0.0, 1.0), 2.0);
    float haloI = exp(-rOut * 5.0) * win;
    vec3 halo = baseCol * haloI * (0.2 + 0.55 * trailW) * (1.0 - cover);

    // Premultiplied output: opaque sphere, screen-like halo (adds over black,
    // never overshoots over bright content behind the orb).
    float haloA = clamp(dot(halo, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0) * (1.0 - cover);
    gl_FragColor = vec4(col * cover + halo, cover + haloA);
  }
`;

const QUAD_SCALE = 1.9;

function discPointToVector(xy) {
  const [x, y] = xy;
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  return new THREE.Vector3(x, y, z).normalize();
}

export class Orb {
  constructor() {
    const c = CONFIG.colors;
    this.uniforms = {
      uDir: { value: new THREE.Vector2(1, 0) },
      uRotInv: { value: new THREE.Matrix3() },
      uRot: { value: new THREE.Matrix3() },
      uRadiusPx: { value: 100 },
      uPx: { value: 1 },
      uQuadScale: { value: QUAD_SCALE },
      uGridDiv: { value: new THREE.Vector2(CONFIG.grid.meridians, CONFIG.grid.parallels) },
      uGridStrength: { value: CONFIG.grid.strength },
      uGlintStrength: { value: CONFIG.glintStrength },
      uPal: { value: CONFIG.palette.map((hex) => new THREE.Color(hex)) },
      uCore: { value: new THREE.Color(c.core) },
      uWhite: { value: new THREE.Color(c.white) },
      uCoreOffset: { value: new THREE.Vector2(...CONFIG.coreOffset) },
      uCoreSize: { value: CONFIG.coreSize },
      uCoreEdge: { value: CONFIG.coreEdge },
      uKeyDir: { value: discPointToVector(CONFIG.keyLight) },
      uGlintA: { value: discPointToVector(CONFIG.glints[0]) },
      uGlintB: { value: discPointToVector(CONFIG.glints[1]) },
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
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
  }

  /**
   * @param {number} radius   world units
   * @param {number} radiusPx device pixels
   * @param {number} dpr      device pixels per CSS pixel
   */
  setRadius(radius, radiusPx, dpr) {
    this.mesh.scale.setScalar(2 * radius * QUAD_SCALE);
    this.uniforms.uRadiusPx.value = radiusPx;
    // Lines stay close to one CSS pixel wide on high-density screens.
    this.uniforms.uPx.value = Math.pow(dpr, 0.75);
  }

  update(position, direction, quaternion) {
    this.mesh.position.set(position.x, position.y, 0);
    this.uniforms.uDir.value.copy(direction);
    this._m4.makeRotationFromQuaternion(quaternion);
    this.uniforms.uRot.value.setFromMatrix4(this._m4);
    this._q.copy(quaternion).invert();
    this._m4.makeRotationFromQuaternion(this._q);
    this.uniforms.uRotInv.value.setFromMatrix4(this._m4);
  }
}
