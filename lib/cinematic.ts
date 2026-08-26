/* ============================================================================
   SELORA — the shot.

   Fourteen and a fifth seconds, from black space to a blue sky, authored here
   and nowhere else. Every value the film uses is a function of ONE number —
   `time`, in seconds from 0 — so there is one film rather than a dozen
   animations that happen to start together.

   THE ONE THING WORTH READING

   The camera is not driven by easing a spline parameter, and it is not driven
   by integrating a velocity curve either. It is driven by ALTITUDE.

   `RADIUS` below says how far the camera is from the planet's centre at each
   moment, and that single table is what the viewer actually sees: apparent size
   is 2·asin(R/r), so authoring r is authoring the shot. The alternative — pick
   control points, integrate a speed curve, and hope — was tried, and it cannot
   hit a size brief: a speed profile that peaks in the middle spends half its
   distance in the last third of the film, by which point the remaining distance
   to cover is five per cent of the journey. The two are not reconcilable, and
   the size is the one the audience is watching.

   So the SPLINE supplies the shape of the approach — where the camera swings to
   as it closes, which limb it favours — and the RADIUS table supplies the
   timing. At runtime the radius is looked up, and the point on the curve with
   that radius is found by inverting a table built once at startup. The result
   is exact size control on a smooth authored path, and a world-space velocity
   that is continuous because both inputs are monotone cubics.

   Nothing here knows about React, three.js, or the DOM.
   ========================================================================== */

import { keyframed, type Keyframe } from "./motion";
import type { ColorStop } from "./color";

/** The whole film, in seconds. */
export const DURATION = 14.2;

/** Planet radius, in scene units. Everything else is expressed against it. */
export const EARTH_RADIUS = 10;

/* ── altitude ───────────────────────────────────────────────────────────────
   Distance from the planet's centre, in scene units.

   These numbers are SOLVED, not placed. An approach reads by how fast the
   planet is growing, not by how fast the camera is moving, and growth rate is
   d(ln θ)/dt — which for a small disc (θ ≈ 2R/r) is exactly r' = -k·r. So the
   shot was authored as a curve for k: zero while the stars establish, easing in
   over two seconds, a flat cruise through the strongest part of the approach,
   then easing away to nothing as the planet fills the frame. Integrating that
   gives the table below.

   Two things fall out of doing it this way rather than by hand. World-space
   acceleration is r(k' − k²), so a k with a continuous derivative is a camera
   with continuous acceleration — the jumpiness question, answered at the source
   rather than smoothed over afterwards. And the ease-in and the ease-out of the
   entire flight become one number's ramp up and down, so they cannot disagree.

   Hand-placed keys were tried first. They hit the size marks and produced a
   240 u/s² acceleration spike at t≈2 with 20 either side of it: a visible kick
   into motion that no amount of interpolation choice removes, because it was
   in the data. Solving for k drops the peak to 112 and the peak jerk from 1718
   to 362.

   It lands within 1.7% of the storyboard's marks:

     2.0s    9 vh   the planet is readable, and still tiny in a black frame
     4.0s   19 vh   the approach is unmistakable
     6.0s   45 vh   a body rather than a globe
     8.0s   90 vh   edges reaching the frame
     9.6s  133 vh   curvature — the whole sphere no longer fits, or reads
     after          altitude falls slowly; the motion becomes atmospheric
   ─────────────────────────────────────────────────────────────────────────── */
export const RADIUS: Keyframe[] = [
  [0.0, 296.0],
  [0.8, 296.0],
  [1.4, 295.8],
  [1.8, 290.05],
  [2.2, 268.86],
  [2.6, 234.9],
  [3.0, 200.41],
  [3.4, 170.78],
  [3.8, 145.53],
  [4.2, 124.01],
  [4.6, 105.67],
  [5.0, 90.05],
  [5.5, 73.73],
  [6.0, 60.36],
  [6.5, 49.58],
  [7.0, 41.33],
  [7.5, 35.38],
  [8.0, 31.14],
  [8.5, 27.9],
  [9.0, 25.11],
  [9.6, 22.31],
  [10.2, 20.5],
  [10.8, 19.6],
  [11.4, 19.03],
  [12.0, 18.54],
  [12.6, 18.25],
  [13.2, 18.16],
  [13.8, 18.12],
  [DURATION, 18.09],
];

