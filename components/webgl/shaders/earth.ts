/* ============================================================================
   The planet.

   Five maps and one sun. The maps are NASA Blue Marble Next Generation and
   GEBCO bathymetry, public domain, prepared by tools/gen-earth-v5.mjs; the sun
   is a single direction with almost no ambient behind it, because a planet lit
   from everywhere is a ball and a planet lit from one place is a photograph.

   What each map is for, and why the previous version looked synthetic without
   them:

     albedo   the ground colour. On its own it is a painted sphere.
     ocean    where the water is. This is the map that does the most work in the
              whole set: water and land differ far more in ROUGHNESS than in
              colour, and rendering both at the same roughness is most of what
              made v4's planet read as plastic. Water gets a narrow specular
              lobe and takes the sun as a glint; land gets none.
     normal   relief, and very little of it. Enough that the Andes and the
              Himalayas catch the light along their western faces at the
              terminator, not enough to emboss.
     night    city lights on the dark side, at a level you have to look for.
     clouds   a separate shell, turning very slightly faster than the surface.

   Tone mapping is applied HERE, in the fragment shader, rather than on the
   renderer. The canvas is composited over a CSS colour field that no tone curve
   is applied to, so a global filmic curve would put the planet and its own sky
   into different colour spaces. ACES on the planet alone keeps the highlights
   on cloud tops from clipping to flat white while leaving everything else in
   the film exactly as authored.

   The dark side is genuinely dark — two per cent, not twenty. In a frame that
   is otherwise true black, a lifted night side is the single loudest tell that
   this is a lit sphere rather than a photograph, and it is the first thing to
   check when the planet "looks like a globe".

   No noise, no grain, nothing "filmic" beyond the curve.
   ========================================================================== */

export const EARTH_VERT = /* glsl */ `
out vec2 vUv;
out vec3 vNormalW;
out vec3 vPosW;

void main(){
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/* ACES filmic, the Narkowicz fit. Cheap, and its shoulder is the reason a
   sunlit cloud top can be bright without going to paper white. */
const ACES = /* glsl */ `
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
`;

const SPHERE_SAMPLE = /* glsl */ `
/* Seam-safe texture gradients for an equirectangular map.

   THE BUG THIS REPLACES. Every map here used to be read with textureLod(map,
   uv, 0) plus a hand-rolled grazing-angle bias. textureLod does not select a
   mip from the screen-space derivative — it takes the level it is given — so
   asking for level 0 point-samples the full 4096x2048 map no matter how small
   the planet is on screen. Through most of the film the disc is a few hundred
   pixels across, which is thirteen texels per pixel, and the result is textbook
   minification aliasing: over the ocean it came out as a regular lattice of
   bright dots that looks precisely like sensor noise, and it was the single
   worst thing in the frame.

   textureGrad takes the derivatives explicitly, so the hardware picks the mip
   AND the anisotropic tap pattern the way it would for an ordinary lookup —
   while still leaving the bias in our hands.

   The seam. u wraps from 1 back to 0 down the antimeridian, so dFdx(u) there is
   about -1 instead of about 0, the derived mip is the coarsest one, and the map
   gets a blurred line down it. Subtracting the nearest whole turn removes the
   wrap and leaves the true local rate. */
vec4 sampleSphere(sampler2D map, vec2 uv, float bias){
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  float k = exp2(bias);
  return textureGrad(map, uv, dx * k, dy * k);
}
`;

export const EARTH_FRAG = /* glsl */ `
${ACES}
${SPHERE_SAMPLE}

uniform sampler2D uAlbedo;
uniform sampler2D uOcean;
uniform sampler2D uNormal;
uniform sampler2D uNight;
uniform vec3 uSun;
uniform vec3 uAtmoColor;
uniform vec3 uWarmColor;
uniform vec3 uHazeColor;
uniform float uOpacity;
uniform float uExposure;
uniform float uHaze;
uniform float uLod;
uniform float uRelief;

in vec2 vUv;
in vec3 vNormalW;
in vec3 vPosW;

out vec4 fragColor;

