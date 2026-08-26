/* ============================================================================
   The clouds of the transition.

   Three planes riding the camera: a far deck, one mid form, one near mass that
   passes through an edge. They are the last depth cue before the film lands, and
   the only thing that stops the arrival being a colour change.

   Two rules make a cutout on a plane read as weather rather than as a sticker:

   THE EDGE. As alpha falls, the colour is pushed toward the cloud's own white
   instead of carrying whatever was in the matte. Without it a cutout keeps a
   thin ring of the sky it was photographed against, and against a different
   blue that ring is a halo you cannot unsee.

   THE AIR. `uAir` is the field's own colour, sampled from the same ramp the
   background is painted from, and `uAirAmt` is how much of the distance between
   the cloud and the sky it has already lost. A far deck sits most of the way to
   the sky and is barely an object; the near mass keeps its white.
   ========================================================================== */

export const ATMO_CLOUD_VERT = /* glsl */ `
out vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ATMO_CLOUD_FRAG = /* glsl */ `
/* Ordered dither — the same 4x4 Bayer pattern the atmosphere shell uses, and
   applied to the ALPHA as well as the colour.

   The far deck's matte is quantised: obj-far-1 carries 51 distinct alpha levels
   and obj-far-3 carries 72, with steps as wide as six codes, and those plates
   are magnified about twice over on a 1512-wide frame. The result is a set of
   nested closed contours across the sky — unmistakably a topographic map, and
   the ugliest thing in the transition. (The mid and near plates are clean at
   the full 256, so this is the far generator's doing, not the encoder's; a
   WebP round-trip at alphaQuality 100 preserves all 256 levels.)

   Dithering by ±3/255 is exactly enough to bridge a six-code staircase, and is
   invisible on the plates that never needed it. */
float bayer(vec2 p){
  vec2 f = floor(mod(p, 4.0));
  int i = int(f.x + f.y * 4.0);
  float m[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  return m[i] / 16.0 - 0.5;
}

uniform sampler2D uMap;
uniform float uOpacity;
uniform float uLod;
uniform vec3  uAir;
uniform float uAirAmt;
uniform float uLight;

in vec2 vUv;
out vec4 fragColor;

void main(){
  vec4 tex = texture(uMap, vUv, uLod);
  float a = tex.a * uOpacity;
  if (a <= 0.002) discard;

  vec3 col = tex.rgb;

  // kill the fringe before anything else
  col = mix(vec3(0.94, 0.96, 0.975), col, smoothstep(0.05, 0.44, tex.a));

  /* Sunlit cumulus is WHITE. The source is a film scan and sits a little cool
     and a little grey; lifting the top and holding the contrast is what makes
     what recedes into the air a white cloud getting fainter rather than a grey
     one getting greyer. */
  col = pow(col, vec3(0.88)) * 1.08;
  col *= uLight;

  // aerial perspective — the single most important line in this shader
  col = mix(col, uAir, clamp(uAirAmt, 0.0, 1.0));

  float d = bayer(gl_FragCoord.xy);
  fragColor = vec4(col + d / 255.0, a + d * (6.0 / 255.0));
}
`;
