"use client";

/* ============================================================================
   The film.

   Fourteen and a fifth seconds, one clock, no scroll, no preloader, and nothing
   below it.

   WHAT IS HERE AND WHY IT IS ONLY THIS

     SkyBackground    one element, black to blue, never swapped
     the canvas       camera, stars, planet, atmosphere, clouds
     FinalSkyHero     one heading and one subtitle, at the end

   The order matters: the sky is a DOM element BEHIND a transparent canvas, so
   the blue the film lands on is the same element that was black at the start.
   Painting the final sky as a separate background and crossfading to it is the
   failure the brief names — the arrival stops being the end of a flight and
   becomes a different page.

   NO PRELOADER. The first second and a half of black and stars is the load, and
   the planet's own reveal waits on the GPU (lib/ready.ts) rather than on a
   timer, so nothing is ever shown half-built and no shader links inside the
   approach.

   REDUCED MOTION skips the film entirely and shows the last frame. A fourteen
   second camera move nobody can stop is precisely what the preference is asking
   us not to do.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import CinematicCamera, { type CameraTrack } from "@/components/webgl/CinematicCamera";
import CinematicStars from "@/components/webgl/CinematicStars";
import CinematicEarth from "@/components/webgl/CinematicEarth";
import AtmosphericClouds from "@/components/webgl/AtmosphericClouds";
import QaBridge from "./QaBridge";
import SkyBackground from "./SkyBackground";
import FinalSkyHero from "./FinalSkyHero";
import { PATH, type SkyRead } from "@/lib/cinematic";
import { bindVisibility, finish, startClock, stopClock } from "@/lib/clock";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import s from "./OpeningCinematic.module.css";

function Contents({
  sky,
  mobile,
  qa,
}: {
  sky: SkyRead;
  mobile: boolean;
  qa: boolean;
}) {
  const { viewport, gl, scene, camera } = useThree();
  const dpr = viewport.dpr ?? 1.5;
  const [track, setTrack] = useState<CameraTrack | null>(null);
  const onTrack = useCallback((t: CameraTrack) => setTrack(t), []);

  /* Link every program before the planet is visible. The alternative is a
     hundred-millisecond compile landing somewhere inside the approach, which is
     the one place in the film where a dropped frame is unmissable. */
  useEffect(() => {
    gl.compile(scene, camera);
  }, [gl, scene, camera]);

  return (
    <>
      <CinematicCamera onTrack={qa ? onTrack : undefined} />
      {qa && <QaBridge track={track} />}
      <CinematicStars dpr={dpr} />
      <CinematicEarth quality={mobile ? 0 : 1} sky={sky} />
      <AtmosphericClouds sky={sky} mobile={mobile} />
    </>
  );
}

export default function OpeningCinematic() {
  const mobile = useIsMobile();
  const reduced = useReducedMotion();
  /* The QA harnesses park the film at exact seconds. Nothing about this ships:
     without the flag the bridge is never mounted and the clock is never
     reachable from outside. */
  const [qa] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("qa")
  );
  /* The sky's live value, shared by reference. Not state: it changes every
     frame and is read from a render loop. */
  const sky = useMemo<SkyRead>(() => ({ color: [0, 0, 0], light: 0 }), []);

  useEffect(() => {
    if (qa) return;
    if (reduced) {
      finish();
      return;
    }
    const unbind = bindVisibility();
    startClock();
    return () => {
      stopClock();
      unbind();
    };
  }, [reduced, qa]);

  return (
    <>
      <SkyBackground sky={sky} />
      <div className={s.canvas} aria-hidden="true">
        <Canvas
          dpr={[1, mobile ? 1.4 : 1.75]}
          gl={{
            alpha: true,
            antialias: true,
            powerPreference: "high-performance",
            stencil: false,
            depth: true,
          }}
          camera={{
            fov: 45,
            /* Wide enough for the star shell, tight enough at the near end that
               the depth buffer still resolves the planet's own curvature. The
               camera never comes closer than half a radius to the surface. */
            near: 1,
            far: 15000,
            position: PATH[0] as [number, number, number],
          }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
            /* No global tone curve. The canvas is composited over a CSS colour
               field that nothing is applied to, so a filmic curve here would put
               the sky and the things in it into different colour spaces. The
               planet applies ACES inside its own shader, where it is needed and
               where it cannot leak. */
            gl.toneMapping = THREE.NoToneMapping;
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
          style={{ pointerEvents: "none" }}
          frameloop="always"
        >
          <Contents sky={sky} mobile={mobile} qa={qa} />
        </Canvas>
      </div>
      <FinalSkyHero />
    </>
  );
}
