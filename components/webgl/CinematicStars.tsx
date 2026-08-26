"use client";

/* ============================================================================
   The star field.

   Three depth bands in a spherical shell around the planet, so the camera's own
   travel produces the parallax rather than anything animating outward. The
   bands are FAR from the camera on purpose: it covers two hundred and eighty
   units across the film, and a star at five hundred would sweep twenty-eight
   degrees across the frame — which is a particle effect, not a sky. At four
   thousand and beyond the nearest band drifts about four degrees over fourteen
   seconds, which is felt as depth and never seen as motion.

   Distribution is spherical, not a random cube: a cube sampled uniformly is
   denser toward its corners and the projection shows it. The brightest points
   are additionally spaced apart from one another, because pure randomness at
   low counts clumps, and a clump of bright stars reads as a constellation
   nobody authored.
   ========================================================================== */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { STAR_VERT, STAR_FRAG } from "./shaders/stars";
import { at, STAR_VISIBILITY } from "@/lib/cinematic";
import { clock } from "@/lib/clock";

interface Band {
  count: number;
  near: number;
  far: number;
  size: [number, number];
  opacity: [number, number];
  tints: string[];
  /** minimum angular separation from other stars in this band, in radians */
  spacing?: number;
}

/* Roughly a thousand points at desktop, seventy per cent of them at the
   threshold of visible. The count is not the character — the distribution of
   sizes is. */
const BANDS: Band[] = [
  {
    count: 820,
    near: 8000,
    far: 12000,
    size: [0.5, 1.3],
    opacity: [0.20, 0.50],
    tints: ["#d7e0e7", "#e6ecf0", "#c6d2da"],
  },
  {
    count: 300,
    near: 5500,
    far: 8000,
    size: [1.1, 2.3],
    opacity: [0.38, 0.80],
    tints: ["#f4f7f8", "#eaf1f5", "#d8e5ec", "#eee4d6"],
  },
  {
    count: 40,
    near: 4000,
    far: 5500,
    size: [2.0, 4.0],
    opacity: [0.60, 1.0],
    tints: ["#f7fafb", "#eef4f6"],
    spacing: 0.14,
  },
];

function build() {
  // deterministic: the sky is the same sky on every visit, so it can be judged
  let seed = 0x5e10a;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  const total = BANDS.reduce((n, b) => n + b.count, 0);
  const position = new Float32Array(total * 3);
  const size = new Float32Array(total);
  const opacity = new Float32Array(total);
  const phase = new Float32Array(total);
  const tint = new Float32Array(total * 3);

  const c = new THREE.Color();
  const dirs: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  let i = 0;

  for (const band of BANDS) {
    for (let n = 0; n < band.count; n++) {
      // uniform on the sphere, then pushed out into the band's shell
      let tries = 0;
      do {
        const u = rnd() * 2 - 1;
        const th = rnd() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        v.set(s * Math.cos(th), s * Math.sin(th), u);
        tries++;
      } while (
        band.spacing &&
        tries < 40 &&
        dirs.some((d) => d.angleTo(v) < band.spacing!)
      );
      if (band.spacing) dirs.push(v.clone());

      const r = band.near + rnd() * (band.far - band.near);
      position[i * 3] = v.x * r;
      position[i * 3 + 1] = v.y * r;
      position[i * 3 + 2] = v.z * r;

      /* Cubed, not linear. Most stars must sit at the bottom of their band's
         size range; a linear roll gives an even spread of sizes and the field
         reads as decorative dots. */
      const k = Math.pow(rnd(), 3);
      size[i] = band.size[0] + k * (band.size[1] - band.size[0]);
      opacity[i] = band.opacity[0] + Math.pow(rnd(), 1.6) * (band.opacity[1] - band.opacity[0]);
      phase[i] = rnd();

      c.set(band.tints[Math.floor(rnd() * band.tints.length)]);
      tint[i * 3] = c.r;
      tint[i * 3 + 1] = c.g;
      tint[i * 3 + 2] = c.b;
      i++;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(position, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  g.setAttribute("aOpacity", new THREE.BufferAttribute(opacity, 1));
  g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  g.setAttribute("aTint", new THREE.BufferAttribute(tint, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 13000);
  return g;
}

export default function CinematicStars({ dpr }: { dpr: number }) {
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => build(), []);

  const material = useMemo(() => {
    const u = {
      uPixelRatio: { value: dpr },
      uVisibility: { value: 0 },
      uTime: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: u,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      glslVersion: THREE.GLSL3,
    });
    return { u, m };
  }, [dpr]);

  useFrame(() => {
    const t = clock.time;
    const vis = at(STAR_VISIBILITY, t);
    material.u.uVisibility.value = vis;
    material.u.uTime.value = t;
    material.u.uPixelRatio.value = dpr;
    const p = points.current;
    if (p) p.visible = vis > 0.002;
  });

  return (
    <points ref={points} frustumCulled={false} renderOrder={-1}>
      <primitive object={geometry} attach="geometry" />
      <primitive object={material.m} attach="material" />
    </points>
  );
}
