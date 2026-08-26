#!/usr/bin/env node
/**
 * gen-earth-v5.mjs — SELORA v5 Earth texture set.
 *
 * Deterministic. Builds the full Earth texture set from NASA public-domain
 * imagery (Blue Marble Next Generation, GEBCO_08 elevation + bathymetry,
 * BMNG land/shallow-water render, BMNG combined cloud map, VIIRS 2012 night).
 *
 *   node tools/gen-earth-v5.mjs
 *   ONLY=albedo,clouds node tools/gen-earth-v5.mjs
 *   MONTH=200408 node tools/gen-earth-v5.mjs        # BMNG month for the albedo
 *   EARTH_SRC=/path/to/nasa node tools/gen-earth-v5.mjs
 *
 * Sources are fetched into EARTH_SRC on demand (curl-free, node fetch).
 * Nothing outside tools/ and public/textures/earth/ is written.
 */

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'public/textures/earth');
const PREV = path.join(HERE, '_preview');
const SRC =
  process.env.EARTH_SRC ||
  '/private/tmp/claude-501/-Users-mateomorina-Downloads-selora/b9831750-e5c1-4f49-b8e9-2030ad49f014/scratchpad/nasa';
const CACHE = process.env.EARTH_CACHE || path.join(SRC, '..', 'cache');

for (const d of [OUT, PREV, SRC, CACHE]) fs.mkdirSync(d, { recursive: true });

sharp.cache(false);
sharp.concurrency(0);

/* ------------------------------------------------------------------ sources */

const EO = 'https://eoimages.gsfc.nasa.gov/images/imagerecords';
const SOURCES = {
  // Blue Marble Next Generation, topography + bathymetry, 5400x2700, per month.
  'bmng-topo-bathy-5400.jpg': `${EO}/74000/74218/world.topo.bathy.200412.3x5400x2700.jpg`,
  'bmng-200408-5400.jpg': `${EO}/73000/73776/world.topo.bathy.200408.3x5400x2700.jpg`,
  // GEBCO_08 revised: land elevation ramp (ocean == 0) and ocean bathymetry ramp (land == 255).
  'gebco-elev-21600.png': `${EO}/73000/73963/gebco_08_rev_elev_21600x10800.png`,
  'gebco-bath-21600.png': `${EO}/73000/73963/gebco_08_rev_bath_21600x10800.png`,
  // Blue Marble land surface + shallow water render. All standing water is a flat (10,10,51).
  'land-shallow-8192.tif': `${EO}/57000/57752/land_shallow_topo_8192.tif`,
  // Blue Marble combined cloud map, 8192x4096. Brightness == optical thickness.
  'cloud-combined-8192.tif': `${EO}/57000/57747/cloud_combined_8192.tif`,
  // Earth at Night 2012 (VIIRS day-night band composite).
  'night-viirs-3600.jpg': `${EO}/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg`,
};

async function ensure(name) {
  const p = path.join(SRC, name);
  if (fs.existsSync(p) && fs.statSync(p).size > 1024) return p;
  const url = SOURCES[name];
  if (!url) throw new Error(`no source url for ${name}`);
  process.stdout.write(`  fetch ${name} ... `);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  console.log(`${(fs.statSync(p).size / 1e6).toFixed(1)} MB`);
  return p;
}

/* ------------------------------------------------------------------- maths */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  S2L[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
const lin2srgb = (v) => {
  v = clamp(v, 0, 1);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};
// 4096-entry reverse LUT so the encode stays cheap and deterministic.
const L2S = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) L2S[i] = Math.round(lin2srgb(i / 4096) * 255);
const enc = (v) => L2S[clamp(Math.round(v * 4096), 0, 4096)];

/** Separable gaussian. Wraps in x (longitude is periodic), clamps in y. */
function blur(src, W, H, sigma) {
  if (sigma <= 0) return Float32Array.from(src);
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp((-i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    s += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * src[row + ((x + i + W * 4) % W)];
      tmp[row + x] = a;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * tmp[clamp(y + i, 0, H - 1) * W + x];
      out[y * W + x] = a;
    }
  }
  return out;
}

/** Integer box downsample of a single-channel float grid. */
function boxDown(src, W, H, f) {
  const w = W / f;
  const h = H / f;
  const out = new Float32Array(w * h);
  const inv = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let j = 0; j < f; j++) {
        const row = (y * f + j) * W + x * f;
        for (let i = 0; i < f; i++) a += src[row + i];
      }
      out[y * w + x] = a * inv;
    }
  }
  return out;
}

/* ------------------------------------------------------------------- cache */

async function cachedRaw(key, build) {
  const p = path.join(CACHE, key);
  if (fs.existsSync(p)) return fs.readFileSync(p);
  const buf = await build();
  fs.writeFileSync(p, buf);
  return buf;
}

const MASK_GRID = 12288; // elevation supersample grid: 6x for 2048, 3x for 4096
const LAKE_GRID = 8192; //  lake supersample grid:      4x for 2048, 2x for 4096

