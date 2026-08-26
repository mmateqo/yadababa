/**
 * SELORA — CLOUD OBJECT LIBRARY
 * ─────────────────────────────────────────────────────────────────────────────
 * The site is ONE shader-drawn colour field: pure black in space, warming
 * through navy and cobalt to bright sky blue as the viewer descends. There is
 * no photographic sky any more. Everything here is an OBJECT that sits on top
 * of that field, so the matte is the whole job:
 *
 *   - the background is fully transparent, not "mostly";
 *   - no baked sky colour survives ANYWHERE, including in the partial-alpha
 *     fringe, or the object wears a blue halo against a field that is never the
 *     same blue as the photograph;
 *   - nothing touches its own frame. Every object feathers to alpha 0 well
 *     inside it, and the file is then cropped to the bounding box of what is
 *     actually there, so the asset is the cloud and not a mostly-empty rectangle.
 *
 * Everything is derived from the same film scan the rest of the delivery uses
 * (public/textures/source/cloud-reference.jpg, 665x1182), keyed on the fact
 * that sky is blue (B >> R) and cloud is neutral (R ~ G ~ B):
 *
 *     chroma    = (B - R) / 255
 *     cloudness = smoothstep(0.30, 0.05, chroma)
 *     bright    = smoothstep(0.52, 0.88, luma/255)
 *     alpha     = cloudness * (0.30 + 0.70 * bright)
 *
 * The key is pulled off a BLURRED twin of the photograph so grain cannot punch
 * holes in the matte, while the visible pixels come from the sharp twin so the
 * grain survives in the image.
 *
 * Four structural decisions carry the look:
 *
 *   1. THE SILHOUETTE IS A CUMULUS, NOT AN OVAL. A cumulus is a flat base with a
 *      pile of unequal domes on it — the condensation level is a plane. So the
 *      envelope is a soft union of warped domes cut flat at the bottom
 *      (lobeEnvelope), which reads as cloud instead of as blob, lets each object
 *      be a genuinely different formation, and is a SINGLE COHERENT MASS by
 *      construction because the domes overlap.
 *
 *   2. THE INTERIOR IS SOLID, AND IT IS PHOTOGRAPHIC. A keyed photograph has
 *      sky between its puffs; left alone that punches black holes through the
 *      middle of the object. Inside the envelope the matte is closed, and the
 *      imagery under the closure is not inpainted mush — it is high-passed
 *      micro-billow lifted off the three largest genuinely cloud-only squares in
 *      the negative (99.8% / 94% / 98.7% pure), enlarged the way the plate is.
 *
 *   3. IT IS LIT. A matte with no light direction reads as cut paper. formLight
 *      blows the tops and drops the bases to a cool grey; shadeForm turns each
 *      lobe with the density gradient and a ridged field at LOBE scale, not at
 *      lichen scale.
 *
 *   4. RE-GRAIN AT FINAL SIZE. Enlarging a 665px negative destroys its grain and
 *      leaves smeared JPEG. So the last operation before encode is real
 *      emulsion — the photograph's own high-passed grain, mirrored and re-laid
 *      at 1:1 at the OUTPUT resolution — at amplitude 6-11 on a 0-255 scale.
 *      Never higher: this project has twice been wrecked by a "refinement" pass
 *      that pushed grain up and contrast down into flat pastel mush. The build
 *      prints mean and stdev per channel over the OPAQUE region for every file,
 *      every run, and flags anything that drifts that way.
 *
 * Run: node tools/gen-cloud-objects.mjs        (ONLY=obj-mid-1,obj-near-2 filters)
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import {
  clamp, mix, smoothstep, mulberry32, makeNoise, field, sampleField,
  toU8, blurF32, blurAlpha, octaveBands,
} from './lib-film.mjs';

sharp.cache(false);

const ROOT = '/Users/mateomorina/Downloads/selora';
const SRC = `${ROOT}/public/textures/source/cloud-reference.jpg`;
const OUT = `${ROOT}/public/textures/clouds`;
const PREVIEW = `${ROOT}/tools/_preview`;

/* Grain is OFF, and the limits stay so it cannot come back by accident.

   The plates were originally re-grained at the output size — the reasoning in
   the header is sound photographic practice, and at 1:1 on a print it would be
   right. It is wrong here. These clouds are magnified to fill a 1500-pixel
   frame in the film's last two seconds, where a 9/255 emulsion reads as digital
   noise laid over the one moment the site is asking to be looked at, and the
   brief bans grain, noise and vignette outright. The plate's own structure is
   what makes it a photograph; the emulsion was never doing that work. */
const GRAIN_MIN = 0, GRAIN_MAX = 0;       // hard house limits, 0-255 scale
const SD_FLOOR = 28;                      // per-channel stdev under this is washed out

/* ═══════════════════════ the negative ═══════════════════════ */
const SW = 665, SH = 1182, UP = 2;
let SRC_UP, SRC_KEY, SRC_GRAIN, CLOUD_TEX, UW, UH;

/* The largest genuinely cloud-ONLY squares in the negative, found by an
 * integral-image search on chroma+luma: 220px @32,244 is 99.8% cloud, 200px
 * @104,952 is 94%, 160px @156,776 is 98.7%. High-passed off their own gradient
 * they are pure cumulus micro-billow and emulsion — no edge, no sky, nothing
 * that can repeat visibly once mirrored across a frame. */
const CLOUD_PANELS = [[32, 244, 220, 2.6, 0.21, 1.00], [104, 952, 200, 2.0, 0.83, 0.62], [156, 776, 160, 3.2, -0.52, 0.45]];

async function loadSource() {
  UW = SW * UP; UH = SH * UP;
  SRC_UP = await sharp(SRC).resize(UW, UH, { kernel: 'lanczos3' }).removeAlpha().blur(0.35).raw().toBuffer();
  SRC_KEY = await sharp(SRC).resize(UW, UH, { kernel: 'lanczos3' }).removeAlpha().blur(5.0).raw().toBuffer();

  const nat = await sharp(SRC).removeAlpha().raw().toBuffer();
  const L = new Float32Array(SW * SH);
  for (let k = 0; k < SW * SH; k++) L[k] = 0.2126 * nat[k * 3] + 0.7152 * nat[k * 3 + 1] + 0.0722 * nat[k * 3 + 2];
  const lo = await blurF32(L, SW, SH, 1, 1.5);
  SRC_GRAIN = new Float32Array(SW * SH);
  for (let k = 0; k < SW * SH; k++) SRC_GRAIN[k] = L[k] - lo[k];

  CLOUD_TEX = [];
  for (const [x0, y0, sz, mag, rot, wgt] of CLOUD_PANELS) {
    const es = Math.round(sz * mag);
    // enlarge with lanczos ONCE, exactly as the object itself is enlarged, so the
    // billow keeps the character of a real enlargement rather than of a blur
    const up = await sharp(SRC).extract({ left: x0, top: y0, width: sz, height: sz })
      .resize(es, es, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
    const lum = new Float32Array(es * es);
    for (let k = 0; k < es * es; k++) lum[k] = 0.2126 * up[k * 3] + 0.7152 * up[k * 3 + 1] + 0.0722 * up[k * 3 + 2];
    const pl = await blurF32(lum, es, es, 1, 26);     // keep billow + grain, drop the cloud's own shading
    const hp = new Float32Array(es * es);
    for (let k = 0; k < es * es; k++) hp[k] = lum[k] - pl[k];
    // and take the single-pixel speckle back off: at this enlargement the finest
    // octave of the panel is scanner noise, and laid over a whole object it reads
    // as salt-and-pepper rather than as billow. The emulsion goes back on at the
    // very end, at output scale, where it belongs.
    const sm = await blurF32(hp, es, es, 1, 1.35);
    CLOUD_TEX.push({ arr: sm, w: es, h: es, rot, wgt });
  }
}

function sampleUp(buf, u, v, out) {
  let x = u * UP, y = v * UP;
  x = clamp(x, 0, UW - 1.001); y = clamp(y, 0, UH - 1.001);
  const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0;
  const x1 = x0 + 1 < UW ? x0 + 1 : x0, y1 = y0 + 1 < UH ? y0 + 1 : y0;
  const i00 = (y0 * UW + x0) * 3, i10 = (y0 * UW + x1) * 3;
  const i01 = (y1 * UW + x0) * 3, i11 = (y1 * UW + x1) * 3;
  for (let c = 0; c < 3; c++) {
    out[c] = mix(mix(buf[i00 + c], buf[i10 + c], tx), mix(buf[i01 + c], buf[i11 + c], tx), ty);
  }
}

function mirrorCoord(x, Lg) {
  const p = 2 * Lg;
  let m = x % p; if (m < 0) m += p;
  const v = m < Lg ? m : p - m;
  return v < 0 ? 0 : v > Lg - 1.001 ? Lg - 1.001 : v;
}
function panelAt(P, u, v) {
  const uu = mirrorCoord(u, P.w), vv = mirrorCoord(v, P.h);
  const x0 = uu | 0, y0 = vv | 0, tx = uu - x0, ty = vv - y0;
  const x1 = x0 + 1 < P.w ? x0 + 1 : x0, y1 = y0 + 1 < P.h ? y0 + 1 : y0;
  return mix(mix(P.arr[y0 * P.w + x0], P.arr[y0 * P.w + x1], tx),
    mix(P.arr[y1 * P.w + x0], P.arr[y1 * P.w + x1], tx), ty);
}
/** real cumulus micro-structure laid across a frame, mirror-tiled, never warped
 *  (warping a fine field shears it into fingerprint swirls) */
function cloudTexture(W, H, seed) {
  const out = new Float32Array(W * H);
  for (let li = 0; li < CLOUD_TEX.length; li++) {
    const P = CLOUD_TEX[li];
    const sd = seed + li * 61.7;
    const ca = Math.cos(P.rot), sa = Math.sin(P.rot);
    const ox = (sd * 131) % P.w, oy = (sd * 217) % P.h;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      out[j * W + i] += P.wgt * panelAt(P, i * ca - j * sa + ox, i * sa + j * ca + oy);
    }
  }
  return out;
}

/* ═══════════════════════ crop library ═══════════════════════ */
const CROPS = {
  towerLeft:    { cx: 150, cy: 300,  w: 300, h: 560 },
  towerBottom:  { cx: 235, cy: 860,  w: 430, h: 430 },
  cumRight:     { cx: 545, cy: 555,  w: 240, h: 300 },
  cumRightLow:  { cx: 558, cy: 880,  w: 212, h: 400 },
  bandBottom:   { cx: 332, cy: 1088, w: 640, h: 184 },
  massLeftLow:  { cx: 110, cy: 800,  w: 220, h: 300 },
  puffsCentre:  { cx: 350, cy: 700,  w: 200, h: 170 },
  wispUpper:    { cx: 330, cy: 430,  w: 250, h: 150 },
  wispMid:      { cx: 190, cy: 545,  w: 220, h: 190 },
  puffTopRight: { cx: 540, cy: 120,  w: 250, h: 230 },
  bigUpper:     { cx: 300, cy: 300,  w: 590, h: 570 },
  bigLower:     { cx: 330, cy: 840,  w: 640, h: 660 },
  bigMid:       { cx: 320, cy: 620,  w: 620, h: 560 },
  tornUpper:    { cx: 390, cy: 205,  w: 300, h: 260 },
  midPuffs:     { cx: 480, cy: 480,  w: 260, h: 240 },
  lowBase:      { cx: 300, cy: 1000, w: 460, h: 240 },
};
let magSeen = 0, magWho = '';