/* ── the path ───────────────────────────────────────────────────────────────
   Control points for a centripetal Catmull-Rom, sampled by ARC LENGTH. Only
   their DIRECTION from the origin matters — the radius table decides where
   along the curve the camera is at any moment — so these describe the shape of
   the approach and nothing else.

   Their radii are still not arbitrary: the last one has to sit BELOW the
   smallest altitude the film ever asks for, or the radius→arc-length inversion
   runs off the end of the curve and clamps. That bug froze the final three
   seconds of the shot completely, and it is invisible in every still — only a
   velocity trace shows it. The tail closes to 17.4 against a floor of 18.09.

   The shape: the camera starts a little to the left and above the ecliptic,
   crosses over as it closes, and finishes well to the right and slightly below,
   aimed past the planet rather than at it. That crossing is what makes this an
   approach instead of a zoom; a straight line in would grow the planet without
   ever moving it, and §90 of the brief is exactly that failure.
   ─────────────────────────────────────────────────────────────────────────── */
export const PATH: [number, number, number][] = [
  [-11.4, 12.6, 295.51],
  [-8.58, 9.81, 289.76],
  [-4.66, 7.46, 200.22],
  [-1.59, 4.55, 134.25],
  [1.32, 2.42, 90.01],
  [2.75, 1.59, 60.28],
  [3.94, 0.89, 41.14],
  [4.85, 0.37, 30.76],
  [5.81, 0.05, 26.69],
  [7.17, -0.34, 21.12],
  [7.32, -0.55, 18.42],
  [7.63, -0.67, 17.23],
  [7.3, -0.69, 15.77],
];

/* ── where it looks ─────────────────────────────────────────────────────────
   Not a second spline of hand-placed targets. The look direction is derived
   from the geometry, because the composition this shot has to land on IS
   geometric: the planet's horizon, sitting a fixed fraction of the way down the
   frame, level.

   From a camera at distance r, the planet is a disc of angular radius
   asin(R/r) centred on the nadir. So "look at the horizon" means "look that far
   away from nadir", and PITCH authors a FRACTION of that angle rather than the
   angle itself. Author the angle and the composition drifts every time the
   altitude is re-tuned; author the fraction and the horizon lands on the same
   line of the frame at any altitude the film happens to have.

     0    straight at the planet — it is an object floating in space
     1    the horizon sits `HORIZON_DROP` below the middle of the frame
     >1   the horizon has left the bottom and the frame is all sky

   Past 1 the curvature slides out of the picture on its own. That single number
   is the entire transition from looking at a planet to being inside its air,
   and it is why nothing has to fade.

   The tail is timed against EARTH_HAZE rather than against the clock. Pitched up
   faster, the horizon left the bottom of the frame at 11.2s while the haze was
   still only two thirds of the way in, and the shot spent a second on an empty
   grey sky with nothing in it — the planet had not become the sky, it had
   simply gone. Held until about 12.1s the limb is nearly the sky's own colour by
   the time it leaves, and the hand-off is invisible.
   ─────────────────────────────────────────────────────────────────────────── */
export const PITCH: Keyframe[] = [
  [0, 0],
  [5.0, 0.06],
  [7.0, 0.26],
  [8.2, 0.56],
  [9.0, 0.84],
  [9.6, 1.0],
  [10.4, 1.08],
  [11.4, 1.2],
  [12.4, 1.34],
  [13.4, 1.48],
  [DURATION, 1.56],
];

/** How far below the middle of the frame the horizon rests at pitch 1, in degrees. */
export const HORIZON_DROP = 8;

/* Rotations of the look direction, in degrees, that hold the planet off the
   centre of the frame while it is still an object rather than a place. Positive
   frameX looks right, which puts the planet LEFT.

   These are not a garnish. Measured at ±3 degrees the planet's centre sat
   within one per cent of frame centre for the entire approach: it grew and
   never moved, which is the difference between flying toward something and
   zooming at it, and it is the one failure the brief calls out by name. Starting
   near nine degrees puts the planet a third of the way in from the left edge
   and walks it to centre as the camera closes, so the approach reads as travel
   even in a single still. */
export const FRAME_X: Keyframe[] = [
  [0, 8.6],
  [3.0, 7.4],
  [5.0, 5.2],
  [7.0, 2.4],
  [8.6, 0],
  [DURATION, 0],
];
export const FRAME_Y: Keyframe[] = [
  [0, -3.1],
  [4.0, -2.4],
  [6.0, -1.2],
  [8.0, 0.6],
  [DURATION, 0],
];

