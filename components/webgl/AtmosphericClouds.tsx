"use client";

/* ============================================================================
   The last three seconds.

   A far deck that sells altitude, one mid form that becomes readable as the air
   thickens, and one near mass that crosses an edge and gives the only real
   parallax in the film. Three, and no more: the brief's own rule is that a
   clean sky with one excellent cloud beats five mediocre ones, and every extra
   plane is another chance to look like a collage.

   They ride the camera. That sounds like cheating and it is exactly right — the
   camera closes on a planet from three hundred units to fifteen, and a cloud at
   a fixed world position would swing through the frame as that happens. Clouds
   are weather, not scenery; they belong to the frame.

   Their positions keep the left of the picture open, because that is where the
   heading lands.
   ========================================================================== */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ATMO_CLOUD_VERT, ATMO_CLOUD_FRAG } from "./shaders/atmoCloud";
import { useOptionalTexture, textureAspect } from "./useTexture";
import { TEX } from "@/lib/assets";
import { at, CLOUD_MID, CLOUD_NEAR, DECK, type SkyRead } from "@/lib/cinematic";
import { clock } from "@/lib/clock";

/** How far in front of the camera the weather sits. */
const DISTANCE = 6;

interface Layer {
  src: string;
  /** width at scale 1, as a fraction of the frame width */
  width: number;
  /** centre, in fractions of the frame from the middle */
  x: number;
  y: number;
  /** where it travels from and to, vertically, in frame heights */
  travel: [number, number];
  scale: [number, number];
  presence: readonly [number, number][];
  air: number;
  lod: number;
  order: number;
}

const LAYERS: Layer[] = [
  /* The deck. Enormous, low, almost without contrast — it is not a cloud, it is
     the fact that there are clouds a very long way below. */
  {
    src: TEX.clouds.far3,
    width: 3.4,
    x: 0.05,
    y: -0.52,
    travel: [-0.06, 0.16],
    scale: [1.0, 1.18],
    presence: DECK,
    air: 0.66,
    lod: 2.2,
    order: 20,
  },
  /* The mid form. Right of centre, so the left stays open. */
  {
    src: TEX.clouds.mid2,
    width: 0.72,
    x: 0.31,
    y: -0.1,
    travel: [-0.34, 0.3],
    scale: [0.82, 1.28],
    presence: CLOUD_MID,
    air: 0.2,
    lod: 0.7,
    order: 21,
  },
  /* The near mass. It crosses the upper-right corner and is cropped by it —
     a cloud that fits inside the frame is an illustration of a cloud. */
  {
    src: TEX.clouds.near1,
    width: 1.35,
    x: 0.46,
    y: 0.3,
    travel: [-0.66, 0.24],
    scale: [1.0, 1.16],
    presence: CLOUD_NEAR,
    air: 0.05,
    lod: 0.2,
    order: 22,
  },
];

function Cloud({ layer, sky }: { layer: Layer; sky: SkyRead }) {
  const mesh = useRef<THREE.Mesh>(null);
  const tex = useOptionalTexture(layer.src, 8);
  const gl = useThree((s) => s.gl);
  const { camera, size } = useThree();

  const uniforms = useMemo(
    () => ({
      uMap: { value: null as THREE.Texture | null },
      uOpacity: { value: 0 },
      uLod: { value: layer.lod },
      uAir: { value: new THREE.Color(0, 0, 0) },
      uAirAmt: { value: layer.air },
      uLight: { value: 1 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ATMO_CLOUD_VERT,
        fragmentShader: ATMO_CLOUD_FRAG,
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        glslVersion: THREE.GLSL3,
      }),
    [uniforms]
  );

  useEffect(() => {
    if (!tex) return;
    uniforms.uMap.value = tex;
    gl.initTexture(tex);
  }, [tex, uniforms, gl]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.time;
    const op = at(layer.presence as never, t);

    if (!tex || op <= 0.002) {
      m.visible = false;
      return;
    }
    m.visible = true;

    const cam = camera as THREE.PerspectiveCamera;
    const h = 2 * Math.tan((cam.fov * Math.PI) / 360) * DISTANCE;
    const w = h * (size.width / size.height);

    /* Presence drives the travel too, so a layer never appears mid-journey —
       it arrives from below as it fades up, which is one gesture rather than
       two that happen to coincide. */
    const k = Math.min(1, op / 0.95);
    const aspect = textureAspect(tex);
    const width = w * layer.width;
    const sc = layer.scale[0] + (layer.scale[1] - layer.scale[0]) * k;
    m.scale.set(width * sc, (width / aspect) * sc, 1);

    const ty = layer.travel[0] + (layer.travel[1] - layer.travel[0]) * k;
    m.position.set(w * layer.x, h * (layer.y + ty), -DISTANCE);

    uniforms.uOpacity.value = op;
    uniforms.uLight.value = 0.72 + 0.28 * sky.light;
    uniforms.uAir.value.setRGB(sky.color[0], sky.color[1], sky.color[2]);
  });

  return (
    <mesh ref={mesh} visible={false} renderOrder={layer.order} frustumCulled={false}>
      <planeGeometry args={[1, 1, 1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

export default function AtmosphericClouds({
  sky,
  mobile,
}: {
  sky: SkyRead;
  mobile: boolean;
}) {
  const rig = useRef<THREE.Group>(null);
  const { camera } = useThree();

  useFrame(() => {
    const g = rig.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
  }, -4);

  // a phone gets the deck and the near mass; three planes is one too many there
  const layers = mobile ? [LAYERS[0], LAYERS[2]] : LAYERS;

  return (
    <group ref={rig}>
      {layers.map((l) => (
        <Cloud key={l.src + l.x} layer={l} sky={sky} />
      ))}
    </group>
  );
}