void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 L = normalize(uSun);

  /* Grazing-angle mip bias.
     At the limb a texel of a 4K map compresses to a fraction of a pixel and
     anisotropic filtering runs out of taps, which shows as a stipple of bright
     dots along the exact edge of the planet — the most looked-at forty pixels
     in the site. Biasing the mip level by how edge-on the surface is removes it
     at source, and it is also what the physics wants: the limb is further away
     and seen through far more air, so it SHOULD be the softest part of the
     image. */
  float graze = 1.0 - abs(dot(N, V));
  float lod = uLod + pow(graze, 5.0) * 3.2;

  vec3 albedo = sampleSphere(uAlbedo, vUv, lod).rgb;
  float water = sampleSphere(uOcean, vUv, lod).r;

  /* Tangent frame, analytically. On an equirectangular sphere the u axis runs
     east and the v axis runs north, so the frame can be built from the surface
     normal and the world pole without a tangent attribute — which also means it
     is exact at every vertex instead of interpolated. */
  vec3 pole = vec3(0.0, 1.0, 0.0);
  vec3 east = normalize(cross(pole, N) + vec3(1e-6));
  vec3 north = cross(N, east);
  vec3 nTex = sampleSphere(uNormal, vUv, lod).xyz * 2.0 - 1.0;
  // relief is scaled to nothing over water: a normal-mapped ocean is a lake
  float relief = uRelief * (1.0 - water);
  vec3 Nb = normalize(N + (east * nTex.x + north * nTex.y) * relief);

  float ndl = dot(Nb, L);
  float ndlGeo = dot(N, L);

  /* A wide, soft terminator. The sun is half a degree across from here, so the
     physically correct terminator is nearly a hard line — and a hard line on a
     sphere reads as a render every single time. This is the one place the
     lighting is deliberately not physical. */
  float day = smoothstep(-0.05, 0.30, ndl);
  float dayGeo = smoothstep(-0.05, 0.30, ndlGeo);
  /* The warm line at the terminator, and it IS a line. Blended over a band —
     smoothstep(-0.28, 0.05) was the first attempt — it covers thirty-odd
     degrees of the sphere, and thirty degrees seen face-on is a quarter of the
     disc: the planet comes out rust-coloured down one side, which is not a
     sunset, it is Mars. A Gaussian a few degrees wide puts the colour where the
     air actually is, and the shell in front (ATMO_FRAG) carries the rest. */
  float twilight = exp(-pow(ndlGeo / 0.085, 2.0)) * (1.0 - dayGeo);

  vec3 lit = albedo * (0.018 + 1.04 * day);

  /* Water. The specular lobe is narrow and it exists only on water; land is
     rough enough that its highlight is already in the albedo. This one term is
     most of the difference between a planet and a painted ball. */
  vec3 H = normalize(L + V);
  float ndh = max(dot(Nb, H), 0.0);
  float glint = pow(ndh, 420.0) * water * day;
  float sheen = pow(ndh, 30.0) * water * day * 0.05;
  /* Bright, but not a light source. Sun glint off an ocean seen from space is
     genuinely a broad patch rather than a point — the recognisable thing in
     every Blue Marble frame — and the tone curve's shoulder is what keeps it
     from clipping to a white disc. */
  lit += vec3(1.0, 0.98, 0.94) * (glint * 0.62 + sheen);

  /* Scattered light along the terminator — a whisper, and no more than that.
     On the GROUND the terminator is a fade to black; the warm arc everyone
     remembers lives in the AIR, is only bright where the line of sight runs
     tangentially through it, and is therefore ATMO_FRAG's job. Carrying it here
     as well lays a brown streak down the night edge of the disc, which is what
     the planet reads as: not a sunset, a stain. */
  lit += uWarmColor * twilight * 0.04;

  // city lights, and barely
  float night = sampleSphere(uNight, vUv, lod).r;
  /* Cities, and barely. The map's mean is five thousandths of full scale and
     its peaks are near white, so anything above about a tenth stops reading as
     lights on a dark continent and starts reading as sensor noise across the
     whole night side. */
  lit += vec3(1.0, 0.86, 0.62) * night * pow(1.0 - dayGeo, 2.5) * 0.11;

  /* A little air ON the surface, for the softening you get looking through a
     long slant path at the ground near the limb. Only a little: the shell in
     front of it (ATMO_FRAG) is what actually carries the atmosphere now, and
     doing it twice turns the edge of the planet into a blue smear. */
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.6);
  lit = mix(lit, uAtmoColor, clamp(fres * 0.42 * (0.12 + 0.88 * dayGeo), 0.0, 0.6));

  lit *= uExposure;
  lit = aces(lit);

  /* And the air between here and the ground, which grows as we descend.

     Applied AFTER the tone curve and toward the sky's own live colour, because
     this is not light being scattered by the planet — it is the planet being
     replaced by the sky in front of it. Weighted by daylight it kept the night
     half dark while the sky went blue, and the planet read as a dark mass
     sitting in the view rather than as something far away. */
  lit = mix(lit, uHazeColor, clamp(uHaze * (0.82 + 0.18 * dayGeo), 0.0, 1.0));

  fragColor = vec4(lit, uOpacity);
}
`;

export const CLOUD_FRAG = /* glsl */ `
${ACES}
${SPHERE_SAMPLE}