/* ── optics ─────────────────────────────────────────────────────────────────
   The field of view is not the zoom. It moves five degrees across fourteen
   seconds, slowly enough that nobody sees it happen, and its only job is to
   tighten fractionally as the frame gets busier.
   ─────────────────────────────────────────────────────────────────────────── */
export const FOV: Keyframe[] = [
  [0, 45],
  [4, 44],
  [7, 42],
  [10, 40],
  [12, 39],
  [DURATION, 40],
];

/* Artistic roll, in degrees. It exists so the strongest part of the approach
   is not perfectly level, and it is gone before the curvature frame — a horizon
   that arrives tilted looks like a mistake, not like a choice. Two degrees.
   Anything more is a drone. */
export const ROLL: Keyframe[] = [
  [0, 0],
  [4.5, 0],
  [5.5, 0.8],
  [6.5, 1.6],
  [7.3, 2.2],
  [8.2, 1.8],
  [9.0, 0.8],
  [9.7, 0],
  [DURATION, 0],
];

/* ── the planet ─────────────────────────────────────────────────────────────
   It turns at a constant half-degree a second and never changes rate. Total
   visible rotation across the film is about eight degrees: enough that it is
   unmistakably an object rotating in space, far too little to read as a
   turntable. The camera makes the drama; the planet stays majestic.
   ─────────────────────────────────────────────────────────────────────────── */
export const EARTH_SPIN_DEG_PER_SEC = 0.55;
/** Where the visible face starts, in radians. Chosen so the Atlantic, Europe
    and west Africa are square to the camera through the strongest approach. */
export const EARTH_START_ROTATION = 2.42;
/** Visual axial tilt, in degrees. Fixed — never animated, never wobbling. */
export const EARTH_TILT = 22.5;
/** The weather turns fractionally faster than the ground it sits over. */
export const CLOUD_SPIN_RATIO = 1.02;

/* Haze between the camera and the surface. Nothing here fades the planet out;
   this is the air thickening in front of it as the altitude falls, and it is
   most of why the geometry can simply stop being relevant. */
export const EARTH_HAZE: Keyframe[] = [
  [0, 0],
  [8.0, 0.02],
  [9.6, 0.1],
  [10.6, 0.3],
  [11.4, 0.62],
  [12.2, 0.9],
  [12.8, 1],
];

/** Scattering strength of the atmosphere shell. */
export const ATMO_INTENSITY: Keyframe[] = [
  [0, 0.5],
  [4, 0.62],
  [7, 0.8],
  [9.6, 0.95],
  [11.0, 0.8],
  [12.4, 0],
];

/** Renderer exposure. A very slight lift as the world becomes daylight. */
export const EXPOSURE: Keyframe[] = [
  [0, 0.92],
  [8, 0.93],
  [9, 0.95],
  [10.5, 1.0],
  [12, 1.03],
  [DURATION, 1.0],
];

/* ── the sky ────────────────────────────────────────────────────────────────
   One field, present from the first frame, black, changing colour continuously.
   It is never swapped for another background and it never crossfades — the blue
   at the end is this same element, later.
   ─────────────────────────────────────────────────────────────────────────── */
export const SKY: ColorStop[] = [
  [0, "#000000"],
  [8.4, "#000000"],
  [9.2, "#010205"],
  [9.8, "#020713"],
  [10.3, "#041126"],
  [10.8, "#062443"],
  [11.3, "#0a416d"],
  [11.8, "#0f6799"],
  [12.3, "#2390bf"],
  [12.9, "#55aed3"],
  [13.6, "#76bfe0"],
  [DURATION, "#76bfe0"],
];

/* Stars do not switch off. They lose contrast because the air in front of them
   starts scattering light, which is the same reason they disappear at dawn. */
export const STAR_VISIBILITY: Keyframe[] = [
  [0, 0],
  [0.35, 1],
  [7.0, 1],
  [8.0, 0.95],
  [9.0, 0.78],
  [10.0, 0.42],
  [10.8, 0.12],
  [11.5, 0],
];

/** The planet fades in over the first second — never as an opacity ramp anyone
    can see, because there is nothing behind it but black. */
export const EARTH_REVEAL: Keyframe[] = [
  [0, 0],
  [0.5, 0.12],
  [1.2, 0.72],
  [1.8, 1],
];

