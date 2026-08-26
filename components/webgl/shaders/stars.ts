/* ============================================================================
   Stars.

   Photographic points, not particles. The difference is almost entirely in
   restraint: most of them are under a pixel across and under a third opacity,
   the brightest are two pixels, and there is a great deal of black between
   them. A field that reads as "particle system" has too many, too large, too
   bright, too evenly spread, or all four.

   The size floor is one device pixel. Below that the rasteriser drops a point
   entirely and the sky goes empty in patches, so SIZE carries the depth class
   and BRIGHTNESS carries the faintness — which is how it works looking up.
   ========================================================================== */

export const STAR_VERT = /* glsl */ `
uniform float uPixelRatio;
uniform float uVisibility;
uniform float uTime;

in float aSize;        // device pixels at the reference distance
in float aOpacity;
in float aPhase;
in vec3 aTint;

out float vAlpha;
out vec3 vTint;

void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;

  /* Barely any twinkle. Four per cent, over a period of several seconds, with a
     random phase — enough that the field is not dead, far below the threshold
     at which it reads as flicker. */
  float tw = 1.0 + 0.04 * sin(uTime * 0.9 + aPhase * 43.7);

  /* One device pixel is the floor, not half of one. Below a pixel the
     rasteriser covers a fraction of a fragment and the star's alpha is
     multiplied by that coverage on top of its own — the faint half of the field
     simply never appeared, which at a 1x capture left about ten visible stars
     in a frame that is otherwise pure black. */
  gl_PointSize = clamp(aSize * uPixelRatio * tw, uPixelRatio * 1.0, uPixelRatio * 2.5);
  vAlpha = aOpacity * uVisibility * tw;
  vTint = aTint;
}
`;

export const STAR_FRAG = /* glsl */ `
in float vAlpha;
in vec3 vTint;
out vec4 fragColor;

void main(){
  // a soft round point, never a square and never a halo
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.08, r);
  a *= a;
  float alpha = a * vAlpha;
  if (alpha < 0.003) discard;
  fragColor = vec4(vTint, alpha);
}
`;
