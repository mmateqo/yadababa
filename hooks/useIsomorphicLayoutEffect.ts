import { useEffect, useLayoutEffect } from "react";

/** useLayoutEffect that stays quiet during SSR. */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
