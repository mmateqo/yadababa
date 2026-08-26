"use client";

/* ============================================================================
   The camera.

   One curve through space, and one rule for where it looks.

   THE CURVE is a centripetal Catmull-Rom. Centripetal, not uniform: a uniform
   spline through points as unevenly spaced as these — three hundred units apart
   at one end, half a unit at the other — loops and cusps.

   WHERE ALONG IT is decided by ALTITUDE, not by a spline parameter. `RADIUS` in
   lib/cinematic.ts says how far from the planet's centre the camera is at each
   moment, because that number is what the viewer actually sees; a table built
   once at startup inverts "radius" into "position along the curve", and the
   runtime cost is a binary search. The long note in lib/cinematic.ts explains
   why the more usual approach — ease a spline parameter, or integrate a speed
   curve — cannot hit a size brief.

   WHERE IT LOOKS is derived from geometry rather than from a second spline of
   hand-placed targets: the score authors what fraction of the way to the
   horizon to look, and asin(R/r) supplies the rest. Past 1 the horizon slides
   out of the bottom of the frame by itself.

   The up vector is the local vertical with the look direction projected out of
   it, which puts the horizon level for free and cannot twist. FRAMING and ROLL
   are then applied as local rotations of the finished camera — see the note
   further down for why doing it to the look direction instead silently does
   nothing at all.
   ========================================================================== */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  at,
  EARTH_RADIUS,
  FOV,
  FRAME_X,
  radiusForFrame,
  FRAME_Y,
  HORIZON_DROP,
  PATH,
  PITCH,
  RADIUS,
  ROLL,
} from "@/lib/cinematic";
import { clock } from "@/lib/clock";

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;

/* Resolution of the radius lookup. The curve is three hundred units long and
   two thousand samples put the table's error under a twentieth of a unit, which
   at the closest approach is a four-hundredth of the altitude. Built once. */
const SAMPLES = 2000;

function buildTrack() {
  const curve = new THREE.CatmullRomCurve3(
    PATH.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    "centripetal"
  );
  curve.arcLengthDivisions = 4000;
  curve.updateArcLengths();

  /* radius at each arc-length fraction. Monotonically decreasing by
     construction — the path only ever closes on the planet — so it can be
     inverted with a binary search. */
  const radii = new Float64Array(SAMPLES);
  const p = new THREE.Vector3();
  for (let i = 0; i < SAMPLES; i++) {
    curve.getPointAt(i / (SAMPLES - 1), p);
    radii[i] = p.length();
  }

  /* Beyond the start of the curve.

     A portrait frame flies the same path from further out (radiusForFrame), and
     asks for altitudes above the one the curve begins at — up to eight hundred
     units against a start of two hundred and ninety-six. Clamping there pins the
     camera and the phone gets the desktop's apparent size for the first several
     seconds.

     Adding an outer control point was the obvious answer and it was wrong: a
     five-hundred-unit segment feeding a six-unit one drags the centripetal
     tangent at the next point badly out of shape, right where the camera is
     accelerating, and peak jerk nearly doubled. Straight-line extrapolation
     along the curve's own start tangent is C1-continuous with it by
     construction, geometrically right — the approach is very nearly radial out
     there — and leaves the authored shape completely untouched.

     P(s) = P0 + d·s with |P(s)| = r is one quadratic. */
  const p0 = curve.getPointAt(0, new THREE.Vector3());
  const outward = curve.getTangentAt(0, new THREE.Vector3()).negate().normalize();
  const p0d = p0.dot(outward);
  const p0sq = p0.lengthSq();
  const outerAt = (r: number, out: THREE.Vector3) => {
    const disc = Math.max(0, p0d * p0d - p0sq + r * r);
    return out.copy(p0).addScaledVector(outward, -p0d + Math.sqrt(disc));
  };

  const uForRadius = (r: number) => {
    if (r >= radii[0]) return 0;
    if (r <= radii[SAMPLES - 1]) return 1;
    let lo = 0;
    let hi = SAMPLES - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (radii[mid] > r) lo = mid;
      else hi = mid;
    }
    const span = radii[lo] - radii[hi];
    const f = span > 1e-9 ? (radii[lo] - r) / span : 0;
    return (lo + f) / (SAMPLES - 1);
  };

  /** The camera's position for an altitude, on the curve or beyond its start. */
  const pointAtRadius = (r: number, out: THREE.Vector3) =>
    r >= radii[0] ? outerAt(r, out) : curve.getPointAt(uForRadius(r), out);

  return { curve, uForRadius, pointAtRadius };
}