/* ═══════════════════════ the matte ═══════════════════════ */
/** one region of the negative, keyed with the house key */
function extractPatch(cropName, pw, ph, opt = {}) {
  const c = CROPS[cropName];
  const { rot = 0, flipX = false, flipY = false, keyLo = 0.30, keyHi = 0.05,
    brightLo = 0.52, brightHi = 0.88, gamma = 1, smear = 0, smearAng = 0 } = opt;
  const nS = smear > 0 ? 13 : 1;
  const sdx = Math.cos(smearAng) * smear, sdy = Math.sin(smearAng) * smear;
  const rgb = new Float32Array(pw * ph * 3);
  const a = new Float32Array(pw * ph);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const px = [0, 0, 0], pk = [0, 0, 0], tA = [0, 0, 0], tB = [0, 0, 0];
  for (let j = 0; j < ph; j++) {
    for (let i = 0; i < pw; i++) {
      let nx = (i + 0.5) / pw - 0.5, ny = (j + 0.5) / ph - 0.5;
      if (flipX) nx = -nx;
      if (flipY) ny = -ny;
      const sx = nx * c.w, sy = ny * c.h;
      const u = c.cx + sx * cr - sy * sr, v = c.cy + sx * sr + sy * cr;
      if (nS === 1) { sampleUp(SRC_UP, u, v, px); sampleUp(SRC_KEY, u, v, pk); }
      else {
        px[0] = px[1] = px[2] = pk[0] = pk[1] = pk[2] = 0;
        for (let t = 0; t < nS; t++) {
          const f = t / (nS - 1) - 0.5;
          sampleUp(SRC_UP, u + sdx * f, v + sdy * f, tA);
          sampleUp(SRC_KEY, u + sdx * f, v + sdy * f, tB);
          for (let ch = 0; ch < 3; ch++) { px[ch] += tA[ch] / nS; pk[ch] += tB[ch] / nS; }
        }
      }
      // sampleUp clamps at the photo border; that would smear the edge row into a
      // straight band, so anything out of bounds is simply not cloud
      const inb = smoothstep(0, 10, u) * smoothstep(0, 10, SW - 1 - u)
        * smoothstep(0, 10, v) * smoothstep(0, 10, SH - 1 - v);
      const k = j * pw + i;
      rgb[k * 3] = px[0]; rgb[k * 3 + 1] = px[1]; rgb[k * 3 + 2] = px[2];
      const chroma = (pk[2] - pk[0]) / 255;
      const luma = 0.2126 * pk[0] + 0.7152 * pk[1] + 0.0722 * pk[2];
      let al = clamp(smoothstep(keyLo, keyHi, chroma) * (0.30 + 0.70 * smoothstep(brightLo, brightHi, luma / 255)), 0, 1);
      if (gamma !== 1) al = Math.pow(al, gamma);
      a[k] = al * inb;
    }
  }
  return { rgb, a, w: pw, h: ph };
}

/**
 * Kill the blue fringe. Wherever alpha is partial the RGB must already be the
 * OBJECT's own tone; any sky left there shows as a coloured halo against a field
 * that is never the same blue as the photograph's.
 */
function cleanMatte(p, amount = 0.95) {
  const { rgb, a, w, h } = p;
  for (let k = 0; k < w * h; k++) {
    const t = (1 - a[k]) * amount;
    if (t <= 0.001) continue;
    const r = rgb[k * 3], g = rgb[k * 3 + 1], b = rgb[k * 3 + 2];
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const Lc = mix(L, 255, 0.30);
    rgb[k * 3] = mix(r, Lc * 0.982, t);
    rgb[k * 3 + 1] = mix(g, Lc * 0.998, t);
    rgb[k * 3 + 2] = mix(b, Lc * 1.014, t);
  }
}

/** organic silhouette cut on one patch, so a patch can never show its rectangle */
function organicEdge(p, N, seed, o = {}) {
  const { fw = 0.42, pn = 2.6, ax = 0.94, ay = 0.94, ox = 0, oy = 0, warp = 0.42 } = o;
  const { a, w, h } = p;
  const f1 = field(w, h, 5, (x, y) => N.warped(x / (w * 0.34) + seed * 3.1, y / (h * 0.34) - seed * 1.7, 1.25, 5));
  const f2 = field(w, h, 3, (x, y) => N.turb(x / (w * 0.145) + seed * 7.3, y / (h * 0.145) - seed * 4.1, 4));
  const inner = Math.max(0.06, 1 - fw);
  for (let j = 0; j < h; j++) {
    const v = (j + 0.5) / h;
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (a[k] <= 0.0015) continue;
      const u = (i + 0.5) / w;
      const n = sampleField(f1, i, j), n2 = sampleField(f2, i, j);
      const du = Math.abs((u - 0.5 - ox) * 2 * ax), dv = Math.abs((v - 0.5 - oy) * 2 * ay);
      let d = Math.pow(Math.pow(du, pn) + Math.pow(dv, pn), 1 / pn);
      d = d * (1 + warp * n) + warp * 0.22 * n2;
      const safe = smoothstep(0, 0.05, u) * smoothstep(0, 0.05, 1 - u)
        * smoothstep(0, 0.05, v) * smoothstep(0, 0.05, 1 - v);
      a[k] *= smoothstep(1.0, inner, d) * safe;
    }
  }
}

function over(dst, dstA, dw, dh, p, ox, oy, opacity = 1) {
  const { rgb, a, w, h } = p;
  for (let j = 0; j < h; j++) {
    const dy = oy + j;
    if (dy < 0 || dy >= dh) continue;
    for (let i = 0; i < w; i++) {
      const dx = ox + i;
      if (dx < 0 || dx >= dw) continue;
      const s = j * w + i, d = dy * dw + dx;
      const al = a[s] * opacity;
      if (al <= 0.0015) continue;
      const ia = 1 - al;
      dst[d * 3] = dst[d * 3] * ia + rgb[s * 3] * al;
      dst[d * 3 + 1] = dst[d * 3 + 1] * ia + rgb[s * 3 + 1] * al;
      dst[d * 3 + 2] = dst[d * 3 + 2] * ia + rgb[s * 3 + 2] * al;
      dstA[d] = dstA[d] * ia + al;
    }
  }
}

/* ═══════════════════════ grade / form ═══════════════════════ */
function grade(rgb, n, { contrast = 1, pivot = 200, lift = 0, sat = 1, gain = 1, tint = [1, 1, 1] } = {}) {
  for (let k = 0; k < n; k++) {
    let r = rgb[k * 3], g = rgb[k * 3 + 1], b = rgb[k * 3 + 2];
    if (sat !== 1) {
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = mix(L, r, sat); g = mix(L, g, sat); b = mix(L, b, sat);
    }
    rgb[k * 3] = (((r - pivot) * contrast + pivot) * gain + lift) * tint[0];
    rgb[k * 3 + 1] = (((g - pivot) * contrast + pivot) * gain + lift) * tint[1];
    rgb[k * 3 + 2] = (((b - pivot) * contrast + pivot) * gain + lift) * tint[2];
  }
}

/** acutance recovery after the final resample. Deliberately gentle: a hard
 *  unsharp on a 3x enlargement of a JPEG makes crumpled foil, not cumulus. */
async function localContrast(rgb, w, h, a1, a2) {
  if (a1 <= 0 && a2 <= 0) return;
  const b1 = await blurF32(rgb, w, h, 3, 2.4);
  const b2 = await blurF32(rgb, w, h, 3, 11.0);
  for (let i = 0; i < rgb.length; i++) {
    rgb[i] = clamp(rgb[i] + (rgb[i] - b1[i]) * a1 + (b1[i] - b2[i]) * a2, 0, 255);
  }
}

function liftHighlights(rgb, n, amt = 0.15, lo = 0.76, hi = 0.99) {
  for (let k = 0; k < n; k++) {
    const r = rgb[k * 3], g = rgb[k * 3 + 1], b = rgb[k * 3 + 2];
    const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const t = smoothstep(lo, hi, L) * amt;
    if (t <= 0.002) continue;
    rgb[k * 3] = r + (250 - r) * t;
    rgb[k * 3 + 1] = g + (252 - g) * t;
    rgb[k * 3 + 2] = b + (254 - b) * t;
  }
}

/**
 * Local turn. Two terms from ONE light: the gradient of the blurred density
 * turns the whole mass, the gradient of a warped ridged field makes the
 * cauliflower read. bumpScale is quoted in fractions of the frame and is kept
 * at LOBE scale — push it small and the interior becomes lichen.
 */
async function shadeForm(rgb, dens, W, H, N, seed, o = {}) {
  const { lx = 0.58, ly = -0.81, macro = 1.0, billow = 0.42, amt = 46,
    bumpScale = 0.155, shadow = [178, 194, 209] } = o;
  const D = await blurAlpha(dens, W, H, Math.max(10, W * 0.022));
  const bump = field(W, H, 3, (x, y) => N.warpedRidged((x + seed * 41) / (W * bumpScale), (y - seed * 23) / (W * bumpScale), 1.2, 4));
  const bump2 = field(W, H, 3, (x, y) => N.warpedRidged((x - seed * 17) / (W * bumpScale * 0.46), (y + seed * 29) / (W * bumpScale * 0.46), 1.1, 3));
  const gs = Math.max(4, Math.round(W * 0.006));
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const xm = i - gs < 0 ? 0 : i - gs, xp = i + gs >= W ? W - 1 : i + gs;
      const ym = j - gs < 0 ? 0 : j - gs, yp = j + gs >= H ? H - 1 : j + gs;
      const dgx = (D[j * W + xp] - D[j * W + xm]) * 22;
      const dgy = (D[yp * W + i] - D[ym * W + i]) * 22;
      const bgx = (sampleField(bump, i + gs, j) - sampleField(bump, i - gs, j)) * 3.6
        + (sampleField(bump2, i + gs, j) - sampleField(bump2, i - gs, j)) * 1.5;
      const bgy = (sampleField(bump, i, j + gs) - sampleField(bump, i, j - gs)) * 3.6
        + (sampleField(bump2, i, j + gs) - sampleField(bump2, i, j - gs)) * 1.5;
      const inside = D[k];
      let s = (dgx * lx + dgy * ly) * macro + (bgx * lx + bgy * ly) * billow * inside;
      s = clamp(s, -1.5, 1.2);
      const d = s * amt;
      if (d >= 0) {
        rgb[k * 3] += d * 0.55; rgb[k * 3 + 1] += d * 0.56; rgb[k * 3 + 2] += d * 0.55;
      } else {
        const t = clamp(-d / 90, 0, 0.88);
        rgb[k * 3] = mix(rgb[k * 3], shadow[0], t);
        rgb[k * 3 + 1] = mix(rgb[k * 3 + 1], shadow[1], t);
        rgb[k * 3 + 2] = mix(rgb[k * 3 + 2], shadow[2], t);
      }
    }
  }
}