/* ── the clouds ─────────────────────────────────────────────────────────────
   Three layers and no more: a far deck that sells altitude, one mid form, and
   one near mass that passes through an edge. Each is a presence curve; their
   geometry lives in the component.

   Nothing appears before 10.6s, and the reason is worth keeping. These planes
   ride six units in front of the camera, so at the curvature frame they sit two
   radii above the ground — in space. Fading them up there put soft grey blotches
   across the black half of the film's strongest still, which does not read as
   weather at all: it reads as a dirty lens. They arrive once the sky itself has
   started to take colour, and not one frame before.
   ─────────────────────────────────────────────────────────────────────────── */
export const DECK: Keyframe[] = [
  [10.6, 0],
  [11.4, 0.55],
  [12.2, 0.8],
  [13.0, 0.5],
  [13.8, 0],
];
export const CLOUD_MID: Keyframe[] = [
  [11.0, 0],
  [11.9, 0.72],
  [12.9, 0.95],
  [DURATION, 0.95],
];
export const CLOUD_NEAR: Keyframe[] = [
  [11.6, 0],
  [12.4, 0.9],
  [13.2, 0.95],
  [DURATION, 0.95],
];

/* ── framing for a frame that is not 16:9 ───────────────────────────────────
   The field of view is VERTICAL, so a portrait window does not crop the sides
   off the desktop shot — it has a different, much narrower horizontal cone, and
   the planet reaches the edges of it seconds earlier. On a phone the whole
   sphere filled the frame by 7.2s and the curvature beat, which the storyboard
   places at 9.6s, had already happened and gone.

   The fix is one idea: fly the same path from further out, by exactly enough
   that the planet occupies the same fraction of the frame's TIGHT dimension —
   height in landscape, width in portrait. That is the fraction the eye reads as
   "how close are we", and matching it is what makes the two shots the same
   film rather than two different ones.

   It is solved, not approximated. The planet's angular radius is asin(R/r), so
   asking for a given fraction of the narrow half-cone gives r directly. A power
   law was tried first and undershot by half: at 0.55 the phone still had the
   sphere overflowing the frame at 8s.

   Everything else in the score is an angle or a fraction of the horizon, so
   nothing else needs a mobile variant — at pitch 1 the horizon sits
   HORIZON_DROP below the axis whatever the altitude, so the curvature frame is
   composed identically on both.
   ─────────────────────────────────────────────────────────────────────────── */
export function radiusForFrame(
  radius: number,
  aspect: number,
  fovDeg: number
): number {
  const vert = (fovDeg * Math.PI) / 360;
  const horiz = Math.atan(aspect * Math.tan(vert));
  if (horiz >= vert) return radius; // landscape: height is already the tight one
  const beta = Math.asin(Math.min(1, EARTH_RADIUS / radius)) * (horiz / vert);
  return EARTH_RADIUS / Math.max(Math.sin(beta), EARTH_RADIUS / 800);
}

/* ── the interface ──────────────────────────────────────────────────────────
   Two things, and both wait. The navigation's ink crosses from white to near
   black while the sky does; the copy does not begin until the camera has all
   but stopped, because a line of type arriving during movement is a caption.
   ─────────────────────────────────────────────────────────────────────────── */
export const NAV_DARK: Keyframe[] = [
  [0, 0],
  [10.4, 0],
  [11.0, 0.15],
  [11.5, 0.4],
  [12.0, 0.7],
  [12.5, 1],
];

export const COPY: Keyframe[] = [
  [12.5, 0],
  [12.8, 0.25],
  [13.1, 0.65],
  [13.5, 0.95],
  [13.7, 1],
];
export const SUBTITLE_DELAY = 0.18;

/** The sky, as the rest of the film reads it. A live reference — never copied. */
export interface SkyRead {
  /** display-referred sRGB, 0..1 */
  color: [number, number, number];
  /** 0 the world is dark, 1 the world is bright */
  light: number;
}

/* ── evaluation ─────────────────────────────────────────────────────────────
   Every continuous track is monotone cubic. Per-segment easing gives each
   control point a zero-velocity moment, and on a camera that reads as a series
   of little surges and catches — see the note at the top of lib/motion.ts.
   ─────────────────────────────────────────────────────────────────────────── */
export const at = (track: Keyframe[], t: number) => keyframed(track, t, "mono");