uniform sampler2D uMap;
uniform vec3 uSun;
uniform vec3 uAtmoColor;
uniform vec3 uWarmColor;
uniform vec3 uHazeColor;
uniform float uOpacity;
uniform float uLod;
uniform float uHaze;

in vec2 vUv;
in vec3 vNormalW;
in vec3 vPosW;

out vec4 fragColor;

void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 L = normalize(uSun);

  // see the note on grazing-angle bias in EARTH_FRAG — the weather shell
  // aliases harder than the surface, because its alpha edges are high contrast
  float graze = 1.0 - abs(dot(N, V));
  /* Half a level softer than the derivative asks for. The MODIS composite
     resolves marine stratocumulus down to the texel, and at the scale this film
     shows the planet that lands as one-pixel contrast across whole oceans —
     true to the data, and read by the eye as noise rather than as weather.
     Clouds seen from orbit through the air above them are softer than the
     mosaic; this is the air. */
  vec4 c = sampleSphere(uMap, vUv, uLod + 0.55 + pow(graze, 4.0) * 3.6);
  float ndl = dot(N, L);
  float day = smoothstep(-0.10, 0.30, ndl);

  /* Cloud tops are the brightest thing on the planet and the shoulder of the
     tone curve is what stops them becoming a white cut-out. */
  vec3 col = c.rgb * (0.02 + 1.24 * day);

  // the terminator runs through the weather too, and warms it
  float twilight = exp(-pow(ndl / 0.10, 2.0)) * (1.0 - day);
  col += uWarmColor * twilight * 0.22;

  /* Aerial perspective ADDS air in front of the cloud; it does not repaint the
     cloud. Written as a mix toward the sky colour it lit the night side —
     a mix toward uAtmoColor * 0.55 gave every unlit cloud a
     constant blue-grey, which across the dark hemisphere came out as a field of
     pale speckle that looked exactly like sensor noise. Air is only bright
     where the sun is on it, so both terms below are weighted by day. */
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  col = mix(col, uAtmoColor * 1.15, fres * 0.42 * day);
  col = mix(col, uAtmoColor * 0.9, (1.0 - fres) * 0.10 * day);

  /* And the night side is not merely dark, it is absent: a cloud with nothing
     shining on it is the same colour as the ground it is over. */
  float a = c.a * uOpacity * (0.03 + 0.97 * day);

  vec3 outCol = mix(aces(col), uHazeColor, clamp(uHaze * 0.9, 0.0, 1.0));
  if (a < 0.004) discard;
  fragColor = vec4(outCol, a);
}
`;

export const ATMO_VERT = EARTH_VERT;

/* ── the shell ────────────────────────────────────────────────────────────────
   The band of lit air outside the planet's edge, and the single most
   expensive-looking thing in the first act.

   The first attempt at this was the same fresnel term every WebGL globe uses:
   brightness proportional to how edge-on the shell is. It is wrong, and it is
   wrong in a way that is instantly recognisable — the fresnel peaks at the
   SHELL's own silhouette, which is the outermost edge of the geometry, so the
   result is a hard bright ring floating a few percent off the planet with
   nothing between. Every glow that reads as "three.js" is that ring.

   What this does instead is measure the actual OPTICAL DEPTH: how far a ray
   from the eye travels through the shell of air before it either leaves or hits
   the ground. For a ray whose closest approach to the planet's centre is `b`,
   that length has a closed form, and it behaves the way air behaves — zero at
   the outer edge of the atmosphere, rising as the ray grazes lower, greatest
   just above the horizon, and cut short below it where the ground gets in the
   way. It is four lines of geometry and it is the whole difference.

   Colour is the other half. Air scatters blue away from the sun and lets red
   through toward it, so the shell runs cool where the sun is high and warms to
   a narrow band exactly along the terminator — which is where the thin peach
   horizon in the arrival frame comes from. It is the same physics that makes a
   sunset, applied to the edge of a planet, and none of it is a gradient chosen
   for taste.
   ──────────────────────────────────────────────────────────────────────────── */
export const ATMO_FRAG = /* glsl */ `
${ACES}