/**
 * The big light. Every cut-out matte is missing this: a cloud is lit from above,
 * so it is blown out along the top and heavy, cool and grey underneath. Without
 * it the object is a white silhouette with texture on it.
 *
 * The gradient runs along the MASS, not down the frame, and it does so LOCALLY:
 * for every column the top and bottom of the density are measured, so a low
 * shelf gets its own lit top and shaded underside instead of being uniformly at
 * the bottom of a frame-wide ramp. That single change is what stops a wide flat
 * lobe from rendering as a slab of grey cardboard — and because it puts a full
 * tonal range into every part of the object rather than only into the tall
 * parts, it is also most of the measured stdev.
 *
 * `global` keeps some of the frame-wide ramp: a shelf under a tower really is in
 * the tower's shadow, it just is not featureless.
 */
async function formLight(rgb, a, W, H, N, seed, o = {}) {
  const { top = 0.30, base = 0.82, deep = 0.72, lit = 0.34, wob = 0.12, side = 0,
    global: gMix = 0.40, minSpan = 0.115, dm = 10,
    shadow = [166, 185, 202], hi = [250, 252, 253] } = o;
  const D = await blurAlpha(a, W, H, Math.max(8, W * 0.020));
  /* per-column extent of the mass */
  const THR = 0.30;
  const cTop = new Float32Array(W).fill(-1), cBot = new Float32Array(W).fill(-1);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) if (D[j * W + i] > THR) { cTop[i] = j / (H - 1); break; }
    for (let j = H - 1; j >= 0; j--) if (D[j * W + i] > THR) { cBot[i] = j / (H - 1); break; }
  }
  // columns with no mass inherit the nearest column that has some, so the ramp
  // stays continuous across a gap instead of snapping
  const fill = (arr, fb) => {
    let last = -1;
    for (let i = 0; i < W; i++) { if (arr[i] >= 0) last = arr[i]; else if (last >= 0) arr[i] = last; }
    last = -1;
    for (let i = W - 1; i >= 0; i--) { if (arr[i] >= 0) last = arr[i]; else if (last >= 0) arr[i] = last; }
    for (let i = 0; i < W; i++) if (arr[i] < 0) arr[i] = fb;
  };
  fill(cTop, top); fill(cBot, base);
  const smooth = (arr) => {
    const r = Math.max(2, Math.round(W * 0.055));
    const out = new Float32Array(W);
    let acc = 0, cnt = 0;
    for (let i = 0; i <= Math.min(r, W - 1); i++) { acc += arr[i]; cnt++; }
    for (let i = 0; i < W; i++) {
      out[i] = acc / cnt;
      const add = i + r + 1, rem = i - r;
      if (add < W) { acc += arr[add]; cnt++; }
      if (rem >= 0) { acc -= arr[rem]; cnt--; }
    }
    return out;
  };
  const sTop = smooth(cTop), sBot = smooth(cBot);
  const gSpan = Math.max(0.05, base - top);
  const fw2 = field(W, H, 5, (x, y) => N.warped(x / (W * 0.22) + seed * 6.1, y / (H * 0.22) - seed * 3.3, 1.2, 4));
  const fw3 = field(W, H, 4, (x, y) => N.warpedTurb(x / (W * 0.085) - seed * 2.7, y / (H * 0.085) + seed * 8.3, 1.1, 4));
  // large-scale density drift: a real cloud is not one tone with texture on it
  const fdm = field(W, H, 6, (x, y) => N.warped(x / (W * 0.185) + seed * 11.3, y / (H * 0.185) - seed * 7.9, 1.25, 5));
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (a[k] <= 0.004) continue;
      const u = (i + 0.5) / W;
      const n = sampleField(fw2, i, j), n2 = sampleField(fw3, i, j);
      const lSpan = Math.max(minSpan, sBot[i] - sTop[i]);
      const tLoc = (v - sTop[i]) / lSpan;
      const tGlo = (v - top) / gSpan;
      const t = clamp(mix(tLoc, tGlo, gMix) + wob * n + wob * 0.45 * n2 + side * (u - 0.5), -0.3, 1.3);
      // weight by density: a thin edge of cloud is lit THROUGH, so it is never
      // the darkest thing in frame. Without this the feathered rim goes to the
      // base tone and the object reads as a cut-out with a burnt edge.
      const dens = smoothstep(0.16, 0.72, a[k]);
      const sh = smoothstep(0.34, 1.06, t) * deep * dens;
      if (sh > 0.002) {
        rgb[k * 3] = mix(rgb[k * 3], shadow[0], sh);
        rgb[k * 3 + 1] = mix(rgb[k * 3 + 1], shadow[1], sh);
        rgb[k * 3 + 2] = mix(rgb[k * 3 + 2], shadow[2], sh);
      }
      const b = smoothstep(0.34, -0.08, t) * lit;
      if (b > 0.002) {
        rgb[k * 3] = mix(rgb[k * 3], hi[0], b);
        rgb[k * 3 + 1] = mix(rgb[k * 3 + 1], hi[1], b);
        rgb[k * 3 + 2] = mix(rgb[k * 3 + 2], hi[2], b);
      }
      if (dm) {
        const d = sampleField(fdm, i, j) * dm * dens;
        rgb[k * 3] += d * 0.98; rgb[k * 3 + 1] += d; rgb[k * 3 + 2] += d * 1.02;
      }
    }
  }
}

/**
 * The edge of a cumulus scatters light forward, so the thinnest cloud in frame is
 * the BRIGHTEST, not the darkest. This is the single thing that separates a
 * photographed cloud from a matte painting: without it the feathered rim carries
 * whatever tone the body had and the object reads as a sticker with a ragged,
 * slightly burnt edge. Peaks where the matte is thin but present, and is rolled
 * off again as alpha approaches zero so it can never glow into empty sky.
 */
function edgeGlow(rgb, a, n, o = {}) {
  const { amt = 0.42, lo = 0.03, mid = 0.22, hi = 0.78, tone = [249, 251, 252] } = o;
  for (let k = 0; k < n; k++) {
    const al = a[k];
    if (al <= lo || al >= hi) continue;
    const t = smoothstep(lo, mid, al) * smoothstep(hi, mid, al) * amt;
    if (t <= 0.002) continue;
    rgb[k * 3] = mix(rgb[k * 3], tone[0], t);
    rgb[k * 3 + 1] = mix(rgb[k * 3 + 1], tone[1], t);
    rgb[k * 3 + 2] = mix(rgb[k * 3 + 2], tone[2], t);
  }
}

/* ── inpainting: fill the frame with cloud, FROM cloud ── */
function boxBlurF(src, w, h, r, out) {
  const tmp = new Float32Array(w * h);
  const dst = out || new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0, cnt = 0;
    const first = Math.min(r, w - 1);
    for (let x = 0; x <= first; x++) { acc += src[row + x]; cnt++; }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / cnt;
      const add = x + r + 1, rem = x - r;
      if (add < w) { acc += src[row + add]; cnt++; }
      if (rem >= 0) { acc -= src[row + rem]; cnt--; }
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0, cnt = 0;
    const first = Math.min(r, h - 1);
    for (let y = 0; y <= first; y++) { acc += tmp[y * w + x]; cnt++; }
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc / cnt;
      const add = y + r + 1, rem = y - r;
      if (add < h) { acc += tmp[add * w + x]; cnt++; }
      if (rem >= 0) { acc -= tmp[rem * w + x]; cnt--; }
    }
  }
  return dst;
}
/**
 * The keyed patches leave gaps. Their LOW-FREQUENCY colour is inpainted by a
 * coarse-to-fine push-pull over the keyed pixels only — nothing that was ever
 * sky can end up under a thin part of the matte — and the structure that goes
 * back on top of it is real photographed cumulus (CLOUD_TEX), not noise, so a
 * closed hole still looks like the inside of a cloud.
 */
function cloudFill(rgb, a, W, H, tex, texAmt, radii = [220, 90, 34, 12]) {
  const n = W * H;
  const wt = new Float32Array(n);
  const chan = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let k = 0; k < n; k++) {
    const al = a[k];
    wt[k] = al;
    chan[0][k] = rgb[k * 3] * al; chan[1][k] = rgb[k * 3 + 1] * al; chan[2][k] = rgb[k * 3 + 2] * al;
  }
  const fill = new Float32Array(n * 3);
  for (let k = 0; k < n * 3; k++) fill[k] = 232;
  for (const r of radii) {
    const bw = boxBlurF(wt, W, H, r);
    const bc = chan.map((t) => boxBlurF(t, W, H, r));
    for (let k = 0; k < n; k++) {
      if (bw[k] < 0.012) continue;
      const inv = 1 / bw[k];
      fill[k * 3] = bc[0][k] * inv; fill[k * 3 + 1] = bc[1][k] * inv; fill[k * 3 + 2] = bc[2][k] * inv;
    }
  }
  for (let k = 0; k < n; k++) {
    const t = clamp(a[k] * 1.6, 0, 1);
    // where the photograph had nothing, give the inpaint real cumulus structure
    const d = tex ? tex[k] * texAmt * (1 - t * 0.58) : 0;
    rgb[k * 3] = mix(fill[k * 3] + d * 0.99, rgb[k * 3], t);
    rgb[k * 3 + 1] = mix(fill[k * 3 + 1] + d, rgb[k * 3 + 1], t);
    rgb[k * 3 + 2] = mix(fill[k * 3 + 2] + d * 1.01, rgb[k * 3 + 2], t);
  }
}

/**
 * Final chroma guard. Cloud shadow IS cool — that is the house look — but it is
 * cool GREY, and only a deep matte may carry much of it. Anywhere alpha is thin
 * the pixel must be near neutral or the object fringes blue on a field whose
 * blue is not the photograph's. Luma-preserving: dR = +0.2536t, dB = -0.7464t.
 */
function clampChroma(rgb, a, n, thin = 4, thick = 22) {
  for (let k = 0; k < n; k++) {
    const c = rgb[k * 3 + 2] - rgb[k * 3];
    const lim = mix(thin, thick, smoothstep(0.12, 0.80, a[k]));
    if (c <= lim) continue;
    const t = c - lim;
    rgb[k * 3] += t * 0.2536;
    rgb[k * 3 + 2] -= t * 0.7464;
  }
}