export type CameraTrack = ReturnType<typeof buildTrack>;

const _pos = new THREE.Vector3();
const _up = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _look = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _target = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Place a camera at the film's pose for a given moment.
 *
 * Pulled out of the component so the QA tools can drive the identical code —
 * measuring a reimplementation of the camera would measure the
 * reimplementation.
 */
export function applyPose(
  track: CameraTrack,
  cam: THREE.PerspectiveCamera,
  t: number,
  lastFov?: { current: number }
) {
  {
    const fov = at(FOV, t);
    const r = radiusForFrame(at(RADIUS, t), cam.aspect, fov);
    track.pointAtRadius(r, _pos);
    cam.position.copy(_pos);

    // the local frame over the planet
    const dist = Math.max(_pos.length(), EARTH_RADIUS + 0.001);
    _up.copy(_pos).divideScalar(dist);
    _east.copy(WORLD_UP).cross(_up);
    if (_east.lengthSq() < 1e-8) _east.set(1, 0, 0);
    _east.normalize();
    _north.copy(_up).cross(_east).normalize();

    /* beta is the angular radius of the planet from here; the score says what
       fraction of it to look past. */
    const beta = Math.asin(Math.min(1, EARTH_RADIUS / dist));
    const psi = at(PITCH, t) * (beta + HORIZON_DROP * DEG);

    _look
      .copy(_up)
      .multiplyScalar(-Math.cos(psi))
      .addScaledVector(_north, Math.sin(psi));

    _look.normalize();

    /* Up: the local vertical with the look direction projected out. Level
       horizon for free, and it degenerates only when looking exactly at the
       planet's centre — where it tends continuously toward north anyway. */
    _camUp.copy(_up).addScaledVector(_look, -_up.dot(_look));
    if (_camUp.lengthSq() < 1e-8) _camUp.copy(_north);
    _camUp.normalize();

    _target.copy(_pos).add(_look);
    _m.lookAt(_pos, _target, _camUp);
    cam.quaternion.setFromRotationMatrix(_m);

    /* Framing and roll, applied in the camera's OWN basis and only after it is
       built.

       Applying them to the look direction beforehand does nothing, and it is
       worth being precise about why. The up vector above is derived from the
       local vertical, so the nadir — and with it the planet's centre — is
       always inside the camera's vertical plane, and always projects to x = 0.
       Yaw the look direction about the vertical and the up vector yaws with it:
       the whole basis turns and the planet stays dead centre. Measured across
       the approach it never left 50.0% of frame width, which is exactly the
       "it zoomed, it did not fly" failure §90 names.

       A local yaw turns the camera and leaves the planet behind, which is what
       framing means. It is safe to do this to the horizon too, because FRAME_X
       is authored back to zero by 8.6s — before there is a horizon to tilt. */
    const fx = at(FRAME_X, t) * DEG;
    const fy = at(FRAME_Y, t) * DEG;
    const roll = at(ROLL, t) * DEG;
    if (fx !== 0) cam.rotateY(-fx); // positive looks right, so the planet goes left
    if (fy !== 0) cam.rotateX(fy); // positive looks up, so the planet goes down
    if (roll !== 0) cam.rotateZ(roll);

    if (!lastFov || Math.abs(fov - lastFov.current) > 1e-4) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      if (lastFov) lastFov.current = fov;
    }
  }
}

export default function CinematicCamera({
  onTrack,
}: {
  onTrack?: (track: CameraTrack) => void;
}) {
  const { camera } = useThree();
  const track = useMemo(() => buildTrack(), []);
  const lastFov = useRef(-1);

  useEffect(() => onTrack?.(track), [track, onTrack]);

  useFrame(() => {
    applyPose(track, camera as THREE.PerspectiveCamera, clock.time, lastFov);
  }, -10);

  return null;
}
