"use client";

/* ============================================================================
   The planet.

   Three shells — surface, weather, air — and one sun. It has to survive being
   nine per cent of the frame at two seconds and larger than the frame at eight,
   so nothing about it can be a trick that only works at one distance.

   The maps are NASA Blue Marble Next Generation and GEBCO bathymetry, public
   domain, prepared by tools/gen-earth-v5.mjs. The one that does the most work
   is the ocean mask: water and land differ far more in ROUGHNESS than in
   colour, and rendering both at the same roughness is most of what makes a
   globe read as plastic.

   It turns at a constant half a degree per second, from the first frame, before
   the camera has moved. That ordering matters — the object has to be alive
   before the camera takes an interest in it, or the rotation reads as something
   the camera caused.
   ========================================================================== */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  EARTH_VERT,
  EARTH_FRAG,
  CLOUD_FRAG,
  ATMO_VERT,
  ATMO_FRAG,
} from "./shaders/earth";
import { SUN } from "./sun";
import { useOptionalTexture } from "./useTexture";
import { TEX } from "@/lib/assets";
import {
  at,
  ATMO_INTENSITY,
  CLOUD_SPIN_RATIO,
  EARTH_HAZE,
  EARTH_RADIUS,
  EARTH_REVEAL,
  EARTH_SPIN_DEG_PER_SEC,
  EARTH_START_ROTATION,
  EARTH_TILT,
  EXPOSURE,
} from "@/lib/cinematic";
import type { SkyRead } from "@/lib/cinematic";
import { clock } from "@/lib/clock";
import { isGpuReady, markGpuReady } from "@/lib/ready";

/* Air is a little over one per cent of Earth's radius. Six is the art
   direction — the shell is the volume the shader is allowed to integrate
   through, and the DENSITY inside it falls off exponentially (SCALE_HEIGHT), so
   making it thicker costs nothing but gives the gradient room to fade to zero
   before it runs out of geometry. At 1.032 with a uniform density the band
   saturated flat and ended at the mesh's silhouette — a hard cyan rim.

   The MESH is drawn wider still, because the shading is computed from the ray
   rather than from the surface it is drawn on, and a sphere's silhouette is a
   polygon: at the shading radius that polygon lands where the atmosphere is
   still bright and shows as a faint dashed hair along the limb. */
const SHELL = EARTH_RADIUS * 1.06;
const SHELL_MESH = EARTH_RADIUS * 1.11;
/** e-folding height of the air, as a fraction of the planet's radius. Earth's
    real figure is 0.0013; this is eight times that, because at 0.0013 the glow
    is two pixels tall at every altitude the film ever flies. */
const SCALE_HEIGHT = 0.0105;

const ATMO = new THREE.Color("#6ba6dd");
const WARM = new THREE.Color("#e0a074");