function flattenInvisible(rgb, a, n, tone = [233, 239, 244]) {
  for (let k = 0; k < n; k++) {
    if (a[k] > 0.03) continue;
    const t = 1 - a[k] / 0.03;
    rgb[k * 3] = mix(rgb[k * 3], tone[0], t);
    rgb[k * 3 + 1] = mix(rgb[k * 3 + 1], tone[1], t);
    rgb[k * 3 + 2] = mix(rgb[k * 3 + 2], tone[2], t);
  }
}

/* ═══════════════════════ envelope ═══════════════════════ */
/**
 * A cumulus is not an oval. It is a CLUSTER OF DOMES ON A FLAT BASE — the
 * condensation level is a plane, so the bottom is a nearly straight cut and
 * everything above it is cauliflower.
 *
 * So the silhouette is a soft union of domain-warped domes with a wavy base cut,
 * not a superellipse. That does three jobs at once: it reads as cumulus rather
 * than as blob; each object can be a materially different formation just by
 * moving domes; and because the domes overlap it is a SINGLE COHERENT MASS by
 * construction. Only the transition band is torn by noise — the core stays
 * solid — and everything is multiplied by a hard border window so the outermost
 * pixels are exactly zero whatever the noise does.
 *
 * lobes are [u, v, rx, ry, weight]; rx/ry are fractions of the frame.
 */
function lobeEnvelope(W, H, N, seed, o = {}) {
  const { lobes, feather = 0.72, warp = 0.045, bump = 0.13, tear = 0.45, ts = 0.13,
    baseY = null, baseSoft = 0.10, baseWob = 0.030, safe = 0.038 } = o;
  const f1 = field(W, H, 6, (x, y) => N.warped(x / (W * 0.30) + seed * 3.1, y / (H * 0.30) - seed * 1.7, 1.3, 5));
  const f2 = field(W, H, 6, (x, y) => N.warped(x / (W * 0.27) - seed * 2.3, y / (H * 0.27) + seed * 4.9, 1.3, 5));
  const f3 = field(W, H, 3, (x, y) => N.turb(x / (W * 0.070) + seed * 7.3, y / (H * 0.070) - seed * 4.1, 4));
  // cauliflower: ridged noise at LOBE scale, so it makes billows, not lichen
  const fb = field(W, H, 3, (x, y) => N.warpedRidged(x / (W * 0.105) + seed * 2.9, y / (H * 0.105) + seed * 5.5, 1.15, 4));
  const ft = field(W, H, 4, (x, y) => N.warped(x / (W * ts) + seed * 5.7, y / (H * ts) + seed * 2.3, 1.25, 5));
  const fbase = field(W, H, 6, (x) => N.fbm(x / (W * 0.26) + seed * 4.4, seed * 2.2, 4));
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const v0 = (j + 0.5) / H;
    for (let i = 0; i < W; i++) {
      const u0 = (i + 0.5) / W;
      const n1 = sampleField(f1, i, j), n2 = sampleField(f2, i, j), n3 = sampleField(f3, i, j);
      const nb = sampleField(fb, i, j) * 2 - 0.9;
      // domain-warp the sample point: the domes stop being circles
      const u = u0 + warp * n1 + warp * 0.35 * n3;
      const v = v0 + warp * n2 + warp * 0.35 * n3;
      let inv = 1;
      for (let Li = 0; Li < lobes.length; Li++) {
        const lo = lobes[Li];
        const du = (u - lo[0]) / lo[2], dv = (v - lo[1]) / lo[3];
        const d = Math.sqrt(du * du + dv * dv) + bump * nb;
        inv *= 1 - smoothstep(1.0, feather, d) * (lo[4] ?? 1);
      }
      let m = 1 - inv;
      const band = 4 * m * (1 - m);
      if (tear > 0 && band > 0.01) {
        const nt = sampleField(ft, i, j);
        m *= mix(1, smoothstep(-0.44, 0.44, nt + 0.5 * n3), band * tear);
      }
      if (baseY != null) {
        const yb = baseY + baseWob * sampleField(fbase, i, j) + baseWob * 0.62 * n3;
        m *= smoothstep(yb + baseSoft, yb, v0);
      }
      const sf = smoothstep(0, safe, u0) * smoothstep(0, safe, 1 - u0)
        * smoothstep(0, safe, v0) * smoothstep(0, safe, 1 - v0);
      out[j * W + i] = m * sf;
    }
  }
  return out;
}

/* ═══════════════════════ grain, at the OUTPUT size ═══════════════════════ */
function grainAt(u, v) {
  const x0 = u | 0, y0 = v | 0, tx = u - x0, ty = v - y0;
  const x1 = x0 + 1 < SW ? x0 + 1 : x0, y1 = y0 + 1 < SH ? y0 + 1 : y0;
  return mix(mix(SRC_GRAIN[y0 * SW + x0], SRC_GRAIN[y0 * SW + x1], tx),
    mix(SRC_GRAIN[y1 * SW + x0], SRC_GRAIN[y1 * SW + x1], tx), ty);
}
/* The plate is a ~3x enlargement of the negative, so what a viewer sees as
 * "grain" is a 2-4px clump, not a single pixel. Sampling the emulsion at three
 * magnifications and three rotations reproduces that without ever repeating. */
const GRAIN_SCALES = [{ s: 2.0, w: 0.92, rot: 0.37 }, { s: 1.0, w: 0.50, rot: -0.91 }, { s: 3.8, w: 0.34, rot: 1.71 }];
/** the photograph's own emulsion, re-laid at 1:1 over the finished frame */
function filmTexture(W, H, seed) {
  const out = new Float32Array(W * H);
  for (let li = 0; li < GRAIN_SCALES.length; li++) {
    const Lg = GRAIN_SCALES[li];
    const sd = seed + li * 97.3;
    const ca = Math.cos(Lg.rot) / Lg.s, sa = Math.sin(Lg.rot) / Lg.s;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        out[j * W + i] += Lg.w * grainAt(mirrorCoord(i * ca - j * sa + sd * 131, SW), mirrorCoord(i * sa + j * ca + sd * 217, SH));
      }
    }
  }
  return out;
}
function normalise(arr, n) {
  let m = 0; for (let i = 0; i < n; i++) m += arr[i]; m /= n;
  let s = 0; for (let i = 0; i < n; i++) s += (arr[i] - m) ** 2;
  s = Math.sqrt(s / n) || 1;
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = (arr[i] - m) / s;
  return o;
}

/* ═══════════════════════ measurement ═══════════════════════ */
/** mean and stdev PER CHANNEL over the opaque region only (alpha > 0.5) */
async function measure(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, n = W * H;
  const sum = [0, 0, 0], sq = [0, 0, 0];
  let cnt = 0, aSum = 0, aMax = 0;
  for (let k = 0; k < n; k++) {
    const av = data[k * 4 + 3];
    aSum += av; if (av > aMax) aMax = av;
    if (av <= 127) continue;
    cnt++;
    for (let c = 0; c < 3; c++) { const v = data[k * 4 + c]; sum[c] += v; sq[c] += v * v; }
  }
  const mean = sum.map((s) => s / Math.max(cnt, 1));
  const sd = sq.map((s, c) => Math.sqrt(Math.max(0, s / Math.max(cnt, 1) - mean[c] ** 2)));
  // hf-sigma of the ENCODED file inside the body: proves the grain survived WebP
  const lum = new Float32Array(n);
  for (let k = 0; k < n; k++) lum[k] = 0.2126 * data[k * 4] + 0.7152 * data[k * 4 + 1] + 0.0722 * data[k * 4 + 2];
  const hfThr = Math.max(96, aMax * 0.72);
  let hs = 0, hm = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (data[(y * W + x) * 4 + 3] < hfThr) continue;
    let s2 = 0;
    for (let dy = -1; dy < 2; dy++) for (let dx = -1; dx < 2; dx++) s2 += lum[(y + dy) * W + x + dx];
    const d = lum[y * W + x] - s2 / 9; hs += d * d; hm++;
  }
  // border alpha: the single most important number. Must be 0.
  let borderMax = 0;
  const B = 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= B && x < W - B && y >= B && y < H - B) continue;
    const av = data[(y * W + x) * 4 + 3];
    if (av > borderMax) borderMax = av;
  }
  // worst chroma anywhere the pixel is visible at all, and worst in the fringe
  let chromaMax = 0, fringeChroma = 0;
  for (let k = 0; k < n; k++) {
    const av = data[k * 4 + 3];
    if (av < 8) continue;
    const c = data[k * 4 + 2] - data[k * 4];
    if (c > chromaMax) chromaMax = c;
    if (av < 96 && c > fringeChroma) fringeChroma = c;
  }
  return {
    W, H, mean, sd, meanAlpha: aSum / n / 255, maxAlpha: aMax / 255, opaqueFrac: cnt / n,
    hf: Math.sqrt(hs / Math.max(hm, 1)), borderMax, chromaMax, fringeChroma,
  };
}

/** largest connected component of the matte, as a share of total alpha */
function coherence(a, W, H, thr) {
  const n = W * H;
  const lab = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  let best = 0, total = 0;
  for (let k = 0; k < n; k++) if (a[k] > thr) total += a[k];
  for (let start = 0; start < n; start++) {
    if (lab[start] !== -1 || a[start] <= thr) continue;
    let sp = 0; stack[sp++] = start; lab[start] = start;
    let mass = 0;
    while (sp > 0) {
      const k = stack[--sp];
      mass += a[k];
      const x = k % W, y = (k / W) | 0;
      if (x > 0 && lab[k - 1] === -1 && a[k - 1] > thr) { lab[k - 1] = start; stack[sp++] = k - 1; }
      if (x < W - 1 && lab[k + 1] === -1 && a[k + 1] > thr) { lab[k + 1] = start; stack[sp++] = k + 1; }
      if (y > 0 && lab[k - W] === -1 && a[k - W] > thr) { lab[k - W] = start; stack[sp++] = k - W; }
      if (y < H - 1 && lab[k + W] === -1 && a[k + W] > thr) { lab[k + W] = start; stack[sp++] = k + W; }
    }
    if (mass > best) best = mass;
  }
  return total > 0 ? best / total : 0;
}

function signature(a, W, H) {
  const S = 64, out = new Float64Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x0 = Math.floor(i * W / S), x1 = Math.max(x0 + 1, Math.floor((i + 1) * W / S));
    const y0 = Math.floor(j * H / S), y1 = Math.max(y0 + 1, Math.floor((j + 1) * H / S));
    let s = 0, c = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { s += a[y * W + x]; c++; }
    out[j * S + i] = s / c;
  }
  return out;
}
function ncc(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
  ma /= a.length; mb /= b.length;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; n += x * y; da += x * x; db += y * y; }
  return n / Math.sqrt(Math.max(da * db, 1e-9));
}
const SIGS = [];

