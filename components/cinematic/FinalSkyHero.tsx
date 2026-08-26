"use client";

/* ============================================================================
   The heading.

   It does not exist until the camera has all but stopped. A line of type
   arriving while the world is still moving is a caption on a video; arriving
   after it has settled, it is the first piece of interface in a place the
   viewer has just been taken to.

   Whole blocks, not characters. Twelve pixels of rise, no blur, no scale, no
   stagger — every one of those would be an effect competing with fourteen
   seconds of actual movement.
   ========================================================================== */

import { useRef } from "react";
import { at, COPY, SUBTITLE_DELAY } from "@/lib/cinematic";
import { clock, onFrame } from "@/lib/clock";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import s from "./FinalSkyHero.module.css";

export default function FinalSkyHero() {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useIsomorphicLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const parts = Array.from(el.querySelectorAll<HTMLElement>("[data-copy]"));

    if (reduced) {
      for (const p of parts) {
        p.style.opacity = "1";
        p.style.transform = "none";
      }
      return;
    }

    let last = -1;
    return onFrame(() => {
      const t = clock.time;
      const a = at(COPY, t);
      const b = at(COPY, t - SUBTITLE_DELAY);
      if (Math.abs(a - last) < 0.0015) return;
      last = a;
      for (const p of parts) {
        const v = p.dataset.copy === "late" ? b : a;
        p.style.opacity = v.toFixed(3);
        p.style.transform = `translate3d(0, ${((1 - v) * 12).toFixed(2)}px, 0)`;
      }
    });
  }, [reduced]);

  return (
    <div ref={root} className={s.root}>
      <div className={s.inner}>
        <span className={s.eyebrow} data-copy="early">
          Selora
        </span>
        <h1 className={s.heading} data-copy="early">
          <span>Lorem ipsum</span>
          <span>dolor sit amet.</span>
        </h1>
        <p className={s.subtitle} data-copy="late">
          Consectetur adipiscing elit, sed do eiusmod tempor incididunt.
        </p>
      </div>
    </div>
  );
}
