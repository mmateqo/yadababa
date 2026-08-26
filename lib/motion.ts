/* ============================================================================
   SELORA — small maths vocabulary shared by DOM motion and WebGL uniforms.

   The one thing in here worth reading is the interpolation section. Everything
   else is arithmetic.
   ========================================================================== */

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const invLerp = (a: number, b: number, v: number) =>
  a === b ? 0 : clamp((v - a) / (b - a));

export const mapRange = (
  v: number,
  inA: number,
  inB: number,
  outA: number,
  outB: number
) => lerp(outA, outB, invLerp(inA, inB, v));

export const smoothstep = (a: number, b: number, v: number) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};

export const smootherstep = (a: number, b: number, v: number) => {
  const t = invLerp(a, b, v);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Frame-rate independent exponential approach. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

/* ══════════════════════════ interpolation ═══════════════════════════════════

   THE PROBLEM THIS SECTION EXISTS TO SOLVE

   Every environmental value in this site is a table of keyframes against scroll
   position, and for four versions every one of them was evaluated with
   smootherstep between neighbouring stops.

   Smootherstep has zero first derivative at BOTH ends of its interval. So a
   track of six keyframes did not describe one continuous movement — it
   described five separate movements, each of which accelerated from a standstill
   and then braked to a standstill again. Position was continuous; VELOCITY was
   a sawtooth. On a camera that closes from forty units to one and a half across
   two thousand viewport-heights, that reads exactly as it sounds: a series of
   little surges and catches, a pulse at every control point the author never
   wrote and could not see in the numbers.

   That is the "jumpiness" this file is the fix for. It is not a scroll problem
   and no amount of smoothing upstream can hide it, because the pulse is a
   property of the curve, not of the input.

   THE FIX

   `mono` — Fritsch–Carlson monotone cubic Hermite interpolation. It passes
   through every authored value exactly, it has a CONTINUOUS first derivative
   across the whole track, and — unlike a plain Catmull-Rom spline — it cannot
   overshoot, so a camera distance authored as monotonically decreasing never
   creeps back toward the viewer between two stops.

   WHICH MODE FOR WHAT

     mono     camera distance, camera bias and roll, ground travel, anything
              whose VELOCITY is visible. This is the default for continuous
              world travel.
     smooth   opacity, tint amount, density — anything where the
              eye reads the VALUE and not its rate of change. Smootherstep's
              settle at each end is a feature there: a fade that eases in and
              out at every stop is what makes a crossfade feel authored.
     linear   values that are re-eased downstream, or that must scrub exactly.

   Choose deliberately. Using one everywhere is what produced the problem.
   ────────────────────────────────────────────────────────────────────────── */

export type Keyframe = [at: number, value: number];

export type Interp = "smooth" | "mono" | "linear";

/**
 * Fritsch–Carlson tangents for one keyframe table.
 *
 * O(n) and pure, so it is computed once per table and cached against the table
 * itself. Score tables are built once per breakpoint and never mutated, which
 * makes a WeakMap the right store: when a score is rebuilt for a new breakpoint
 * the old tangents become garbage with it.
 */
const tangentCache = new WeakMap<Keyframe[], Float64Array>();

function tangentsFor(stops: Keyframe[]): Float64Array {
  const hit = tangentCache.get(stops);
  if (hit) return hit;

  const n = stops.length;
  const m = new Float64Array(n);
  if (n < 2) {
    tangentCache.set(stops, m);
    return m;
  }

  const d = new Float64Array(n - 1); // secant slopes
  for (let i = 0; i < n - 1; i++) {
    const h = stops[i + 1][0] - stops[i][0];
    d[i] = h === 0 ? 0 : (stops[i + 1][1] - stops[i][1]) / h;
  }

  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] + d[i]) * 0.5;

  /* The monotonicity filter. Without it this is an ordinary cubic Hermite and
     it will overshoot: a camera authored to arrive at 1.6 would dip past it and
     come back, which on screen is the planet growing, shrinking a hair, and
     growing again. */
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  tangentCache.set(stops, m);
  return m;
}

/**
 * Piecewise keyframe evaluation.
 *
 * Outside the table the value is held — every track in this site is authored
 * with explicit endpoints, and extrapolating a spline past its last control
 * point is how a camera ends up behind the planet.
 */
export function keyframed(
  stops: Keyframe[],
  t: number,
  mode: Interp = "smooth"
): number {
  const n = stops.length;
  if (!n) return 0;
  if (t <= stops[0][0]) return stops[0][1];
  const last = stops[n - 1];
  if (t >= last[0]) return last[1];

  // binary search: camera tables are short, but this runs for every track,
  // every layer, every frame
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stops[mid][0] <= t) lo = mid;
    else hi = mid;
  }

  const [x0, y0] = stops[lo];
  const [x1, y1] = stops[hi];
  const h = x1 - x0;
  if (h <= 0) return y1;
  const u = (t - x0) / h;

  if (mode === "linear") return y0 + (y1 - y0) * u;
  if (mode === "smooth") return y0 + (y1 - y0) * (u * u * u * (u * (u * 6 - 15) + 10));

  const m = tangentsFor(stops);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * y0 + h10 * h * m[lo] + h01 * y1 + h11 * h * m[hi];
}

/** 1 inside [from,to] with soft shoulders — the standard layer visibility ramp. */
export function window01(
  t: number,
  from: number,
  to: number,
  fadeIn = 0.12,
  fadeOut = 0.12
) {
  const rise = smoothstep(from, from + fadeIn, t);
  const fall = 1 - smoothstep(to - fadeOut, to, t);
  return clamp(Math.min(rise, fall));
}
