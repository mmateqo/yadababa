"use client";

/* ============================================================================
   The measuring instrument.

   Mounted only for `?qa=1`, so it is absent from every real page load. It hangs
   two things on the window:

     __cine.seek(t)     park the film at a moment and hold it there
     __cine.sample(n)   walk the whole shot and report the geometry

   `sample` drives the real camera code (applyPose) rather than recomputing the
   path, because a QA tool that reimplements what it is checking will happily
   confirm its own arithmetic while the film does something else.

   The apparent-diameter figure is the one the storyboard is written in: the
   planet subtends 2·asin(R/r) radians, and the frame is `fov` radians tall, so
   the fraction of frame height is the ratio of the two. It is measured, not
   assumed — a camera looking away from the planet still reports the size it
   would occupy, which is why the centre coordinates are reported beside it.
   ========================================================================== */

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { applyPose, type CameraTrack } from "@/components/webgl/CinematicCamera";
import { DURATION, EARTH_RADIUS, ROLL, SKY, at } from "@/lib/cinematic";
import { luminance, sampleRamp } from "@/lib/color";
import { clock, seek, stopClock, tick } from "@/lib/clock";

declare global {
  interface Window {
    __cine?: {
      seek: (t: number) => void;
      sample: (n: number) => unknown[];
      duration: number;
    };
  }
}

const _c = new THREE.Vector3();
const _h = new THREE.Vector3();
const _up = new THREE.Vector3();
const _north = new THREE.Vector3();
const _east = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export default function QaBridge({ track }: { track: CameraTrack | null }) {
  const { camera } = useThree();

  useEffect(() => {
    if (!track) return;
    const cam = camera as THREE.PerspectiveCamera;

    window.__cine = {
      duration: DURATION,

      /* Park. The clock is stopped so nothing drifts between the seek and the
         screenshot, and one frame is forced so the parked pose is the one on
         the glass. */
      seek(t: number) {
        stopClock();
        seek(t);
        applyPose(track, cam, t);
        /* the canvas draws on its own loop; the DOM needs telling */
        tick();
      },

      sample(n: number) {
        const out = [];
        for (let i = 0; i < n; i++) {
          const t = (i / (n - 1)) * DURATION;
          applyPose(track, cam, t);
          cam.updateMatrixWorld(true);

          const r = cam.position.length();
          /* half-angle the planet subtends from here */
          const half = Math.asin(Math.min(1, EARTH_RADIUS / r));
          const fovRad = (cam.fov * Math.PI) / 180;

          _c.set(0, 0, 0).project(cam);

          /* Where the horizon crosses the frame. This — not the projected
             centre — is the number the composition is authored in: at a 66°
             apparent diameter the disc's centre is metres off the bottom of
             the frame while the limb sits in the lower third, and estimating
             one from the other assumes an orthographic projection the shot
             does not have.

             The tangent point lies along the ray at angle beta from nadir, at
             distance sqrt(r² − R²). Project it and read the y. */
          _up.copy(cam.position).normalize();
          _east.copy(WORLD_UP).cross(_up);
          if (_east.lengthSq() < 1e-8) _east.set(1, 0, 0);
          _east.normalize();
          _north.copy(_up).cross(_east).normalize();
          _h.copy(_up)
            .multiplyScalar(-Math.cos(half))
            .addScaledVector(_north, Math.sin(half))
            .multiplyScalar(Math.sqrt(Math.max(0, r * r - EARTH_RADIUS * EARTH_RADIUS)))
            .add(cam.position)
            .project(cam);

          out.push({
            t,
            r,
            px: cam.position.x,
            py: cam.position.y,
            pz: cam.position.z,
            diam: (2 * half) / fovRad, // fraction of frame HEIGHT
            cx: (_c.x + 1) / 2,
            cy: (1 - _c.y) / 2,
            hy: (1 - _h.y) / 2,
            fov: cam.fov,
            roll: at(ROLL, t),
            lum: luminance(sampleRamp(SKY, t)),
          });
        }
        /* leave the film where it was */
        applyPose(track, cam, clock.time);
        return out;
      },
    };

    return () => {
      delete window.__cine;
    };
  }, [track, camera]);

  return null;
}