uniform vec3 uColor;
uniform vec3 uWarmColor;
uniform vec3 uSun;
uniform float uIntensity;
uniform float uOpacity;
uniform float uRp;   // planet radius
uniform float uRs;   // shell radius
uniform float uScaleHeight; // density e-folding height, as a fraction of uRp

/* Ordered dither, half a code value deep.
   A hundred-pixel-tall band of near-identical blue quantises to eight bits in
   visible steps, and v5 has banned every form of visible grain — so the fix has
   to be below the threshold of perception rather than a texture laid over the
   top. A 4x4 Bayer pattern at ±1/512 breaks the contour and cannot be seen as
   anything at all, which is the entire specification. */
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

in vec2 vUv;
in vec3 vNormalW;
in vec3 vPosW;

out vec4 fragColor;

void main(){
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vPosW - ro);
  vec3 L = normalize(uSun);


  /* Closest approach of this ray to the planet's centre. The impact parameter
     b is the single number that decides how much air the ray crosses. */
  float t = dot(-ro, rd);
  vec3 closest = ro + rd * t;
  float b = length(closest);

  if (b >= uRs || t <= 0.0) discard;

  float outer = sqrt(max(uRs * uRs - b * b, 0.0));
  float depth = b < uRp
    ? outer - sqrt(max(uRp * uRp - b * b, 0.0))  // the ground cuts it short
    : 2.0 * outer;                                // straight through, twice

  /* Normalised against the LONGEST possible path — the ray that just grazes the
     surface — not against the shell's thickness. Against the thickness a ray
     straight down through the atmosphere measures 1.0, the same as a grazing
     ray measures 16, and the whole disc of the planet ends up under a sheet of
     haze. It is the difference between an atmosphere at the edge and a filter
     over the lens. */
  depth /= 2.0 * sqrt(max(uRs * uRs - uRp * uRp, 1e-6));

  /* Air is not a slab of uniform gas with a lid on it — it thins out, and it
     thins out fast. Chord length alone gives every ray inside the shell nearly
     the same reading, which saturates to a flat band of constant colour that
     stops dead at the shell's silhouette: a hard cyan rim around the planet,
     the exact look of a cheap fresnel. Weighting the path by the density where
     it runs closest to the surface is what turns that band into a gradient that
     is brightest on the deck and gone before the shell ends. */
  float h = max(b - uRp, 0.0) / uRp;
  depth *= exp(-h / uScaleHeight);

  // more air is not linearly more light: it saturates, the way real haze does
  depth = 1.0 - exp(-3.4 * clamp(depth, 0.0, 1.4));

  /* How lit that column of air is, sampled where the ray runs closest to the
     planet — which is the part of the column doing the scattering. */
  float ndl = dot(normalize(closest + rd * 1e-4), L);
  float lit = smoothstep(-0.20, 0.22, ndl);
  /* The sunset band. Narrow — a few degrees either side of the terminator — and
     weighted by how lit that column is, so it warms the edge of the day rather
     than glowing on the night side. */
  float sunset = exp(-pow(ndl / 0.055, 2.0));

  vec3 col = mix(uColor * 0.16, uColor, lit);
  col = mix(col, uWarmColor, sunset * 0.28);

  float a = depth * uIntensity * (0.03 + 0.97 * lit) * uOpacity;
  if (a < 0.002) discard;
  fragColor = vec4(aces(col) + bayer(gl_FragCoord.xy) / 255.0, clamp(a, 0.0, 1.0));
}
`;
