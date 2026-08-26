# SELORA — house rules

Read `README.md` first; it is short and it is the design brief. The rules below
are the ones most often broken by an edit that looks harmless.

**Nothing may claim to look good without a capture.** `node tools/cine.mjs`
takes a nineteen-frame contact sheet; `node tools/cine-metrics.mjs` reports the
geometry. Both need `sh tools/serve.sh` first, which builds and restarts in the
right order. Judge the capture, never the code.

**The score is `lib/cinematic.ts` and nothing else authors a value.** Every
number the film uses is a keyframe track there, evaluated against one clock. A
magic constant in a component is a value nobody will find when the shot needs
retiming.

**Never use `smootherstep` for a value whose velocity is visible.** Camera
position, camera pitch, apparent size — these take `keyframed(stops, t, "mono")`.
Per-segment easing gives every keyframe a zero-velocity point and the result is
a camera that surges and catches.

**Do not add a `requestAnimationFrame`.** `lib/clock.ts` owns the film's time
and publishes it; R3F owns the canvas. Two clocks disagree within a second.

**The altitude table is solved, not placed.** `RADIUS` is the integral of a
growth-rate curve — see the long note above it. Editing an entry by hand to fix
one frame puts a discontinuity in the second derivative that shows up nowhere in
the stills and everywhere in the motion.

**Author fractions of the geometry, not angles.** `PITCH` is a fraction of the
way to the horizon, so the composition survives every altitude change and every
aspect ratio. `HORIZON_DROP` is the one place a literal angle is allowed.

**Framing must be applied to the finished camera, in its own basis.** The up
vector is derived from the local vertical, so the planet's centre always lies in
the camera's vertical plane: rotating the LOOK direction about the vertical
rotates the basis with it and moves nothing. This is why the planet sat at 50.0%
of frame width for the entire approach and the shot read as a zoom.

**Nothing crossfades.** The sky is one element, from black to blue. The planet
dissolves into that element's live colour. If a fix needs two layers blended
between, the model is wrong.

**No grain, no noise, no vignette, no HUD.** Removed deliberately and completely.
The only dithering permitted is the sub-perceptual ordered pattern that breaks
banding in the atmosphere shell and the cloud planes. The cloud plates carry no
emulsion: `grainAmp` is 0 in `tools/gen-cloud-objects.mjs` and `GRAIN_MIN` and
`GRAIN_MAX` are both 0 so it cannot come back by accident.

**One sun.** `components/webgl/sun.ts`. If a new object needs lighting, it takes
that direction.

**Sample spheres with `textureGrad`, never `textureLod`.** `textureLod` takes
the level it is given rather than deriving it, so `uLod = 0` point-samples a 4K
map onto a few hundred pixels. `sampleSphere` in `shaders/earth.ts` computes
seam-safe derivatives and leaves the bias in your hands.

**Custom shaders are display-referred; standard materials are linear.** The raw
`ShaderMaterial`s here write their final colour straight to the drawing buffer
with no colour-space epilogue, so `setRGB` on their uniforms takes display sRGB
values unconverted. Anything through three's pipeline takes the same numbers
with `THREE.SRGBColorSpace` declared. Getting this backwards is a full stop of
error and it looks like a hard band across the frame.

**A portrait frame is not a cropped landscape one.** The field of view is
vertical. `radiusForFrame` flies the same path from further out so the planet
occupies the same fraction of the frame's tight dimension on any aspect; check
any framing change at 390x844 as well as at 1512x945.

Every claim about performance or smoothness in this repository was measured with
the tools in `/tools`. Do not replace a measurement with an assertion.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