/**
 * Binary water at MASK_GRID, from elevation + bathymetry geometry only.
 *
 *  - GEBCO_08 elevation encodes every ocean pixel as exactly 0, so `elev == 0`
 *    is the true coastline including the whole continental shelf. It has two
 *    known failure modes: inland lakes are filled at their surface elevation
 *    (so they read as land), and land that sits at or below sea level
 *    (Netherlands, the Nile and Ganges deltas, Florida, the Qattara
 *    depression) reads as ocean.
 *  - The Blue Marble land/shallow-water render fixes both. It paints every
 *    standing water body — oceans and lakes alike — with one flat constant
 *    (10,10,51), and it renders real land with imagery in which green
 *    dominates blue. Reading that constant is a look-up of the renderer's
 *    own fill, not a colour threshold on satellite imagery, and the green>blue
 *    test is only ever used to reclaim land inside the elevation==0 set.
 */
async function waterBinary() {
  return cachedRaw(`water-${MASK_GRID}.raw`, async () => {
    const GW = MASK_GRID, GH = MASK_GRID / 2;
    const ef = await ensure('gebco-elev-21600.png');
    const elev = await sharp(ef, { limitInputPixels: false, unlimited: true })
      .resize(GW, GH, { kernel: 'nearest' })
      .toColourspace('b-w')
      .raw()
      .toBuffer();

    const lf = await ensure('land-shallow-8192.tif');
    const LW = LAKE_GRID, LH = LAKE_GRID / 2;
    const ls = await sharp(lf, { limitInputPixels: false })
      .resize(LW, LH, { kernel: 'nearest' })
      .raw()
      .toBuffer();

    const out = Buffer.alloc(GW * GH);
    const sx = LW / GW, sy = LH / GH;
    for (let y = 0; y < GH; y++) {
      const ly = Math.min(LH - 1, (y * sy) | 0);
      for (let x = 0; x < GW; x++) {
        const lx = (x * sx) | 0;
        const j = (ly * LW + lx) * 3;
        const r = ls[j], g = ls[j + 1], b = ls[j + 2];
        const flat = Math.abs(r - 10) < 4 && Math.abs(g - 10) < 4 && Math.abs(b - 51) < 5;
        if (flat) { out[y * GW + x] = 1; continue; }
        // elevation says sea, but the render shows vegetated/desert land
        const warmLand = g - b > 20 || r - b > 24;
        out[y * GW + x] = elev[y * GW + x] === 0 && !warmLand ? 1 : 0;
      }
    }
    return out;
  });
}

/** Antialiased water coverage (0..1) at the requested width. */
async function waterCoverage(W) {
  if (waterCoverage.cache?.[W]) return waterCoverage.cache[W];
  const wb = await waterBinary();
  const cov = boxDown(wb, MASK_GRID, MASK_GRID / 2, MASK_GRID / W);
  (waterCoverage.cache ||= {})[W] = cov;
  return cov;
}

/** GEBCO bathymetry ramp resampled to W (255 = shore/land, low = deep). */
async function bathymetry(W) {
  const buf = await cachedRaw(`bath-${W}.raw`, async () => {
    const f = await ensure('gebco-bath-21600.png');
    return sharp(f, { limitInputPixels: false, unlimited: true })
      .resize(W, W / 2, { kernel: 'lanczos3' })
      .toColourspace('b-w')
      .raw()
      .toBuffer();
  });
  return buf;
}

/** GEBCO land elevation ramp resampled to W. */
async function elevation(W) {
  const buf = await cachedRaw(`elev-${W}.raw`, async () => {
    const f = await ensure('gebco-elev-21600.png');
    return sharp(f, { limitInputPixels: false, unlimited: true })
      .resize(W, W / 2, { kernel: 'lanczos3' })
      .toColourspace('b-w')
      .raw()
      .toBuffer();
  });
  return buf;
}

/* ------------------------------------------------------------------ albedo */

const AW = 4096, AH = 2048;

// Ocean grade. Deep, rich, slightly desaturated blue — measured in linear light
// from these sRGB anchors so the depth ramp interpolates physically.
const OCEAN_DEEP = [17, 41, 71];    // abyssal
const OCEAN_MID = [21, 52, 87];     // basin
const OCEAN_SHELF = [30, 74, 105];  // continental shelf / coastal
const OCEAN_POLAR = [31, 58, 78];   // cold high-latitude water, a touch greyer

function toLin(c) {
  return [S2L[c[0]], S2L[c[1]], S2L[c[2]]];
}
const O_DEEP = toLin(OCEAN_DEEP), O_MID = toLin(OCEAN_MID),
  O_SHELF = toLin(OCEAN_SHELF), O_POLAR = toLin(OCEAN_POLAR);

