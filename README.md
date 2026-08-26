# SELORA

One shot. Fourteen and a fifth seconds, from black space to a blue sky, and then
it stops.

Black. Sparse stars. A small blue planet, far away, turning. It grows — not
centred and swelling, but crossing the frame as the camera closes on it. The
sphere stops fitting. Curvature. The limb goes blue, the black takes colour, the
first cloud passes, and the film lands on an open sky with one heading on it.

```bash
npm install
npm run dev     # http://localhost:3000
```

`npm run build && npm start` for production. Deploys to Vercel unmodified.

There is no scroll. There is no preloader. There is nothing below the hero.

---

## The four rules everything follows

**One clock, and it is time.** `lib/clock.ts` holds a single number in seconds,
and every value in the film is a function of it. Not scroll, not a spline
parameter, not eleven animations that happen to start together. It pauses with
the tab and resumes without a jump.

**The camera is driven by ALTITUDE, and the altitude is solved.** What the
viewer reads is apparent size — `2·asin(R/r)` — so `RADIUS` in
`lib/cinematic.ts` is the timing authority and the spline supplies only the
shape of the approach. The altitude table itself is the integral of an authored
GROWTH RATE curve, because world-space acceleration is `r(k' − k²)` and a `k`
with a continuous derivative is a camera that cannot kick. Hand-placed keys hit
the same size marks with a 240 u/s² spike at t≈2 and 20 either side of it.

**Nothing crossfades.** The sky is one DOM element behind a transparent canvas,
black at the start and blue at the end, and it is never swapped. The planet
dissolves by mixing toward that element's live colour, so the limb can leave the
frame without anything fading. If two things have to be blended between, the
model is wrong.

**No grain, no noise, no vignette, no HUD.** The only dithering permitted is the
sub-perceptual ordered pattern that breaks 8-bit banding in the atmosphere shell
and the cloud planes. The cloud plates were re-grained at output size until v6;
they are not any more.

---

## What is where

```
lib/cinematic.ts    THE SCORE — every authored value, as a function of time
lib/clock.ts        the one frame callback that owns the film's time
lib/motion.ts       interpolation, and the note explaining why it matters
lib/color.ts        OKLab ramp sampling for the sky
lib/ready.ts        the GPU signal the planet's reveal waits on
lib/assets.ts       every texture path, declared once

components/cinematic/OpeningCinematic.tsx   assembles the three layers
components/cinematic/SkyBackground.tsx      the colour field, in the DOM
components/cinematic/FinalSkyHero.tsx       one heading, one subtitle
components/cinematic/QaBridge.tsx           ?qa=1 only — seek and measure

components/webgl/CinematicCamera.tsx    the curve, the altitude, the framing
components/webgl/CinematicEarth.tsx     three shells: surface, weather, air
components/webgl/CinematicStars.tsx     three depth bands of points
components/webgl/AtmosphericClouds.tsx  three planes riding the camera
components/webgl/shaders/               earth, clouds, atmosphere, stars
```

---

## Measuring it

Everything below was measured with the tools in `/tools`, against
`npm run build && npm start`. `sh tools/serve.sh` does both in the right order —
chaining them the other way leaves a stale server on 3000 while `npm start` dies
with `EADDRINUSE`, and every screenshot after that photographs the old build.

```bash
sh tools/serve.sh            # build, then restart, then wait for a 200
node tools/cine.mjs          # 19-frame contact sheet -> tools/_preview/cine.png
node tools/cine-metrics.mjs  # size, horizon, velocity, acceleration, luminance
node tools/cine-frame.mjs 9.6  # one frame, full size
node tools/qa.mjs            # reduced motion, three phones, WebKit, black, rest
HEADED=1 node tools/perf.mjs # frame pacing on the real GPU
node tools/menu.mjs          # the only interactive thing in the site
```

`?qa=1` mounts `QaBridge`, which exposes `__cine.seek(t)` and `__cine.sample(n)`.
It is absent from every other page load, and `sample` drives the real camera
code rather than a copy of it.

### What those tools currently say

| | |
|---|---|
| storyboard sizes at 2/4/6/8s | 9 / 19 / 45 / 91 vh — brief asks 9 / 20 / 45 / 90 |
| same, on iPhone 13 / SE / iPad portrait | within 4% of desktop, against the frame's tight dimension |
| horizon at the curvature frame | 71% of frame height, on every aspect tested |
| peak camera acceleration / jerk | 115 u/s² / 574 u/s³, one smooth hump, no spikes |
| frame pacing, real GPU | median 8.3ms, p99 10.4ms, 0.1% over 16.7ms across 1670 frames |
| slow frames | three, all before 0.7s, all on a frame that is still black |
| opening black | median 0, p99 1 of 255 — Chromium and WebKit alike |
| after the end | 0.000/255 mean drift, 0 peak, over 2.5s. It stops. |
| reduced motion | last frame, opaque in ~350ms, zero drift after |
| horizontal overflow | 0px at 375, 390, 412, 834 and 1512 wide |

---

## Assets

`ASSETS.md` carries provenance and licences. In short: the planet is NASA Blue
Marble Next Generation with GEBCO bathymetry, public domain, prepared by
`tools/gen-earth-v5.mjs`. The clouds are derived from one film-scanned
photograph by `tools/gen-cloud-objects.mjs`. Nothing here is a full-frame plate
and nothing here contains sky.

---

## Not Apple's film

This recreates the *class* of experience — an oblique approach to Earth ending
in atmosphere — with its own path, its own star field, its own timing, its own
lighting and its own geography. No frame, coordinate, texture or timing is
copied from anyone.
