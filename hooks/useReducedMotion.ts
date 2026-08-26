"use client";

import { useMediaQuery } from "./useMediaQuery";

/**
 * When true the scroll choreography is replaced by static compositions and
 * simple crossfades — the site still has to look art-directed, just still.
 */
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
