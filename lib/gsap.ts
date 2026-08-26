/* ============================================================================
   SELORA — a single place where GSAP is configured.
   Plugins are registered exactly once; ScrollTrigger is driven by Lenis (see
   components/motion/SmoothScroll.tsx), never by its own rAF.
   ========================================================================== */

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;

export function initGsap() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(ScrollTrigger);
  gsap.defaults({ ease: "none", overwrite: "auto" });
  gsap.ticker.lagSmoothing(220, 30);
  ScrollTrigger.config({
    // Lenis writes scroll on the same tick; resizing is the only event that
    // needs to invalidate cached measurements.
    autoRefreshEvents: "visibilitychange,DOMContentLoaded,load,resize",
    ignoreMobileResize: true,
  });
  registered = true;
}

if (typeof window !== "undefined") initGsap();

export { gsap, ScrollTrigger };