async function buildAlbedo() {
  const month = process.env.MONTH || '200408';
  // August 2004 is the default grade: the December composite buries Siberia,
  // Canada and northern Europe under snow, which reads as a winter map rather
  // than as "Earth". MONTH=200412 selects the December source instead.
  const srcName = month === '200412' ? 'bmng-topo-bathy-5400.jpg' : `bmng-${month}-5400.jpg`;
  const f = await ensure(srcName);

  const d = await sharp(f, { limitInputPixels: false })
    .resize(AW, AH, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();

  const N = AW * AH;
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    R[i] = S2L[d[i * 3]];
    G[i] = S2L[d[i * 3 + 1]];
    B[i] = S2L[d[i * 3 + 2]];
  }

  const water = await waterCoverage(AW);
  const bathRaw = await bathymetry(AW);
  // Shelf-ness only. Blurred and clipped hard so mid-ocean ridges, fracture
  // zones and seamounts never print through: from space they do not.
  const shelf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const dep = 1 - bathRaw[i] / 255;
    shelf[i] = 1 - smoothstep(0.006, 0.052, dep);
  }
  // A separable min-filter first: the shoreline pixel is 255 (== "no depth")
  // on every coast, and the downsample smears it 1-2 px offshore, which would
  // paint a uniform pale rim even along the Peru-Chile trench where there is
  // no shelf at all. Erosion kills that rim and leaves the real banks
  // (Sunda, Patagonia, the Bahamas, the North Sea) untouched.
  const ER = 4;
  const e1 = new Float32Array(N);
  for (let y = 0; y < AH; y++)
    for (let x = 0; x < AW; x++) {
      let m = 1;
      for (let k = -ER; k <= ER; k++) m = Math.min(m, shelf[y * AW + ((x + k + AW) % AW)]);
      e1[y * AW + x] = m;
    }
  const e2 = new Float32Array(N);
  for (let y = 0; y < AH; y++)
    for (let x = 0; x < AW; x++) {
      let m = 1;
      for (let k = -ER; k <= ER; k++) m = Math.min(m, e1[clamp(y + k, 0, AH - 1) * AW + x]);
      e2[y * AW + x] = m;
    }
  const shelfS = blur(e2, AW, AH, 2.0);

  // ---- ocean synthesis -------------------------------------------------
  // Sea ice must survive: it is bright and near-neutral, ocean never is.
  for (let y = 0; y < AH; y++) {
    const lat = 90 - ((y + 0.5) / AH) * 180;
    const polar = smoothstep(52, 72, Math.abs(lat));
    for (let x = 0; x < AW; x++) {
      const i = y * AW + x;
      const w = water[i];
      if (w <= 0.001) continue;

      const r = R[i], g = G[i], b = B[i];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx > 1e-4 ? (mx - mn) / mx : 0;
      const ice = smoothstep(0.16, 0.34, lum) * (1 - smoothstep(0.22, 0.42, sat));

      // 0 in the basin -> 1 on the continental shelf
      const sh = clamp(shelfS[i], 0, 1);
      const tMid = smoothstep(0.02, 0.38, sh);
      const tShelf = smoothstep(0.50, 0.97, sh);
      let or_ = mix(mix(O_DEEP[0], O_MID[0], tMid), O_SHELF[0], tShelf);
      let og = mix(mix(O_DEEP[1], O_MID[1], tMid), O_SHELF[1], tShelf);
      let ob = mix(mix(O_DEEP[2], O_MID[2], tMid), O_SHELF[2], tShelf);
      or_ = mix(or_, O_POLAR[0], polar * 0.35);
      og = mix(og, O_POLAR[1], polar * 0.35);
      ob = mix(ob, O_POLAR[2], polar * 0.35);

      // clean, faintly cool ice white
      const iw = clamp(lum * 1.10 + 0.06, 0, 1);
      const ir = iw * 0.985, ig = iw * 0.995, ib = iw;

      const cr = mix(or_, ir, ice), cg = mix(og, ig, ice), cb = mix(ob, ib, ice);
      R[i] = mix(r, cr, w);
      G[i] = mix(g, cg, w);
      B[i] = mix(b, cb, w);
    }
  }

  // ---- micro-denoise then meso local contrast ---------------------------
  // Kills sensor/JPEG speckle (v5 bans visible grain) before any contrast lift,
  // so the lift never amplifies noise.
  //
  // Both passes are gated on land. Run over the ocean they would print an
  // unsharp halo along every high-contrast coast — a black outline between the
  // Antarctic ice and the sea — and the meso blur is mask-normalised for the
  // same reason: without it the dark ocean bleeds into the land average and
  // rims the ice with a bright edge.
  const lumBuf = new Float32Array(N);
  const landM = new Float32Array(N);
  const lumL = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    lumBuf[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
    const land = 1 - clamp(water[i], 0, 1);
    landM[i] = land;
    lumL[i] = lumBuf[i] * land;
  }
  const fine = blur(lumBuf, AW, AH, 0.75);
  const mesoNum = blur(lumL, AW, AH, 3.2);
  const mesoDen = blur(landM, AW, AH, 3.2);

  const DENOISE = 0.35;   // pull toward the 0.75px blur
  const LOCAL = 0.34;     // meso local-contrast amount
  for (let i = 0; i < N; i++) {
    const land = landM[i];
    if (land < 0.002) continue;
    const l0 = lumBuf[i];
    if (l0 < 1e-6) continue;
    const meso = mesoDen[i] > 0.02 ? mesoNum[i] / mesoDen[i] : l0;
    const cleaned = mix(l0, fine[i], DENOISE);
    const lifted = cleaned + LOCAL * (cleaned - meso);
    const k = mix(1, clamp(lifted, 0, 4) / l0, land);
    R[i] *= k; G[i] *= k; B[i] *= k;
  }

  // ---- land grade -------------------------------------------------------
  // Done display-referred (sRGB-encoded), the way a colourist would: vibrance
  // in linear light crushes dark vegetation to a clipped primary. Ocean is
  // already graded, so every land op is gated on (1 - water).
  // No global cast, no vignette, no grain.
  const VIB_LOW = 1.16;   // gain on muted material
  const VIB_HIGH = 1.03;  // gain on already-saturated material
  const CONTRAST = 0.15;  // S-curve amount; flat at both ends, so nothing clips
  const LIFT = 0.026;     // shadow lift: BMNG renders rainforest almost black
  const SHOULDER = 0.90;  // soft roll-off so snow keeps tonality instead of clipping

  for (let i = 0; i < N; i++) {
    const land = 1 - clamp(water[i], 0, 1);
    let r = lin2srgb(R[i]), g = lin2srgb(G[i]), b = lin2srgb(B[i]);

    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 1e-4 ? (mx - mn) / mx : 0;

    // vibrance: muted material gains most, saturated material barely moves
    const vib = 1 + (mix(VIB_LOW, VIB_HIGH, smoothstep(0.18, 0.62, sat)) - 1) * land;
    r = lum + (r - lum) * vib;
    g = lum + (g - lum) * vib;
    b = lum + (b - lum) * vib;

    // snow and glacier ice: BMNG leaves a blue-grey cast. Neutralise it to a
    // clean white without inventing brightness.
    const icy = smoothstep(0.60, 0.82, lum) * (1 - smoothstep(0.08, 0.26, sat)) * land;
    if (icy > 0.001) {
      const n = (r + g + b) / 3;
      r = mix(r, n, icy); g = mix(g, n, icy); b = mix(b, n, icy);
    }

    // Gentle S-curve contrast plus a shadow lift, land only. A linear
    // contrast about a mid pivot drives BMNG's near-black rainforest and
    // boreal green straight through zero and destroys the blue channel; an
    // S-curve is flat at both ends, so darks keep their tonality.
    const ct = CONTRAST * land;
    const lf = LIFT * land;
    const tone = (v) => {
      const sc = v + ct * (smoothstep(0, 1, v) - v);
      const lifted = sc + lf * (1 - smoothstep(0, 0.26, sc));
      // soft shoulder: keeps Greenland and Antarctica off a hard 255 clip
      return lifted <= SHOULDER
        ? lifted
        : SHOULDER + (1 - SHOULDER) * 0.73 * (1 - Math.exp(-(lifted - SHOULDER) / (1 - SHOULDER))) / (1 - Math.exp(-1));
    };
    r = tone(r); g = tone(g); b = tone(b);

    R[i] = clamp(r, 0, 1); G[i] = clamp(g, 0, 1); B[i] = clamp(b, 0, 1);
  }

  const out = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    out[i * 3] = Math.round(R[i] * 255);
    out[i * 3 + 1] = Math.round(G[i] * 255);
    out[i * 3 + 2] = Math.round(B[i] * 255);
  }
  return out;
}

