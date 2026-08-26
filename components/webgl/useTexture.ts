"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

/**
 * Tolerant texture loading: a missing plate degrades to nothing rather than
 * throwing a suspense boundary and taking the whole environment down with it.
 */
export function useOptionalTexture(url?: string, anisotropy = 4) {
  // an already-decoded plate is available on the very first render
  const cached = url ? cache.get(url) ?? null : null;
  const [loaded, setLoaded] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!url || cache.has(url)) return;
    let alive = true;
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = anisotropy;
        t.needsUpdate = true;
        cache.set(url, t);
        if (alive) setLoaded(t);
      },
      undefined,
      () => {
        /* plate not present yet — the layer simply stays empty */
      }
    );
    return () => {
      alive = false;
    };
  }, [url, anisotropy]);

  return cached ?? loaded;
}

export function textureAspect(t: THREE.Texture | null): number {
  const img = t?.image as { width?: number; height?: number } | undefined;
  if (!img?.width || !img?.height) return 1.5;
  return img.width / img.height;
}