export default function CinematicEarth({
  quality,
  sky,
}: {
  quality: number;
  sky: SkyRead;
}) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const cloudSpin = useRef<THREE.Group>(null);
  const warm = useRef(0);
  /* When the reveal curve is allowed to start. See the note in the frame loop. */
  const revealFrom = useRef(0);
  const gl = useThree((s) => s.gl);

  const albedo = useOptionalTexture(
    quality > 0.5 ? TEX.earth.albedo : TEX.earth.albedoLo,
    16
  );
  const cloudMap = useOptionalTexture(TEX.earth.clouds, 16);
  const ocean = useOptionalTexture(TEX.earth.ocean, 4);
  const normal = useOptionalTexture(TEX.earth.normal, 4);
  const night = useOptionalTexture(TEX.earth.night, 2);

  const surface = useMemo(() => {
    const u = {
      uAlbedo: { value: null as THREE.Texture | null },
      uOcean: { value: null as THREE.Texture | null },
      uNormal: { value: null as THREE.Texture | null },
      uNight: { value: null as THREE.Texture | null },
      uSun: { value: SUN },
      uAtmoColor: { value: ATMO },
      uWarmColor: { value: WARM },
      /* The colour the planet dissolves INTO. Tracked live from the sky element
         behind the canvas rather than fixed — see the note in EARTH_FRAG. */
      uHazeColor: { value: new THREE.Color(0, 0, 0) },
      uOpacity: { value: 0 },
      uExposure: { value: 0.92 },
      uHaze: { value: 0 },
      uLod: { value: 0 },
      uRelief: { value: 0.42 },
    };
    return {
      u,
      m: new THREE.ShaderMaterial({
        vertexShader: EARTH_VERT,
        fragmentShader: EARTH_FRAG,
        uniforms: u,
        transparent: true,
        glslVersion: THREE.GLSL3,
      }),
    };
  }, []);

  const weather = useMemo(() => {
    const u = {
      uMap: { value: null as THREE.Texture | null },
      uSun: { value: SUN },
      uAtmoColor: { value: ATMO },
      uWarmColor: { value: WARM },
      uHazeColor: { value: new THREE.Color(0, 0, 0) },
      uOpacity: { value: 0 },
      uLod: { value: 0 },
      uHaze: { value: 0 },
    };
    return {
      u,
      m: new THREE.ShaderMaterial({
        vertexShader: EARTH_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: u,
        transparent: true,
        depthWrite: false,
        glslVersion: THREE.GLSL3,
      }),
    };
  }, []);

  const air = useMemo(() => {
    const u = {
      uColor: { value: ATMO },
      uWarmColor: { value: WARM },
      uSun: { value: SUN },
      uIntensity: { value: 0 },
      uOpacity: { value: 0 },
      uRp: { value: EARTH_RADIUS },
      uRs: { value: SHELL },
      uScaleHeight: { value: SCALE_HEIGHT },
    };
    return {
      u,
      m: new THREE.ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        uniforms: u,
        transparent: true,
        /* FRONT faces, over the planet, not back faces behind it. The shell is
           the air between the eye and everything else, so it belongs in front
           of the surface — and the optical-depth term already knows the ground
           cuts a low ray short. Drawn on the back faces it is clipped by the
           planet's own silhouette, and because that silhouette is a polygon the
           brightest part of the atmosphere ends up with a dashed edge. */
        side: THREE.FrontSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        glslVersion: THREE.GLSL3,
      }),
    };
  }, []);

  /* Equirectangular maps must wrap in x or the seam shows as the planet turns.
     The three data maps are read as LINEAR: a land mask, a normal map and a
     light intensity are not colours, and the sRGB decode would bend every value
     in them. */
  for (const t of [albedo, cloudMap, ocean, normal, night]) {
    if (t && t.wrapS !== THREE.RepeatWrapping) {
      t.wrapS = THREE.RepeatWrapping;
      t.needsUpdate = true;
    }
  }
  for (const t of [ocean, normal, night]) {
    if (t && t.colorSpace !== THREE.NoColorSpace) {
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
    }
  }
  surface.u.uAlbedo.value = albedo;
  surface.u.uOcean.value = ocean;
  surface.u.uNormal.value = normal;
  surface.u.uNight.value = night;
  weather.u.uMap.value = cloudMap;

  useEffect(() => {
    for (const t of [albedo, cloudMap, ocean, normal, night]) if (t) gl.initTexture(t);
  }, [albedo, cloudMap, ocean, normal, night, gl]);

  useFrame(() => {
    const t = clock.time;
    const g = group.current;
    if (!g) return;

    /* Drawn once, invisibly, in the first frames after mount, so the three
       programs link and the five maps upload while the frame is still black.

       The counter resets until the maps are actually here. Counting from mount
       instead marked the GPU ready on the very frame the 4K albedo and cloud
       maps first reached a draw call — which is the frame that costs 260ms —
       so the signal fired exactly one frame before the stall it exists to hide. */
    const haveMaps = !!(albedo && cloudMap && ocean);
    if (!haveMaps) warm.current = 0;
    const warming = warm.current < 4;
    if (warming) {
      warm.current += 1;
      if (warm.current >= 4) markGpuReady();
    }

    /* The reveal waits for the GPU, and then runs its own curve from there
       rather than from the film's clock. A quarter-second stutter inside an
       opacity ramp is visible; the same ramp starting a quarter-second late,
       on an eight-vh disc in a black frame, is not.

       The 2.5s ceiling is the failsafe: if a map never arrives, the planet
       appears anyway rather than the film simply not having one. */
    if (!isGpuReady() && t < 2.5) revealFrom.current = t;
    const reveal = at(EARTH_REVEAL, t - revealFrom.current);
    g.visible = reveal > 0.002 || warming;
    if (!g.visible) return;
    if (warming && reveal <= 0.002) {
      surface.u.uOpacity.value = 0.0004;
      weather.u.uOpacity.value = 0.0004;
      air.u.uOpacity.value = 0.0004;
      return;
    }

    const haze = at(EARTH_HAZE, t);
    const exposure = at(EXPOSURE, t);

    /* The planet fades into the SKY, not into a swatch. The sky element behind
       the canvas is already publishing its live colour every frame, so the haze
       simply reads it — which is why the limb can leave the frame without
       anything crossfading. Mixed toward a fixed blue instead, the planet stayed
       darker than the sky above it right through the entry and read as a dark
       mass sitting in front of the view rather than as distance. */
    surface.u.uHazeColor.value.setRGB(sky.color[0], sky.color[1], sky.color[2]);
    weather.u.uHazeColor.value.copy(surface.u.uHazeColor.value);

    surface.u.uOpacity.value = reveal;
    surface.u.uHaze.value = haze;
    surface.u.uExposure.value = exposure;

    weather.u.uOpacity.value = reveal * 0.92;
    weather.u.uHaze.value = haze;

    air.u.uOpacity.value = reveal;
    air.u.uIntensity.value = at(ATMO_INTENSITY, t);

    /* Constant angular velocity, from t = 0. No acceleration, no reverse, no
       coupling to the camera — the planet's motion and the camera's motion are
       independent, and that independence is what sells the scale. */
    const angle = EARTH_START_ROTATION + t * EARTH_SPIN_DEG_PER_SEC * (Math.PI / 180);
    if (spin.current) spin.current.rotation.y = angle;
    if (cloudSpin.current) {
      cloudSpin.current.rotation.y = angle * CLOUD_SPIN_RATIO + 0.31;
    }
  }, -5);

  /* The silhouette is the one thing on this object a map cannot fake, and at
     the curvature frame the limb runs the full width of the screen. */
  const seg = quality > 0.5 ? 192 : 112;

  return (
    <group ref={group} rotation={[0, 0, -EARTH_TILT * (Math.PI / 180)]}>
      <group ref={spin}>
        <mesh frustumCulled={false}>
          <sphereGeometry args={[EARTH_RADIUS, seg, seg / 2]} />
          <primitive object={surface.m} attach="material" />
        </mesh>
      </group>
      <group ref={cloudSpin}>
        <mesh frustumCulled={false} renderOrder={1}>
          <sphereGeometry args={[EARTH_RADIUS * 1.006, seg * 0.8, seg * 0.4]} />
          <primitive object={weather.m} attach="material" />
        </mesh>
      </group>
      <mesh frustumCulled={false} renderOrder={3}>
        <sphereGeometry args={[SHELL_MESH, 128, 64]} />
        <primitive object={air.m} attach="material" />
      </mesh>
    </group>
  );
}
