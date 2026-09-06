# Orb

A glowing pastel orb that rolls around a black screen and bounces off the
edges, DVD-screensaver style. Rendered with [three.js](https://threejs.org).

- **Gradient** follows the direction of travel: cyan streams off the trailing
  edge, pink and peach lead, with a soft warm-white core that stays toward the
  key light. The rim palette lives in `src/config.js` as eight colours, 45
  degrees apart, measured from the heading.
- **Wireframe** is a subtle latitude/longitude grid that rolls with the sphere
  (no slip: it turns by distance travelled over radius). Where a grid crossing
  rolls through one of the two fixed highlights it flares into a four-point
  glint, so the lines glisten as the orb turns.
- **Trail** is a half-resolution feedback buffer: each frame fades, diffuses
  and re-deposits a cyan glow behind the orb, so the trail bends cleanly at
  every bounce.
- **Post** is a light bloom and a dithered linear-to-sRGB output pass, which
  keeps the soft glows from banding on pure black.
- **Tap the orb** and the `world` wordmark resolves out of a blur behind it,
  a soft light sweep crosses the letters, then it fades away. Every tap
  restarts the sweep and the hold, so it can be triggered as often as you like.
  The face is Inter 800 (self-hosted via `@fontsource/inter`); to use the brand
  typeface instead, add its `@font-face` and change `word.font` in the config.

The sphere itself is drawn analytically on a single quad (the fragment shader
reconstructs the surface normal per pixel), which gives a perfectly
anti-aliased silhouette and smooth grid lines at any size.

## Run locally

```sh
npm install
npm run dev
```

## Deploy

This is a plain [Vite](https://vite.dev) project. Connect the repository to
Vercel and accept the detected defaults (build `vite build`, output `dist`).

## Tuning

Everything worth tweaking is in `src/config.js`: orb size, speed, initial
heading, grid density, glint strength, trail length and brightness, bloom, the
palette, and the wordmark (font, size, timings, sweep, tap tolerance).

Open the page with `?debug` to get `window.__orb` (`pause`, `resume`, `set`,
`advance`, `tap`, `state`) for deterministic captures.