/* ------------------------------------------------------------------ clouds */

async function buildClouds() {
  const f = await ensure('cloud-combined-8192.tif');
  const src = await sharp(f, { limitInputPixels: false })
    .toColourspace('b-w')
    .raw()
    .toBuffer();
  const SW = 8192, SH = 4096;

  // 2x box downsample in linear light -> exactly 4096x2048, no ringing, no seam.
  const lin = new Float32Array(SW * SH);
  for (let i = 0; i < lin.length; i++) lin[i] = S2L[src[i]];
  const half = boxDown(lin, SW, SH, 2);

  const N = AW * AH;
  const rgba = Buffer.alloc(N * 4);

  // Cloud body colour: near white, very slightly cool. Thin edges read cooler
  // and greyer, thick cores read white. RGB is written everywhere (including
  // fully transparent pixels) so mipmaps and bilinear taps never pull in black.
  const THIN = [0.855, 0.882, 0.925];
  const THICK = [0.996, 0.996, 1.0];

  for (let i = 0; i < N; i++) {
    const y = (i / AW) | 0;
    const lat = 90 - ((y + 0.5) / AH) * 180;
    // The combined cloud map cannot separate cloud from ice at the caps, so it
    // goes solid white there; left alone it welds a lid onto both poles.
    // Taper it out — earlier in the south, where the ice sheet is permanent
    // and the contamination starts around 65S, than in the north, where an
    // August Arctic is mostly open water and the cloud signal is real.
    const capFade =
      lat >= 0 ? 1 - smoothstep(76, 88, lat) : 1 - smoothstep(64, 82, -lat);

    // back to a perceptual measure of optical thickness
    const v = clamp(Math.pow(half[i], 1 / 2.2), 0, 1);

    // Clear sky must be genuinely clear: everything under the floor goes to
    // alpha 0, so the planet keeps real holes instead of becoming a snowball.
    let a = smoothstep(0.20, 0.78, v);
    a = Math.pow(a, 1.18) * 0.965 * capFade;
    if (a < 0.012) a = 0;

    const t = smoothstep(0.05, 0.75, a);
    rgba[i * 4] = enc(mix(THIN[0], THICK[0], t));
    rgba[i * 4 + 1] = enc(mix(THIN[1], THICK[1], t));
    rgba[i * 4 + 2] = enc(mix(THIN[2], THICK[2], t));
    rgba[i * 4 + 3] = Math.round(clamp(a, 0, 1) * 255);
  }
  return rgba;
}