function bbox(a, W, H, thr) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (a[j * W + i] <= thr) continue;
    if (i < x0) x0 = i; if (i > x1) x1 = i;
    if (j < y0) y0 = j; if (j > y1) y1 = j;
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
  return { x0, y0, x1, y1 };
}
/** bbox + margin, grown to the requested aspect so the final resample is isotropic */
function fitBox(bb, W, H, aspect, margin) {
  let x0 = Math.max(0, bb.x0 - margin), x1 = Math.min(W - 1, bb.x1 + margin);
  let y0 = Math.max(0, bb.y0 - margin), y1 = Math.min(H - 1, bb.y1 + margin);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w / h < aspect) {
    const nw = Math.min(W, Math.round(h * aspect));
    const cx = (x0 + x1) / 2;
    x0 = Math.round(cx - nw / 2); x1 = x0 + nw - 1;
    if (x0 < 0) { x1 -= x0; x0 = 0; }
    if (x1 > W - 1) { x0 -= x1 - (W - 1); x1 = W - 1; }
    x0 = Math.max(0, x0);
  } else {
    const nh = Math.min(H, Math.round(w / aspect));
    const cy = (y0 + y1) / 2;
    y0 = Math.round(cy - nh / 2); y1 = y0 + nh - 1;
    if (y0 < 0) { y1 -= y0; y0 = 0; }
    if (y1 > H - 1) { y0 -= y1 - (H - 1); y1 = H - 1; }
    y0 = Math.max(0, y0);
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* ═══════════════════════ the object builder ═══════════════════════ */
async function buildObject(spec) {
  const { name, target, seed, specs, env, shade = {}, light = {}, glow = {}, patchBase = {},
    alphaGain = 1.30, alphaGamma = 0.95, alphaScale = 1.0, alphaBlur = 4.5,
    solid = 0.97, coreLo = 0.40, coreHi = 0.86,
    blurRgb = 0, extraAlphaBlur = 0, grade: gr = null, lc = 0.35, lc2 = 0.18,
    normaliseMeanAlpha = null, grainAmp = 0, tone = [231, 238, 243],
    liftHi = 0.14, injectMid = 1.0, texAmt = 0.55, work = 1.16, cohThr = 0.14,
    chromaThick = 22,
  } = spec;
  const [TW, TH] = target;
  const W = Math.round(TW * work), H = Math.round(TH * work);
  const N = makeNoise(seed);
  const S = W / TW;                       // working scale: blurs are quoted in FINAL px

  /* 1 — lay the keyed cumulus down, overlapping */
  const rgb = new Float32Array(W * H * 3);
  for (let k = 0; k < W * H; k++) { rgb[k * 3] = tone[0]; rgb[k * 3 + 1] = tone[1]; rgb[k * 3 + 2] = tone[2]; }
  const aPhoto = new Float32Array(W * H);
  let si = 0;
  for (const sp of specs) {
    const c = CROPS[sp.crop];
    const pw = Math.max(8, Math.round(sp.w * W));
    const ph = Math.max(8, Math.round(pw * (c.h / c.w) * (sp.stretch || 1)));
    const mag = Math.max(pw / c.w, ph / c.h) / S;   // magnification at FINAL size
    if (mag > magSeen) { magSeen = mag; magWho = `${name}/${sp.crop}`; }
    const p = extractPatch(sp.crop, pw, ph, {
      rot: (sp.rot || 0) * Math.PI / 180,
      flipX: !!sp.flipX, flipY: !!sp.flipY,
      smear: (sp.smear ?? 0), smearAng: (sp.smearAng ?? 0) * Math.PI / 180,
      keyLo: sp.keyLo ?? patchBase.keyLo ?? 0.30, keyHi: sp.keyHi ?? patchBase.keyHi ?? 0.05,
      brightLo: sp.brightLo ?? patchBase.brightLo ?? 0.52,
      brightHi: sp.brightHi ?? patchBase.brightHi ?? 0.88,
      gamma: sp.gamma ?? patchBase.gamma ?? 1,
    });
    p.a = await blurAlpha(p.a, pw, ph, clamp(pw / 600, 1.8, 5.5));
    cleanMatte(p, sp.clean ?? patchBase.clean ?? 0.95);
    organicEdge(p, N, seed * 0.37 + 0.11 + (++si) * 0.19, { ...(patchBase.edge || {}), ...(sp.edge || {}) });
    const g = { ...patchBase.grade, ...sp.grade };
    if (Object.keys(g).length) grade(p.rgb, pw * ph, g);
    over(rgb, aPhoto, W, H, p, Math.round(sp.x * W - pw / 2), Math.round(sp.y * H - ph / 2), sp.op ?? 1);
  }

  /* 2 — inpaint the gaps from the keyed cloud, with real cumulus structure on top */
  const ctex = cloudTexture(W, H, seed * 1.7 + 5);
  cloudFill(rgb, aPhoto, W, H, ctex, texAmt);

  /* 3 — the matte: photographic density inside a cumulus envelope, closed in the core */
  let aP = await blurAlpha(aPhoto, W, H, alphaBlur * S);
  for (let k = 0; k < W * H; k++) aP[k] = Math.pow(clamp(aP[k] * alphaGain, 0, 1), alphaGamma);
  const ev = lobeEnvelope(W, H, N, seed * 0.013 + 0.7, env);
  let a = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) {
    // deep inside the envelope the photograph's own holes are closed: a cumulus
    // does not have sky showing through the middle of it
    const core = smoothstep(coreLo, coreHi, ev[k]);
    const dens = mix(aP[k], Math.max(aP[k], solid), core);
    a[k] = clamp(ev[k] * dens * alphaScale, 0, 1);
  }
  a = await blurAlpha(a, W, H, (spec.edgeSmooth ?? 3.4) * S);   // heal the closure boundary

  /* 4 — grade and light it */
  if (gr) grade(rgb, W * H, gr);
  await formLight(rgb, a, W, H, N, seed * 0.041 + 2.7, light);
  await shadeForm(rgb, a, W, H, N, seed * 0.31 + 1.3, shade);
  edgeGlow(rgb, a, W * H, glow);
  liftHighlights(rgb, W * H, liftHi, 0.76, 0.995);
  clampChroma(rgb, a, W * H, 4, chromaThick);

  /* 5 — optical softness: the near objects sit inside the lens's near focus */
  let outRgb = rgb;
  if (blurRgb) outRgb = await blurF32(rgb, W, H, 3, blurRgb * S);
  if (extraAlphaBlur) a = await blurAlpha(a, W, H, extraAlphaBlur * S);

  /* 6 — density normalisation for the thin classes, then crop to what is there */
  let bb = bbox(a, W, H, 0.01);
  if (normaliseMeanAlpha != null) {
    for (let pass = 0; pass < 3; pass++) {
      let s = 0, c = 0;
      for (let y = bb.y0; y <= bb.y1; y++) for (let x = bb.x0; x <= bb.x1; x++) { s += a[y * W + x]; c++; }
      const f = clamp(normaliseMeanAlpha / Math.max(s / c, 1e-4), 0.25, 4);
      if (Math.abs(f - 1) < 0.02) break;
      for (let k = 0; k < W * H; k++) a[k] = clamp(a[k] * f, 0, 1);
      bb = bbox(a, W, H, 0.01);
    }
  }
  flattenInvisible(outRgb, a, W * H);
  const box = fitBox(bb, W, H, TW / TH, Math.round(Math.min(W, H) * 0.030));

  /* 7 — resample to the delivered size. RGB and alpha go separately: RGB is
   * continuous cloud everywhere, so there is nothing a premultiplied resize
   * would protect us from, and keeping them apart guarantees no darkening or
   * fringing at the matte edge. */
  const cw = box.w, ch = box.h;
  const cRgb = new Float32Array(cw * ch * 3), cA = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const s = (box.y + j) * W + (box.x + i), d = j * cw + i;
    cRgb[d * 3] = outRgb[s * 3]; cRgb[d * 3 + 1] = outRgb[s * 3 + 1]; cRgb[d * 3 + 2] = outRgb[s * 3 + 2];
    cA[d] = a[s] * 255;
  }
  const rgbU8 = await sharp(toU8(cRgb, cw * ch * 3), { raw: { width: cw, height: ch, channels: 3 } })
    .resize(TW, TH, { kernel: 'lanczos3' }).raw().toBuffer();
  const aU8 = await sharp(toU8(cA, cw * ch), { raw: { width: cw, height: ch, channels: 1 } })
    .resize(TW, TH, { kernel: 'lanczos3' }).toColourspace('b-w').raw().toBuffer();
  const n = TW * TH;
  const fRgb = new Float32Array(n * 3), fA = new Float32Array(n);
  for (let i = 0; i < n * 3; i++) fRgb[i] = rgbU8[i];
  for (let i = 0; i < n; i++) fA[i] = aU8[i] / 255;

  /* the resample can drag a hair of alpha onto the very border; make that impossible */
  const bpx = Math.max(6, Math.round(Math.min(TW, TH) * 0.014));
  for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
    const s = smoothstep(0, bpx, i) * smoothstep(0, bpx, TW - 1 - i)
      * smoothstep(0, bpx, j) * smoothstep(0, bpx, TH - 1 - j);
    if (s < 1) fA[j * TW + i] *= s;
  }

  /* the class contract for the thin objects is a mean alpha over the DELIVERED
   * frame, so the last word on density is taken here, after the aspect-corrected
   * crop and the resample — not on the working canvas, where the margin differs */
  if (normaliseMeanAlpha != null) {
    for (let pass = 0; pass < 4; pass++) {
      let s = 0; for (let i = 0; i < n; i++) s += fA[i];
      const f = clamp(normaliseMeanAlpha / Math.max(s / n, 1e-4), 0.62, 1.75);
      if (Math.abs(f - 1) < 0.015) break;
      for (let i = 0; i < n; i++) fA[i] = clamp(fA[i] * f, 0, 1);
    }
    // scaling density back up can lift a sub-1/255 border pixel to 1/255, which
    // is a visible edge on a black field. Re-close the frame.
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const sfx = smoothstep(0, bpx, i) * smoothstep(0, bpx, TW - 1 - i)
        * smoothstep(0, bpx, j) * smoothstep(0, bpx, TH - 1 - j);
      if (sfx < 1) fA[j * TW + i] *= sfx;
    }
  }

  /* 8 — micro-contrast back, then the emulsion, at the OUTPUT resolution */
  await localContrast(fRgb, TW, TH, lc, lc2);
  const film = filmTexture(TW, TH, seed * 3.7 + 11);
  const { bands } = octaveBands(film, TW, TH);
  if (injectMid > 0) {
    // a little real 2-8px photographic structure, masked to the cloud and rolled
    // off in the highlights: enough to kill the smeared-JPEG look, far too
    // little to engrave the vermiculated foil a big gain would
    const gain = [0, 0.16, 0.20, 0.13, 0];
    for (let k = 0; k < n; k++) {
      let d = 0;
      for (let b = 1; b < 5; b++) d += gain[b] * bands[b][k] * injectMid;
      d *= clamp(fA[k] * 1.4, 0, 1);
      const L = (0.2126 * fRgb[k * 3] + 0.7152 * fRgb[k * 3 + 1] + 0.0722 * fRgb[k * 3 + 2]) / 255;
      d *= 1 - 0.55 * smoothstep(0.90, 1.0, L);
      fRgb[k * 3] += d * 0.99; fRgb[k * 3 + 1] += d; fRgb[k * 3 + 2] += d * 1.01;
    }
  }
  clampChroma(fRgb, fA, n, 4, chromaThick);

  if (grainAmp < GRAIN_MIN || grainAmp > GRAIN_MAX) throw new Error(`[${name}] grain amp ${grainAmp} outside ${GRAIN_MIN}-${GRAIN_MAX}`);
  const rnd = mulberry32(Math.round(seed * 7 + 3));
  const white = new Float32Array(n);
  for (let i = 0; i < n; i++) white[i] = rnd() + rnd() + rnd() - 1.5;
  const gA = normalise(bands[0], n), gB = normalise(white, n);
  const cj = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) cj[i] = (rnd() - 0.5) * 2;
  const buf = Buffer.allocUnsafe(n * 4);
  for (let k = 0; k < n; k++) {
    const r0 = fRgb[k * 3], g0 = fRgb[k * 3 + 1], b0 = fRgb[k * 3 + 2];
    const Ln = clamp((0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255, 0, 1);
    const g = (gA[k] * 0.90 + gB[k] * 0.44) * grainAmp * (1 - 0.30 * Ln);
    const cA2 = grainAmp * 0.05;
    const vr = r0 + g + cj[k * 3] * cA2, vg = g0 + g + cj[k * 3 + 1] * cA2, vb = b0 + g + cj[k * 3 + 2] * cA2;
    buf[k * 4] = vr < 0 ? 0 : vr > 255 ? 255 : (vr + 0.5) | 0;
    buf[k * 4 + 1] = vg < 0 ? 0 : vg > 255 ? 255 : (vg + 0.5) | 0;
    buf[k * 4 + 2] = vb < 0 ? 0 : vb > 255 ? 255 : (vb + 0.5) | 0;
    const av = fA[k] * 255;
    buf[k * 4 + 3] = av < 0 ? 0 : av > 255 ? 255 : (av + 0.5) | 0;
  }
  const file = `${OUT}/${name}.webp`;
  await sharp(buf, { raw: { width: TW, height: TH, channels: 4 } })
    .webp({ quality: 86, alphaQuality: 100 }).toFile(file);

  /* 9 — report */
  const m = await measure(file);
  const coh = coherence(fA, TW, TH, cohThr);
  const sig = signature(fA, TW, TH);
  let worst = 0, who = '—';
  for (const p of SIGS) { const c = ncc(sig, p.sig); if (c > worst) { worst = c; who = p.name; } }
  SIGS.push({ sig, name });
  const st = await fs.stat(file);
  return { name, file, ...m, kb: st.size / 1024, coh, ncc: worst, nccWho: who, crop: `${cw}x${ch}`, grainAmp };
}

