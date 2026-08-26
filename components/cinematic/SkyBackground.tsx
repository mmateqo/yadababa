"use client";

/* ============================================================================
   The field.

   One background-color, written once per frame. Not a gradient, not a
   photograph, not a stack of layers that hand over — and above all not two
   elements crossfading, which is the failure the brief calls out by name: the
   blue at the end has to be the black at the beginning, later, or the arrival
   reads as a new page rather than as the end of a flight.

   It also publishes what it painted, because the clouds in the canvas above it
   have to recede into exactly this colour and the navigation's ink has to cross
   over as it brightens. One source, several readers.
   ========================================================================== */

import { useRef } from "react";
import { cssRgb, luminance, sampleRamp } from "@/lib/color";
import { SKY, type SkyRead } from "@/lib/cinematic";
import { clock, onFrame } from "@/lib/clock";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import s from "./SkyBackground.module.css";

export default function SkyBackground({ sky }: { sky: SkyRead }) {
  const root = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    let lastCss = "";
    return onFrame(() => {
      const c = sampleRamp(SKY, clock.time);
      sky.color[0] = c[0];
      sky.color[1] = c[1];
      sky.color[2] = c[2];
      sky.light = Math.min(1, luminance(c) * 2.6);

      const css = cssRgb(c);
      if (css !== lastCss && root.current) {
        root.current.style.backgroundColor = css;
        lastCss = css;
      }
    });
  }, [sky]);

  return <div ref={root} className={s.root} aria-hidden="true" />;
}
