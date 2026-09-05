// Tunables for the orb. Colours are sRGB hex; three.js converts them to the
// linear working space, so mixing in the shader happens in linear light.
export const CONFIG = {
  // Orb diameter as a fraction of the shorter viewport side.
  diameter: 0.34,
  // Travel speed in viewport heights per second (DVD-screensaver pace).
  speed: 0.26,
  // Initial heading. Up-right, like the reference (trail streams down-left).
  initialDirection: [1, 0.82],
  // How quickly the gradient re-orients after a bounce (seconds).
  directionSmoothing: 0.1,

  // Wireframe: meridians x parallels, and how visible the lines are.
  grid: { meridians: 24, parallels: 12, strength: 1.0 },
  // Sparkle intensity of the star glints where lines cross a highlight.
  glintStrength: 1.0,

  // Energy trail left behind the orb.
  trail: {
    fade: 0.4, // seconds for the trail to decay to ~37%
    strength: 2.2, // brightness of the deposit behind the orb
    diffuse: 0.5, // how much the trail spreads/softens as it ages
    knee: 0.45, // soft threshold that keeps the faint tail from dragging on
  },

  bloom: { strength: 0.35, radius: 0.3, threshold: 1.0 },

  // Rim colours around the orb, 45 degrees apart, measured from the direction
  // of travel: leading edge first, then anticlockwise, so index 4 is the
  // trailing edge (cyan). With the reference heading (up-right) this puts
  // yellow at the top, pink on the right and cyan at the bottom-left.
  palette: [
    0xf7b89b, // 0   leading edge: peach
    0xf3e2a6, // 45  yellow
    0xf6f1e4, // 90  white-cream
    0xb4eaf6, // 135 light cyan
    0x46d6f4, // 180 trailing edge: cyan
    0x7fa5ec, // 225 periwinkle
    0xc97bd8, // 270 magenta-violet
    0xf26fb2, // 315 pink
  ],
  colors: {
    core: 0xf6eee2, // warm white centre
    white: 0xffffff, // highlight / glint white
    trail: 0x30c6f2, // energy trail
  },
  // The white core sits up and to the left (toward the key light), screen-fixed.
  coreOffset: [-0.12, 0.15],
  coreSize: 0.35, // fully white inside this radius of the offset point
  coreEdge: 0.95, // rim colours take over beyond this

  // Lights are fixed in view space so the rolling grid glistens as it turns.
  // Each is given as the point on the orb's disc where its highlight sits.
  keyLight: [-0.32, 0.45],
  glints: [
    [-0.1, 0.44],
    [0.28, -0.36],
  ],
};