/* ═══════════════════════ THE NINE OBJECTS ═══════════════════════ */
/* Every object is one formation. The `lobes` list IS the formation — moving a
 * dome is how a broad shelf becomes a tower — and `light` is where its base and
 * its top sit, so the big tonal gradient runs along the cloud rather than down
 * the frame. */
const OBJECTS = [
  /* ── FAR: small, soft, low contrast. Thin, torn, wispy; seen through a lot of
   *    air, so lower contrast and slightly bluer than the near ones. Mean alpha
   *    over the frame 0.10-0.25. These sit high and drift slowly. ── */
  {
    name: 'obj-far-1', target: [1400, 900], seed: 3121, grainAmp: 0, work: 1.20,
    patchBase: { keyLo: 0.26, keyHi: 0.09, brightLo: 0.55, brightHi: 0.95, gamma: 1.30, clean: 0.72,
      edge: { fw: 0.55, ax: 0.80, ay: 1.20, warp: 0.60 } },
    specs: [
      { crop: 'bigMid', x: 0.40, y: 0.48, w: 0.74, stretch: 0.38, rot: -3, smear: 22, smearAng: -3 },
      { crop: 'towerBottom', x: 0.66, y: 0.44, w: 0.54, stretch: 0.36, rot: 2, flipX: true, smear: 26, smearAng: 3 },
      { crop: 'wispMid', x: 0.25, y: 0.55, w: 0.48, stretch: 0.54, rot: 3, smear: 20, smearAng: 2 },
      { crop: 'cumRight', x: 0.55, y: 0.57, w: 0.42, stretch: 0.50, rot: -4, flipX: true, smear: 18, smearAng: -2 },
      { crop: 'massLeftLow', x: 0.84, y: 0.51, w: 0.32, stretch: 0.58, rot: 5, smear: 24, smearAng: 4 },
    ],
    // one long shallow raft of overlapping flattened lobes. Torn, but not
    // shattered: a far cloud is a single thing seen small, not a line of dots.
    env: {
      lobes: [[0.20, 0.500, 0.190, 0.115], [0.33, 0.455, 0.190, 0.130], [0.46, 0.505, 0.190, 0.120],
        [0.59, 0.465, 0.180, 0.125], [0.72, 0.515, 0.170, 0.105], [0.83, 0.485, 0.140, 0.085],
        [0.45, 0.560, 0.260, 0.085]],
      feather: 0.30, warp: 0.052, bump: 0.20, tear: 0.58, ts: 0.16, safe: 0.05,
    },
    alphaGain: 1.12, alphaGamma: 1.05, alphaScale: 0.86, alphaBlur: 6,
    solid: 0.78, coreLo: 0.42, coreHi: 0.95,
    grade: { contrast: 0.90, pivot: 206, lift: 3, sat: 0.97, tint: [0.994, 1.0, 1.014] },
    light: { top: 0.34, base: 0.63, deep: 0.62, lit: 0.26, wob: 0.20, global: 0.55, dm: 10, shadow: [182, 198, 213] },
    shade: { amt: 26, billow: 0.28, macro: 0.78, bumpScale: 0.170, shadow: [194, 207, 219] },
    glow: { amt: 0.30, hi: 0.66 },
    lc: 0.30, lc2: 0.14, injectMid: 0.7, liftHi: 0.10, texAmt: 0.42,
    normaliseMeanAlpha: 0.170, cohThr: 0.07, chromaThick: 26,
  },
  {
    name: 'obj-far-2', target: [1400, 800], seed: 4177, grainAmp: 0, work: 1.20,
    patchBase: { keyLo: 0.25, keyHi: 0.09, brightLo: 0.56, brightHi: 0.96, gamma: 1.35, clean: 0.72,
      edge: { fw: 0.58, ax: 0.74, ay: 1.30, warp: 0.62 } },
    specs: [
      { crop: 'bigLower', x: 0.42, y: 0.51, w: 0.88, stretch: 0.26, rot: 2, flipY: true, smear: 30, smearAng: 2 },
      { crop: 'bigUpper', x: 0.22, y: 0.47, w: 0.54, stretch: 0.36, rot: -2, smear: 24, smearAng: -3 },
      { crop: 'cumRightLow', x: 0.66, y: 0.48, w: 0.34, stretch: 0.32, rot: 4, flipX: true, smear: 22, smearAng: 3 },
      { crop: 'wispUpper', x: 0.85, y: 0.53, w: 0.32, stretch: 0.72, rot: -3, smear: 26, smearAng: -2 },
      { crop: 'tornUpper', x: 0.13, y: 0.55, w: 0.30, stretch: 0.62, rot: 5, flipX: true, smear: 18, smearAng: 3 },
    ],
    // a streak: heavy at the left, fraying away to the right
    env: {
      lobes: [[0.17, 0.500, 0.180, 0.160], [0.29, 0.475, 0.170, 0.135], [0.41, 0.510, 0.160, 0.115],
        [0.53, 0.485, 0.150, 0.095], [0.65, 0.515, 0.140, 0.078], [0.77, 0.500, 0.120, 0.060],
        [0.87, 0.510, 0.090, 0.045]],
      feather: 0.28, warp: 0.055, bump: 0.21, tear: 0.60, ts: 0.13, safe: 0.05,
    },
    alphaGain: 1.08, alphaGamma: 1.08, alphaScale: 0.82, alphaBlur: 6.5,
    solid: 0.74, coreLo: 0.42, coreHi: 0.95,
    grade: { contrast: 0.88, pivot: 208, lift: 4, sat: 0.97, tint: [0.992, 1.0, 1.017] },
    light: { top: 0.36, base: 0.61, deep: 0.58, lit: 0.24, wob: 0.22, global: 0.55, dm: 10, shadow: [184, 199, 214] },
    shade: { amt: 24, billow: 0.26, macro: 0.74, bumpScale: 0.180, shadow: [196, 208, 220] },
    glow: { amt: 0.28, hi: 0.62 },
    lc: 0.28, lc2: 0.12, injectMid: 0.7, liftHi: 0.09, texAmt: 0.40,
    normaliseMeanAlpha: 0.145, cohThr: 0.06, chromaThick: 27,
  },
  {
    name: 'obj-far-3', target: [1200, 700], seed: 5233, grainAmp: 0, work: 1.18,
    patchBase: { keyLo: 0.26, keyHi: 0.10, brightLo: 0.55, brightHi: 0.94, gamma: 1.25, clean: 0.72,
      edge: { fw: 0.56, ax: 0.82, ay: 1.15, warp: 0.58 } },
    specs: [
      { crop: 'midPuffs', x: 0.34, y: 0.43, w: 0.56, stretch: 0.66, rot: -5, smear: 16, smearAng: -4 },
      { crop: 'cumRight', x: 0.56, y: 0.50, w: 0.50, stretch: 0.56, rot: 3, smear: 20, smearAng: 3 },
      { crop: 'puffsCentre', x: 0.24, y: 0.53, w: 0.40, stretch: 0.70, rot: 6, flipX: true, smear: 18, smearAng: 5 },
      { crop: 'wispMid', x: 0.74, y: 0.56, w: 0.38, stretch: 0.64, rot: -2, smear: 22, smearAng: -3 },
    ],
    // a hooked tuft: two heads and a tail curling away down-right
    env: {
      lobes: [[0.28, 0.420, 0.210, 0.175], [0.45, 0.375, 0.175, 0.145], [0.55, 0.490, 0.185, 0.135],
        [0.70, 0.565, 0.155, 0.105], [0.82, 0.615, 0.115, 0.072]],
      feather: 0.32, warp: 0.050, bump: 0.19, tear: 0.56, ts: 0.18, safe: 0.05,
    },
    alphaGain: 1.16, alphaGamma: 1.00, alphaScale: 0.90, alphaBlur: 5.5,
    solid: 0.82, coreLo: 0.40, coreHi: 0.93,
    grade: { contrast: 0.92, pivot: 204, lift: 2, sat: 0.97, tint: [0.995, 1.0, 1.012] },
    light: { top: 0.28, base: 0.64, deep: 0.66, lit: 0.28, wob: 0.18, global: 0.55, dm: 11, shadow: [179, 196, 212] },
    shade: { amt: 29, billow: 0.30, macro: 0.80, bumpScale: 0.160, shadow: [191, 205, 218] },
    glow: { amt: 0.32, hi: 0.68 },
    lc: 0.32, lc2: 0.15, injectMid: 0.75, liftHi: 0.11, texAmt: 0.44,
    normaliseMeanAlpha: 0.200, cohThr: 0.08, chromaThick: 26,
  },

  /* ── MID: the workhorses. Recognisable cumulus with a defined top and a flatter
   *    base. Full contrast, cool grey shadow sides ~#C6D2DB, blown highlights
   *    near #F4F7F8. Each is a clearly different formation. ── */
  {
    // BROAD AND LOW: a long shelf of unequal lobes, none of them dominant
    name: 'obj-mid-1', target: [1800, 1400], seed: 6311, grainAmp: 0, work: 1.16,
    patchBase: { clean: 0.95, edge: { fw: 0.40, warp: 0.34 } },
    specs: [
      { crop: 'bigLower', x: 0.42, y: 0.60, w: 0.58, rot: -2, grade: { contrast: 1.05, pivot: 198 } },
      { crop: 'towerBottom', x: 0.21, y: 0.56, w: 0.42, rot: 3, flipX: true, grade: { contrast: 1.04, pivot: 198 } },
      { crop: 'lowBase', x: 0.44, y: 0.70, w: 0.56, stretch: 1.05, rot: 1, op: 0.72, edge: { fw: 0.48, ay: 0.86, warp: 0.5 } },
      { crop: 'cumRightLow', x: 0.70, y: 0.58, w: 0.32, rot: -3, op: 0.94 },
      { crop: 'bigMid', x: 0.60, y: 0.49, w: 0.46, rot: 2, flipX: true, op: 0.90 },
      { crop: 'puffsCentre', x: 0.33, y: 0.43, w: 0.22, rot: -6, op: 0.74, edge: { fw: 0.46, warp: 0.5 } },
      { crop: 'midPuffs', x: 0.81, y: 0.62, w: 0.24, rot: 5, op: 0.72, edge: { fw: 0.46, warp: 0.5 } },
    ],
    env: {
      lobes: [[0.24, 0.545, 0.180, 0.160], [0.40, 0.465, 0.200, 0.195], [0.56, 0.520, 0.180, 0.170],
        [0.71, 0.565, 0.150, 0.150], [0.83, 0.615, 0.110, 0.112], [0.145, 0.595, 0.128, 0.128],
        [0.48, 0.645, 0.310, 0.155]],
      feather: 0.56, warp: 0.026, bump: 0.135, tear: 0.28, ts: 0.170,
      baseY: 0.760, baseSoft: 0.080, baseWob: 0.024, safe: 0.038,
    },
    alphaGain: 1.32, alphaGamma: 0.95, alphaBlur: 4.5, solid: 0.98, coreLo: 0.36, coreHi: 0.82,
    grade: { contrast: 1.09, pivot: 200, sat: 0.97 },
    light: { top: 0.32, base: 0.780, deep: 1.00, lit: 0.54, wob: 0.13, side: 0.10, global: 0.42, dm: 18, shadow: [136, 162, 185] },
    shade: { amt: 52, billow: 0.44, macro: 1.0, bumpScale: 0.150, lx: 0.60, ly: -0.80, shadow: [170, 188, 204] },
    glow: { amt: 0.45 },
    lc: 0.38, lc2: 0.18, injectMid: 1.0, liftHi: 0.21, texAmt: 0.52, cohThr: 0.14,
  },
  {
    // TOWERING: a vertical column with a cauliflower head, standing on a base
    // that spreads right — a tower, not a lozenge, and not a slab with wings
    name: 'obj-mid-2', target: [1800, 1300], seed: 7433, grainAmp: 0, work: 1.16,
    patchBase: { clean: 0.95, edge: { fw: 0.40, warp: 0.34 } },
    specs: [
      { crop: 'towerBottom', x: 0.34, y: 0.44, w: 0.46, stretch: 1.25, rot: -3, grade: { contrast: 1.06, pivot: 198 } },
      { crop: 'towerLeft', x: 0.31, y: 0.26, w: 0.28, rot: 4, grade: { contrast: 1.05, pivot: 198 } },
      { crop: 'bigLower', x: 0.42, y: 0.66, w: 0.52, rot: 2, flipX: true, op: 0.96 },
      { crop: 'cumRight', x: 0.58, y: 0.60, w: 0.34, rot: -4, op: 0.92 },
      { crop: 'lowBase', x: 0.52, y: 0.71, w: 0.44, stretch: 1.05, rot: -1, op: 0.64, edge: { fw: 0.50, ay: 0.86, warp: 0.52 } },
      { crop: 'midPuffs', x: 0.22, y: 0.58, w: 0.26, rot: 6, flipX: true, op: 0.80 },
      { crop: 'puffTopRight', x: 0.40, y: 0.20, w: 0.24, rot: -7, op: 0.64, edge: { fw: 0.48, warp: 0.52 } },
    ],
    env: {
      lobes: [[0.340, 0.190, 0.130, 0.120], [0.265, 0.295, 0.125, 0.115], [0.425, 0.285, 0.115, 0.105],
        [0.345, 0.430, 0.170, 0.155], [0.335, 0.585, 0.205, 0.170],
        [0.530, 0.575, 0.165, 0.165], [0.665, 0.615, 0.135, 0.140], [0.775, 0.645, 0.088, 0.098],
        [0.180, 0.610, 0.128, 0.125]],
      feather: 0.58, warp: 0.027, bump: 0.140, tear: 0.28, ts: 0.155,
      baseY: 0.780, baseSoft: 0.090, baseWob: 0.048, safe: 0.038,
    },
    alphaGain: 1.32, alphaGamma: 0.95, alphaBlur: 4.5, solid: 0.98, coreLo: 0.36, coreHi: 0.82,
    grade: { contrast: 1.10, pivot: 200, sat: 0.97 },
    light: { top: 0.14, base: 0.795, deep: 1.00, lit: 0.58, wob: 0.12, side: 0.08, global: 0.40, dm: 18, shadow: [133, 160, 184] },
    shade: { amt: 56, billow: 0.46, macro: 1.0, bumpScale: 0.135, lx: 0.52, ly: -0.85, shadow: [166, 185, 202] },
    glow: { amt: 0.45 },
    lc: 0.40, lc2: 0.18, injectMid: 1.0, liftHi: 0.22, texAmt: 0.52, cohThr: 0.14,
  },
  {
    // A DISTINCT SHOULDER: heavy head upper-right, a lower shelf reaching left
    // out of the mass and stepping down to nothing
    name: 'obj-mid-3', target: [1600, 1500], seed: 8537, grainAmp: 0, work: 1.16,
    patchBase: { clean: 0.95, edge: { fw: 0.40, warp: 0.34 } },
    specs: [
      { crop: 'bigMid', x: 0.63, y: 0.38, w: 0.58, rot: 3, grade: { contrast: 1.06, pivot: 198 } },
      { crop: 'cumRightLow', x: 0.74, y: 0.52, w: 0.36, rot: -2, grade: { contrast: 1.04, pivot: 198 } },
      { crop: 'towerBottom', x: 0.42, y: 0.57, w: 0.44, rot: 4, flipX: true, op: 0.95 },
      { crop: 'bigLower', x: 0.30, y: 0.66, w: 0.48, rot: -3, op: 0.92 },
      { crop: 'massLeftLow', x: 0.16, y: 0.66, w: 0.26, rot: 5, op: 0.84 },
      { crop: 'puffsCentre', x: 0.57, y: 0.26, w: 0.22, rot: -6, op: 0.72, edge: { fw: 0.46, warp: 0.52 } },
      { crop: 'lowBase', x: 0.50, y: 0.70, w: 0.46, stretch: 1.00, rot: 2, op: 0.68, edge: { fw: 0.50, ay: 0.86, warp: 0.52 } },
    ],
    env: {
      lobes: [[0.660, 0.305, 0.200, 0.185], [0.790, 0.435, 0.150, 0.140], [0.545, 0.410, 0.165, 0.155],
        [0.630, 0.560, 0.195, 0.155],
        [0.470, 0.515, 0.155, 0.150], [0.375, 0.570, 0.170, 0.148], [0.230, 0.618, 0.140, 0.128],
        [0.118, 0.650, 0.098, 0.096]],
      feather: 0.58, warp: 0.026, bump: 0.135, tear: 0.28, ts: 0.175,
      baseY: 0.745, baseSoft: 0.085, baseWob: 0.026, safe: 0.038,
    },
    alphaGain: 1.30, alphaGamma: 0.95, alphaBlur: 4.5, solid: 0.98, coreLo: 0.36, coreHi: 0.82,
    grade: { contrast: 1.09, pivot: 200, sat: 0.97 },
    light: { top: 0.20, base: 0.765, deep: 1.00, lit: 0.56, wob: 0.13, side: -0.10, global: 0.42, dm: 18, shadow: [135, 161, 185] },
    shade: { amt: 54, billow: 0.44, macro: 1.0, bumpScale: 0.145, lx: -0.55, ly: -0.83, shadow: [168, 187, 203] },
    glow: { amt: 0.45 },
    lc: 0.38, lc2: 0.18, injectMid: 1.0, liftHi: 0.21, texAmt: 0.52, cohThr: 0.14,
  },

  /* ── NEAR: large, softer, closer to the lens. Big soft masses, slightly out of
   *    focus, high-key, less internal detail. Cropped by the frame edge in use,
   *    so dense in the middle and feathering hard at every edge. ── */
  {
    // a broad mass with a shoulder low-right
    name: 'obj-near-1', target: [2400, 1800], seed: 9631, grainAmp: 0, work: 1.14,
    patchBase: { clean: 0.95, edge: { fw: 0.42, warp: 0.34 } },
    specs: [
      { crop: 'bigLower', x: 0.45, y: 0.52, w: 0.64, rot: -2, grade: { contrast: 0.96, pivot: 204, lift: 6 } },
      { crop: 'towerBottom', x: 0.25, y: 0.47, w: 0.48, rot: 3, flipX: true, grade: { contrast: 0.96, pivot: 204, lift: 6 } },
      { crop: 'bigMid', x: 0.68, y: 0.51, w: 0.52, rot: 2, op: 0.94, grade: { contrast: 0.96, pivot: 204, lift: 6 } },
      { crop: 'lowBase', x: 0.48, y: 0.70, w: 0.62, stretch: 1.10, rot: -1, op: 0.76, edge: { fw: 0.48, ay: 0.86, warp: 0.5 } },
      { crop: 'cumRightLow', x: 0.78, y: 0.64, w: 0.30, rot: -4, op: 0.88 },
      { crop: 'towerLeft', x: 0.19, y: 0.62, w: 0.26, rot: 5, op: 0.86 },
    ],
    env: {
      lobes: [[0.400, 0.450, 0.240, 0.240], [0.235, 0.520, 0.175, 0.175], [0.600, 0.490, 0.190, 0.190],
        [0.450, 0.635, 0.240, 0.170], [0.350, 0.300, 0.135, 0.120], [0.590, 0.320, 0.120, 0.105],
        [0.760, 0.590, 0.130, 0.105]],
      feather: 0.68, warp: 0.024, bump: 0.115, tear: 0.27, ts: 0.185,
      baseY: 0.785, baseSoft: 0.105, baseWob: 0.028, safe: 0.040,
    },
    alphaGain: 1.45, alphaGamma: 0.86, alphaBlur: 6, solid: 1.0, coreLo: 0.28, coreHi: 0.76,
    grade: { contrast: 0.96, pivot: 206, lift: 4, sat: 0.95 },
    light: { top: 0.22, base: 0.800, deep: 0.90, lit: 0.56, wob: 0.14, side: 0.10, global: 0.45, dm: 15, shadow: [150, 173, 195] },
    shade: { amt: 36, billow: 0.26, macro: 0.94, bumpScale: 0.230, lx: 0.55, ly: -0.83, shadow: [184, 199, 213] },
    glow: { amt: 0.40 },
    blurRgb: 7.0, extraAlphaBlur: 5.0,
    lc: 0.16, lc2: 0.10, injectMid: 0.75, liftHi: 0.20, texAmt: 0.44, cohThr: 0.16,
  },
  {
    // a tall rounded head on a narrower base — the cloud you look UP at
    name: 'obj-near-2', target: [2200, 1700], seed: 10739, grainAmp: 0, work: 1.14,
    patchBase: { clean: 0.95, edge: { fw: 0.42, warp: 0.34 } },
    specs: [
      { crop: 'bigMid', x: 0.40, y: 0.44, w: 0.66, rot: 4, flipX: true, grade: { contrast: 0.95, pivot: 204, lift: 7 } },
      { crop: 'bigLower', x: 0.56, y: 0.58, w: 0.58, rot: -3, grade: { contrast: 0.95, pivot: 204, lift: 7 } },
      { crop: 'towerLeft', x: 0.36, y: 0.27, w: 0.34, rot: -5, op: 0.94 },
      { crop: 'cumRight', x: 0.66, y: 0.40, w: 0.36, rot: 3, op: 0.88 },
      { crop: 'lowBase', x: 0.44, y: 0.68, w: 0.54, stretch: 1.0, rot: 2, op: 0.74, edge: { fw: 0.48, ay: 0.86, warp: 0.5 } },
      { crop: 'midPuffs', x: 0.72, y: 0.56, w: 0.26, rot: 6, op: 0.82 },
    ],
    env: {
      lobes: [[0.430, 0.410, 0.250, 0.250], [0.245, 0.520, 0.205, 0.205], [0.625, 0.510, 0.215, 0.215],
        [0.450, 0.645, 0.250, 0.175], [0.760, 0.610, 0.150, 0.125], [0.430, 0.235, 0.160, 0.130],
        [0.180, 0.350, 0.115, 0.100]],
      feather: 0.70, warp: 0.025, bump: 0.118, tear: 0.27, ts: 0.160,
      baseY: 0.775, baseSoft: 0.110, baseWob: 0.030, safe: 0.040,
    },
    alphaGain: 1.45, alphaGamma: 0.86, alphaBlur: 6, solid: 1.0, coreLo: 0.28, coreHi: 0.76,
    grade: { contrast: 0.95, pivot: 206, lift: 5, sat: 0.95 },
    light: { top: 0.14, base: 0.790, deep: 0.92, lit: 0.58, wob: 0.14, side: -0.12, global: 0.45, dm: 15, shadow: [148, 172, 194] },
    shade: { amt: 35, billow: 0.24, macro: 0.92, bumpScale: 0.240, lx: -0.50, ly: -0.86, shadow: [185, 200, 213] },
    glow: { amt: 0.40 },
    blurRgb: 8.0, extraAlphaBlur: 5.5,
    lc: 0.15, lc2: 0.10, injectMid: 0.75, liftHi: 0.21, texAmt: 0.44, cohThr: 0.16,
  },
  {
    // a long low bank with two heads — it runs across the frame rather than
    // sitting in it, and gets cropped by the viewport edge in use
    name: 'obj-near-3', target: [2600, 1500], seed: 11813, grainAmp: 0, work: 1.14,
    patchBase: { clean: 0.95, edge: { fw: 0.44, warp: 0.34 } },
    specs: [
      { crop: 'bigLower', x: 0.32, y: 0.54, w: 0.50, rot: 2, flipY: true, grade: { contrast: 0.95, pivot: 204, lift: 7 } },
      { crop: 'bigUpper', x: 0.60, y: 0.50, w: 0.52, rot: -3, grade: { contrast: 0.95, pivot: 204, lift: 7 } },
      { crop: 'towerBottom', x: 0.82, y: 0.54, w: 0.38, rot: 4, flipX: true, op: 0.92 },
      { crop: 'lowBase', x: 0.47, y: 0.68, w: 0.58, stretch: 1.05, rot: -1, op: 0.74, edge: { fw: 0.50, ay: 0.86, warp: 0.5 } },
      { crop: 'cumRightLow', x: 0.16, y: 0.54, w: 0.28, rot: -5, op: 0.88 },
      { crop: 'puffsCentre', x: 0.66, y: 0.34, w: 0.22, rot: 6, op: 0.76 },
    ],
    env: {
      lobes: [[0.200, 0.520, 0.150, 0.215], [0.360, 0.440, 0.165, 0.250], [0.525, 0.500, 0.145, 0.215],
        [0.700, 0.430, 0.155, 0.245], [0.860, 0.550, 0.100, 0.150], [0.470, 0.625, 0.280, 0.155]],
      feather: 0.68, warp: 0.024, bump: 0.115, tear: 0.27, ts: 0.175,
      baseY: 0.790, baseSoft: 0.100, baseWob: 0.026, safe: 0.040,
    },
    alphaGain: 1.45, alphaGamma: 0.86, alphaBlur: 6, solid: 1.0, coreLo: 0.28, coreHi: 0.76,
    grade: { contrast: 0.95, pivot: 206, lift: 5, sat: 0.95 },
    light: { top: 0.20, base: 0.800, deep: 0.90, lit: 0.56, wob: 0.15, side: 0.12, global: 0.45, dm: 15, shadow: [150, 173, 195] },
    shade: { amt: 35, billow: 0.25, macro: 0.92, bumpScale: 0.235, lx: 0.58, ly: -0.81, shadow: [184, 199, 213] },
    glow: { amt: 0.40 },
    blurRgb: 7.5, extraAlphaBlur: 5.0,
    lc: 0.16, lc2: 0.10, injectMid: 0.75, liftHi: 0.21, texAmt: 0.44, cohThr: 0.16,
  },
];