/* ------------------------------------------------------------------- ocean */

const MW = 2048, MH = 1024;

async function buildOceanMask() {
  const cov = await waterCoverage(MW);
  const out = Buffer.alloc(MW * MH);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(clamp(cov[i], 0, 1) * 255);
  return out;
}

/* ------------------------------------------------------------------ normal */

const NORMAL_SLOPE = 11.0; // gradient -> tangent slope; kept low on purpose

async function buildNormal() {
  const W = 4096, H = 2048;
  const e = await elevation(W);
  const cov = await waterCoverage(W);

  // height in 0..1, land only; ocean is forced flat so the sea has no relief
  const h = new Float32Array(W * H);
  for (let i = 0; i < h.length; i++) {
    const land = 1 - clamp(cov[i], 0, 1);
    h[i] = (e[i] / 255) * land;
  }
  // 8-bit elevation quantises into ~35 m terraces. On steep ground they are
  // sub-pixel, but across the Antarctic and Greenland domes each terrace is
  // tens of pixels wide and would print as a contour band, so blur harder
  // toward the poles. The result is planet-from-space relief, not a relief globe.
  const hA = blur(h, W, H, 2.4);
  const hB = blur(h, W, H, 7.0);
  const hs = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    const t = smoothstep(52, 72, Math.abs(lat));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      hs[i] = mix(hA[i], hB[i], t);
    }
  }

  const nx = new Float32Array(W * H), ny = new Float32Array(W * H), nz = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - ((y + 0.5) / H) * 180;
    // equirectangular x-spacing shrinks with cos(lat); compensate, but clamp
    // hard so nothing smears at the poles
    const kx = Math.min(1 / Math.max(Math.cos((lat * Math.PI) / 180), 0.62), 1.55);
    const y0 = clamp(y - 1, 0, H - 1) * W, y1 = y * W, y2 = clamp(y + 1, 0, H - 1) * W;
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const a = hs[y0 + xm], b = hs[y0 + x], c = hs[y0 + xp];
      const dd = hs[y1 + xm], ff = hs[y1 + xp];
      const g = hs[y2 + xm], hh = hs[y2 + x], ii = hs[y2 + xp];
      const gx = (c + 2 * ff + ii - (a + 2 * dd + g)) * 0.125 * kx;
      const gy = (g + 2 * hh + ii - (a + 2 * b + c)) * 0.125;
      const kres = W / 4096;
      let vx = -gx * NORMAL_SLOPE * kres;
      let vy = gy * NORMAL_SLOPE * kres;
      const vz = 1;
      const len = Math.hypot(vx, vy, vz);
      const i = y1 + x;
      nx[i] = vx / len; ny[i] = vy / len; nz[i] = vz / len;
    }
  }

  // supersample down to 2048 and renormalise, then hard-flatten the ocean
  const dx = boxDown(nx, W, H, 2), dy = boxDown(ny, W, H, 2), dz = boxDown(nz, W, H, 2);
  const cov2 = await waterCoverage(MW);
  const out = Buffer.alloc(MW * MH * 3);
  for (let i = 0; i < MW * MH; i++) {
    let vx = dx[i], vy = dy[i], vz = dz[i];
    const len = Math.hypot(vx, vy, vz) || 1;
    vx /= len; vy /= len; vz /= len;
    const w = clamp(cov2[i], 0, 1);
    // full water -> exactly (128,128,255)
    const fw = smoothstep(0.55, 0.98, w);
    vx = mix(vx, 0, fw); vy = mix(vy, 0, fw); vz = mix(vz, 1, fw);
    const l2 = Math.hypot(vx, vy, vz) || 1;
    out[i * 3] = w >= 0.999 ? 128 : Math.round(clamp((vx / l2) * 0.5 + 0.5, 0, 1) * 255);
    out[i * 3 + 1] = w >= 0.999 ? 128 : Math.round(clamp((vy / l2) * 0.5 + 0.5, 0, 1) * 255);
    out[i * 3 + 2] = w >= 0.999 ? 255 : Math.round(clamp((vz / l2) * 0.5 + 0.5, 0, 1) * 255);
  }
  return out;
}

/* ------------------------------------------------------------------- night */

