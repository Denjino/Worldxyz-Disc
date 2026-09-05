import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Final pass: linear -> sRGB plus a hair of dither. The page is mostly soft
// glows on pure black, which is exactly where 8-bit banding shows up.
const DitherOutputShader = {
  name: 'DitherOutputShader',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;

    vec3 linearToSRGB(vec3 c) {
      vec3 lo = c * 12.92;
      vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
      return mix(lo, hi, step(vec3(0.0031308), c));
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = linearToSRGB(clamp(c, 0.0, 1.0));
      float lit = step(0.002, max(c.r, max(c.g, c.b)));
      c += (hash(gl_FragCoord.xy) - 0.5) / 255.0 * lit;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function createOutputPass() {
  const pass = new ShaderPass(DitherOutputShader);
  pass.material.toneMapped = false;
  return pass;
}