/* ═══════════════════════ previews ═══════════════════════ */
async function contactSheet(items, bg, file) {
  const CW = 620, CH = 460, COLS = 3, LAB = 26;
  const rows = Math.ceil(items.length / COLS);
  const W = COLS * CW, H = rows * (CH + LAB);
  const comps = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const thumb = await sharp(it.file).resize(CW - 16, CH - 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const md = await sharp(thumb).metadata();
    const cell = await sharp({ create: { width: CW, height: CH, channels: 3, background: bg } })
      .composite([{ input: thumb, left: (CW - md.width) >> 1, top: (CH - md.height) >> 1 }]).png().toBuffer();
    const col = i % COLS, row = (i / COLS) | 0;
    comps.push({ input: cell, left: col * CW, top: row * (CH + LAB) });
    const lbl = `${it.name}  ${it.W}x${it.H}  ${it.kb.toFixed(0)}KB  sd ${it.sd.map((v) => v.toFixed(0)).join('/')}  aMean ${it.meanAlpha.toFixed(2)}`;
    comps.push({
      input: Buffer.from(`<svg width="${CW}" height="${LAB}"><rect width="${CW}" height="${LAB}" fill="#0b0e11"/>` +
        `<text x="6" y="18" font-family="monospace" font-size="13" fill="#dfe9f2">${lbl}</text></svg>`),
      left: col * CW, top: row * (CH + LAB) + CH,
    });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: bg } }).composite(comps).png().toFile(file);
  return file;
}