async function buildNight() {
  const f = await ensure('night-viirs-3600.jpg');
  const d = await sharp(f, { limitInputPixels: false })
    .resize(MW, MH, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  const cov = await waterCoverage(MW);

  // The VIIRS composite paints its unlit background in blue (B >> R,G) and
  // city light in warm near-neutral. min(R,G) separates them cleanly: the
  // brightest background (polar ice) sits at ~15, the dimmest real town at ~25.
  const raw = new Float32Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) raw[i] = Math.min(d[i * 3], d[i * 3 + 1]) / 255;

  // shrink the land mask by ~1px so no glow spills onto water
  const landSoft = new Float32Array(MW * MH);
  for (let i = 0; i < landSoft.length; i++) landSoft[i] = 1 - clamp(cov[i], 0, 1);
  const landBlur = blur(landSoft, MW, MH, 1.1);

  const out = Buffer.alloc(MW * MH);
  for (let y = 0; y < MH; y++) {
    const lat = 90 - ((y + 0.5) / MH) * 180;
    const antarctic = 1 - smoothstep(-62, -55, lat); // 1 south of ~62S
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      let v = smoothstep(0.078, 0.70, raw[i]);   // floor kills the background
      v = Math.pow(v, 1.42) * 0.92;              // restrained: metros and corridors only
      const land = smoothstep(0.55, 0.95, landBlur[i]);
      v *= land * (1 - antarctic);
      if (cov[i] > 0.995) v = 0; // open water is black, no exceptions
      out[i] = Math.round(clamp(v, 0, 1) * 255);
    }
  }
  return out;
}

/* -------------------------------------------------------------- seam seal */

/**
 * The NASA sources are not quite periodic in x: the BMNG mosaic and the
 * combined cloud map both step by 4-6 units across the wrap. Split that step
 * between the two edges and feather the correction K columns inward, so the
 * texture closes exactly without touching anything a viewer can see.
 */
function sealSeamX(buf, W, H, ch, K = 6, keepZeroAlpha = false) {
  for (let y = 0; y < H; y++) {
    for (let c = 0; c < ch; c++) {
      const i0 = (y * W) * ch + c;
      const i1 = (y * W + W - 1) * ch + c;
      const d = (buf[i0] - buf[i1]) / 2;
      if (d === 0) continue;
      for (let k = 0; k < K; k++) {
        const wgt = 1 - k / K;
        const a = (y * W + k) * ch + c;
        const b = (y * W + W - 1 - k) * ch + c;
        if (keepZeroAlpha && ch === 4 && c === 3) {
          if (buf[a] !== 0) buf[a] = clamp(Math.round(buf[a] - d * wgt), 0, 255);
          if (buf[b] !== 0) buf[b] = clamp(Math.round(buf[b] + d * wgt), 0, 255);
        } else {
          buf[a] = clamp(Math.round(buf[a] - d * wgt), 0, 255);
          buf[b] = clamp(Math.round(buf[b] + d * wgt), 0, 255);
        }
      }
    }
  }
  return buf;
}

/* ------------------------------------------------------------------ encode */

async function write(name, buf, w, h, ch, opts) {
  const p = path.join(OUT, name);
  await sharp(buf, { raw: { width: w, height: h, channels: ch } }).webp(opts).toFile(p);
  const size = fs.statSync(p).size;
  console.log(`  ${name.padEnd(14)} ${w}x${h} ${ch}ch  ${(size / 1024).toFixed(0)} KB`);
  return size;
}

/* -------------------------------------------------------------- seam check */

function seam(buf, w, h, ch) {
  let d0 = 0, d1 = 0, base = 0;
  const bx = [w >> 2, w >> 1, (w * 3) >> 2];
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < ch; c++) {
      d0 += Math.abs(buf[(y * w) * ch + c] - buf[(y * w + w - 1) * ch + c]);
      d1 += Math.abs(buf[(y * w + 1) * ch + c] - buf[(y * w + w - 2) * ch + c]);
      for (const x of bx) base += Math.abs(buf[(y * w + x) * ch + c] - buf[(y * w + x + 1) * ch + c]) / bx.length;
    }
  }
  return [d0 / (h * ch), d1 / (h * ch), base / (h * ch)];
}

async function reportSeams(names) {
  console.log('\nseam (mean |col0-colW-1|, |col1-colW-2|) out of 255:');
  for (const n of names) {
    const p = path.join(OUT, n);
    if (!fs.existsSync(p)) continue;
    const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
    const [a, b, base] = seam(data, info.width, info.height, info.channels);
    console.log(
      `  ${n.padEnd(14)} ${String(info.width + 'x' + info.height).padEnd(10)}` +
        ` col0/colW-1 ${a.toFixed(3)}   col1/colW-2 ${b.toFixed(3)}` +
        `   (interior neighbour baseline ${base.toFixed(3)})`
    );
  }
}


/* -------------------------------------------------------------- previews */

const LABEL_H = 26;
function label(text, w) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return Buffer.from(
    `<svg width="${w}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${w}" height="${LABEL_H}" fill="#111318"/>` +
      `<text x="10" y="18" font-family="Helvetica,Arial" font-size="14" fill="#9fb0c8">${esc}</text></svg>`
  );
}

async function panel(img, w, h, text) {
  const body = await sharp(img).resize(w, h, { fit: 'fill' }).png().toBuffer();
  return sharp({ create: { width: w, height: h + LABEL_H, channels: 3, background: '#111318' } })
    .composite([{ input: label(text, w), top: 0, left: 0 }, { input: body, top: LABEL_H, left: 0 }])
    .png()
    .toBuffer();
}

async function buildSheet() {
  const P = (n) => path.join(OUT, n);
  const cells = [];

  cells.push({ b: await panel(P('albedo.webp'), 1024, 512, '1  albedo 4096x2048 (full frame)'), w: 1024, h: 512 });

  // clouds over a mid-blue ground
  const cl = await sharp(P('clouds.webp')).resize(1024, 512).png().toBuffer();
  const overBlue = await sharp({ create: { width: 1024, height: 512, channels: 3, background: '#1b4a78' } })
    .composite([{ input: cl }]).png().toBuffer();
  cells.push({ b: await panel(overBlue, 1024, 512, '4  clouds RGB over mid-blue'), w: 1024, h: 512 });

  // 1:1 crops of the 4096 albedo
  const cropEU = await sharp(P('albedo.webp')).extract({ left: 1848, top: 370, width: 512, height: 512 }).png().toBuffer();
  const cropPAC = await sharp(P('albedo.webp')).extract({ left: 3214, top: 791, width: 512, height: 512 }).png().toBuffer();
  cells.push({ b: await panel(cropEU, 512, 512, '2  1:1 Europe / N. Africa'), w: 512, h: 512 });
  cells.push({ b: await panel(cropPAC, 512, 512, '3  1:1 Pacific / Indonesia'), w: 512, h: 512 });

  const alpha = await sharp(P('clouds.webp')).extractChannel(3).png().toBuffer();
  cells.push({ b: await panel(alpha, 1024, 512, '5  cloud ALPHA alone'), w: 1024, h: 512 });

  cells.push({ b: await panel(P('ocean.webp'), 1024, 512, '6  ocean mask (255 = water)'), w: 1024, h: 512 });
  cells.push({ b: await panel(P('normal.webp'), 1024, 512, '7  normal map'), w: 1024, h: 512 });
  cells.push({ b: await panel(P('night.webp'), 1024, 512, '8  night lights on black'), w: 1024, h: 512 });

  // layout: 2048 wide
  const rows = [
    [cells[0], cells[1]],
    [cells[2], cells[3], cells[4]],
    [cells[5], cells[6]],
    [cells[7]],
  ];
  const G = 8;
  let W = 2048 + G * 3, y = G, comps = [];
  for (const row of rows) {
    let x = G;
    let rh = 0;
    for (const c of row) {
      comps.push({ input: c.b, top: y, left: x });
      x += c.w + G;
      rh = Math.max(rh, c.h + LABEL_H);
    }
    y += rh + G;
  }
  const H = y;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#05070a' } })
    .composite(comps).png().toFile(path.join(PREV, 'earth-v5.png'));
  console.log(`  contact sheet -> ${path.join(PREV, 'earth-v5.png')} ${W}x${H}`);
}

/* --------------------------------------------------------------- globe */

function sampler(buf, w, h, ch) {
  return (lon, lat, out) => {
    let u = (lon + 180) / 360;
    u -= Math.floor(u);
    const v = clamp((90 - lat) / 180, 0, 1);
    const fx = u * w - 0.5, fy = v * h - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const xa = ((x0 % w) + w) % w, xb = ((x0 + 1) % w + w) % w;
    const ya = clamp(y0, 0, h - 1), yb = clamp(y0 + 1, 0, h - 1);
    for (let c = 0; c < ch; c++) {
      const a = buf[(ya * w + xa) * ch + c], b = buf[(ya * w + xb) * ch + c];
      const d = buf[(yb * w + xa) * ch + c], e = buf[(yb * w + xb) * ch + c];
      out[c] = mix(mix(a, b, tx), mix(d, e, tx), ty);
    }
  };
}