/* ═══════════════════════════════ main ═══════════════════════════════ */
async function main() {
  const t0 = Date.now();
  await fs.mkdir(OUT, { recursive: true });
  await fs.mkdir(PREVIEW, { recursive: true });
  await loadSource();
  console.log(`source loaded ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const results = [];
  for (const spec of OBJECTS) {
    if (only && !only.includes(spec.name)) continue;
    const t = Date.now();
    const r = await buildObject(spec);
    results.push(r);
    const flag = [];
    if (r.borderMax > 0) flag.push(`BORDER-ALPHA ${r.borderMax}`);
    if (r.fringeChroma > 26) flag.push(`FRINGE-CHROMA ${r.fringeChroma}`);
    if (Math.min(...r.sd) < SD_FLOOR) flag.push(`sd<${SD_FLOOR}`);
    if (r.coh < 0.82) flag.push(`FRAGMENTED ${r.coh.toFixed(2)}`);
    if (r.ncc > 0.72) flag.push(`SIMILAR to ${r.nccWho} ${r.ncc.toFixed(2)}`);
    console.log(
      `${r.name.padEnd(12)} ${r.W}x${r.H}  ${r.kb.toFixed(0)}KB  (cropped ${r.crop})  ${((Date.now() - t) / 1000).toFixed(1)}s\n` +
      `   mean  R ${r.mean[0].toFixed(1)}  G ${r.mean[1].toFixed(1)}  B ${r.mean[2].toFixed(1)}   [alpha>0.5 = ${(r.opaqueFrac * 100).toFixed(0)}% of frame]\n` +
      `   sd    R ${r.sd[0].toFixed(1)}  G ${r.sd[1].toFixed(1)}  B ${r.sd[2].toFixed(1)}   grain amp ${r.grainAmp}  hf(enc) ${r.hf.toFixed(2)}\n` +
      `   alpha mean ${r.meanAlpha.toFixed(3)} max ${r.maxAlpha.toFixed(2)}  border ${r.borderMax}/255  coherence ${r.coh.toFixed(3)}  ncc ${r.ncc.toFixed(2)} (${r.nccWho})  chroma max ${r.chromaMax} fringe ${r.fringeChroma}` +
      (flag.length ? `\n   >>> ${flag.join('   ')}` : ''));
  }
  console.log(`max source magnification at output size: ${magSeen.toFixed(2)}x  (${magWho})`);

  const blue = await contactSheet(results, '#2E7BB8', `${PREVIEW}/cloud-objects-blue.png`);
  const black = await contactSheet(results, '#000000', `${PREVIEW}/cloud-objects-black.png`);
  console.log(`preview -> ${blue}\npreview -> ${black}\ntotal ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