async function buildGlobe() {
  const alb = await sharp(path.join(OUT, 'albedo.webp')).raw().toBuffer({ resolveWithObject: true });
  const clo = await sharp(path.join(OUT, 'clouds.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sA = sampler(alb.data, alb.info.width, alb.info.height, 3);
  const sC = sampler(clo.data, clo.info.width, clo.info.height, 4);

  const S = 900;
  const views = [
    { name: 'Americas', lon0: -75, tilt: 12 },
    { name: 'Atlantic / Africa', lon0: 8, tilt: 12 },
    { name: 'Asia / Pacific', lon0: 110, tilt: 12 },
  ];
  // sun from the upper left, slightly in front
  const sun = (() => { const v = [-0.52, 0.50, 0.69]; const l = Math.hypot(...v); return v.map((x) => x / l); })();

  const tiles = [];
  for (const withClouds of [false, true]) {
    for (const view of views) {
      const img = Buffer.alloc(S * S * 3);
      const tr = (view.tilt * Math.PI) / 180, ct = Math.cos(tr), st = Math.sin(tr);
      const ca = [0, 0, 0], cc = [0, 0, 0, 0];
      for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) {
          const sx = (px + 0.5) / S * 2 - 1;
          const sy = 1 - (py + 0.5) / S * 2;
          const r2 = sx * sx + sy * sy;
          const o = (py * S + px) * 3;
          if (r2 > 1) { img[o] = 5; img[o + 1] = 7; img[o + 2] = 10; continue; }
          const sz = Math.sqrt(1 - r2);
          // tilt about x so the north pole leans back
          const nx = sx, ny = sy * ct - sz * st, nz = sy * st + sz * ct;
          const lat = (Math.asin(clamp(ny, -1, 1)) * 180) / Math.PI;
          const lon = (Math.atan2(nx, nz) * 180) / Math.PI + view.lon0;
          sA(lon, lat, ca);
          let R = S2L[Math.round(ca[0])], G = S2L[Math.round(ca[1])], B = S2L[Math.round(ca[2])];
          if (withClouds) {
            sC(lon, lat, cc);
            const a = cc[3] / 255;
            R = mix(R, S2L[Math.round(cc[0])], a);
            G = mix(G, S2L[Math.round(cc[1])], a);
            B = mix(B, S2L[Math.round(cc[2])], a);
          }
          const ndl = sx * sun[0] + sy * sun[1] + sz * sun[2];
          const lam = clamp(ndl, 0, 1);
          const term = smoothstep(-0.06, 0.22, ndl);
          const li = lam * term * 1.28 + 0.012;
          const edge = smoothstep(1.0, 0.985, Math.sqrt(r2)); // 1px antialias
          img[o] = enc(R * li * edge);
          img[o + 1] = enc(G * li * edge);
          img[o + 2] = enc(B * li * edge);
        }
      }
      tiles.push(await panel(await sharp(img, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer(),
        S, S, `${view.name}${withClouds ? '  + clouds' : ''}`));
    }
  }
  const G = 8;
  const comps = [];
  tiles.forEach((t, i) => {
    comps.push({ input: t, top: G + Math.floor(i / 3) * (S + LABEL_H + G), left: G + (i % 3) * (S + G) });
  });
  await sharp({ create: { width: G + 3 * (S + G), height: G + 2 * (S + LABEL_H + G), channels: 3, background: '#05070a' } })
    .composite(comps).png().toFile(path.join(PREV, 'earth-v5-globe.png'));
  console.log(`  globe preview -> ${path.join(PREV, 'earth-v5-globe.png')}`);
}

/* --------------------------------------------------------------------- run */

const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const want = (k) => ONLY.length === 0 || ONLY.includes(k);

async function main() {
  const t0 = Date.now();
  console.log('SELORA earth v5');

  if (want('albedo')) {
    console.log('albedo…');
    const rgb = sealSeamX(await buildAlbedo(), AW, AH, 3);
    await write('albedo.webp', rgb, AW, AH, 3, { quality: 88, effort: 6, smartSubsample: true });
    // mobile: box downsample of the graded 4096 map so both share one grade
    const lo = Buffer.alloc(MW * MH * 3);
    for (let y = 0; y < MH; y++)
      for (let x = 0; x < MW; x++)
        for (let c = 0; c < 3; c++) {
          const a = rgb[((y * 2) * AW + x * 2) * 3 + c], b = rgb[((y * 2) * AW + x * 2 + 1) * 3 + c];
          const cc = rgb[((y * 2 + 1) * AW + x * 2) * 3 + c], dd = rgb[((y * 2 + 1) * AW + x * 2 + 1) * 3 + c];
          lo[(y * MW + x) * 3 + c] = Math.round((a + b + cc + dd) / 4);
        }
    await write('albedo-lo.webp', lo, MW, MH, 3, { quality: 88, effort: 6, smartSubsample: true });
  }

  if (want('clouds')) {
    console.log('clouds…');
    const rgba = sealSeamX(await buildClouds(), AW, AH, 4, 6, true);
    await write('clouds.webp', rgba, AW, AH, 4, {
      quality: 80, alphaQuality: 92, effort: 6, smartSubsample: true,
    });
  }

  if (want('ocean')) {
    console.log('ocean…');
    const m = await buildOceanMask();
    // lossless: a mask that has been through DCT is no longer a mask
    await write('ocean.webp', m, MW, MH, 1, { lossless: true, effort: 6 });
  }

  if (want('normal')) {
    console.log('normal…');
    const n = await buildNormal();
    // lossless: lossy webp drifts the flat ocean up to 31 units off (128,128,255)
    await write('normal.webp', n, MW, MH, 3, { lossless: true, effort: 6 });
  }

  if (want('night')) {
    console.log('night…');
    const n = await buildNight();
    // lossless: lossy webp leaks a few units of light onto open water
    await write('night.webp', n, MW, MH, 1, { lossless: true, effort: 6 });
  }

  if (want('sheet')) { console.log('previews…'); await buildSheet(); await buildGlobe(); }

  await reportSeams(['albedo.webp', 'albedo-lo.webp', 'clouds.webp', 'ocean.webp', 'normal.webp', 'night.webp']);

  const desktop = ['albedo.webp', 'clouds.webp', 'ocean.webp', 'normal.webp', 'night.webp'];
  let total = 0;
  for (const n of desktop) {
    const p = path.join(OUT, n);
    if (fs.existsSync(p)) total += fs.statSync(p).size;
  }
  console.log(`\ndesktop set total ${(total / 1e6).toFixed(2)} MB   (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
