/**
 * SELORA — shared film/noise toolkit for the cloud generator.
 *
 * The whole delivery is derived from ONE 665x1182 film scan, so the two things
 * that decide whether an asset reads as photography are:
 *   (a) the spectrum — how much energy sits in each spatial octave, and
 *   (b) the palette  — where sky and cloud sit in HSL.
 * Both are MEASURED here against the reference rather than eyeballed, which is
 * what lets the generator close the loop on itself (see spectralMatch()).
 */
import sharp from 'sharp';

/* ───────────────────────────── math ───────────────────────────── */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─────────────────────── gradient noise / fBm ─────────────────────── */
export function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071, 0.3827, -0.3827, 0.9239, -0.9239];
  const GY = [1, 1, -1, -1, 0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071, 0.9239, 0.9239, 0.3827, -0.3827];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  function noise2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const X = xi & 255, Y = yi & 255;
    const xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const aa = perm[(perm[X] + Y) & 511] & 15;
    const ba = perm[(perm[X + 1] + Y) & 511] & 15;
    const ab = perm[(perm[X] + Y + 1) & 511] & 15;
    const bb = perm[(perm[X + 1] + Y + 1) & 511] & 15;
    const n00 = GX[aa] * xf + GY[aa] * yf;
    const n10 = GX[ba] * (xf - 1) + GY[ba] * yf;
    const n01 = GX[ab] * xf + GY[ab] * (yf - 1);
    const n11 = GX[bb] * (xf - 1) + GY[bb] * (yf - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.4;
  }
  function fbm(x, y, oct = 6, lac = 2.0, gain = 0.5) {
    let amp = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += amp * noise2(x * f, y * f); norm += amp; amp *= gain; f *= lac; }
    return sum / norm;
  }
  function turb(x, y, oct = 5, lac = 2.0, gain = 0.5) {
    let amp = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { sum += amp * Math.abs(noise2(x * f, y * f)); norm += amp; amp *= gain; f *= lac; }
    return (sum / norm) * 2 - 1;
  }
  function ridged(x, y, oct = 5, lac = 2.05, gain = 0.5) {
    let amp = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) { let n = 1 - Math.abs(noise2(x * f, y * f)); n *= n; sum += amp * n; norm += amp; amp *= gain; f *= lac; }
    return sum / norm;
  }
  /** domain warp applied TWICE — the organic one */
  function warped(x, y, A = 1.1, oct = 5) {
    const q1 = fbm(x, y, 4), q2 = fbm(x + 5.2, y + 1.3, 4);
    const r1 = fbm(x + A * q1 + 1.7, y + A * q2 + 9.2, 4);
    const r2 = fbm(x + A * q1 + 8.3, y + A * q2 + 2.8, 4);
    return fbm(x + A * r1, y + A * r2, oct);
  }
  function warpedTurb(x, y, A = 1.0, oct = 5) {
    const q1 = fbm(x, y, 3), q2 = fbm(x + 3.1, y + 7.7, 3);
    return turb(x + A * q1, y + A * q2, oct);
  }
  /** ridged multifractal after a double warp — billow / cauliflower structure */
  function warpedRidged(x, y, A = 1.0, oct = 5) {
    const q1 = fbm(x, y, 3), q2 = fbm(x + 6.7, y - 2.9, 3);
    const r1 = fbm(x + A * q1 + 4.4, y + A * q2 - 1.1, 3);
    const r2 = fbm(x + A * q1 - 3.6, y + A * q2 + 5.9, 3);
    return ridged(x + A * r1, y + A * r2, oct);
  }
  return { noise2, fbm, turb, ridged, warped, warpedTurb, warpedRidged };
}

/* low-resolution field, bilinearly upsampled — keeps big warps cheap */
export function field(w, h, down, fn) {
  const fw = Math.ceil(w / down) + 2, fh = Math.ceil(h / down) + 2;
  const f = new Float32Array(fw * fh);
  for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) f[j * fw + i] = fn(i * down, j * down);
  return { f, fw, fh, down };
}
export function sampleField(F, x, y) {
  const fx = x / F.down, fy = y / F.down;
  let x0 = fx | 0, y0 = fy | 0;
  if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
  if (x0 > F.fw - 2) x0 = F.fw - 2; if (y0 > F.fh - 2) y0 = F.fh - 2;
  const tx = fx - x0, ty = fy - y0;
  const i = y0 * F.fw + x0;
  const a = F.f[i], b = F.f[i + 1], c = F.f[i + F.fw], d = F.f[i + F.fw + 1];
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

/* ─────────────────────────── sharp interop ─────────────────────────── */
export function toU8(f32, n) {
  const b = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) { const v = f32[i]; b[i] = v < 0 ? 0 : v > 255 ? 255 : (v + 0.5) | 0; }
  return b;
}
export async function blurF32(f32, w, h, ch, sigma) {
  if (sigma < 0.32) return Float32Array.from(f32);
  const buf = toU8(f32, w * h * ch);
  let pipe = sharp(buf, { raw: { width: w, height: h, channels: ch } }).blur(sigma);
  // sharp promotes a 1-channel raw to sRGB on output; without this the readback is
  // 3 channels and every row ends up phase-shifted by w/3 (horizontal striping).
  if (ch === 1) pipe = pipe.toColourspace('b-w');
  const out = await pipe.raw().toBuffer();
  if (out.length !== w * h * ch) throw new Error(`blurF32 channel mismatch: got ${out.length} want ${w * h * ch}`);
  const r = new Float32Array(w * h * ch);
  for (let i = 0; i < r.length; i++) r[i] = out[i];
  return r;
}
export async function blurAlpha(a01, w, h, sigma) {
  if (sigma < 0.32) return Float32Array.from(a01);
  const s = new Float32Array(w * h);
  for (let i = 0; i < s.length; i++) s[i] = a01[i] * 255;
  const f = await blurF32(s, w, h, 1, sigma);
  const o = new Float32Array(w * h);
  for (let i = 0; i < o.length; i++) o[i] = f[i] / 255;
  return o;
}

/* ───────────────── octave analysis (mirrors tools/_review/sharp.mjs) ───────────────── */
/** separable running-sum box blur, partial windows at the border (== the reviewer's) */
export function boxBlur(src, w, h, r, out) {
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
export const OCTAVE_RADII = [1, 2, 4, 8, 16];
/** band k = blur(L, r_{k-1}) - blur(L, r_k), with blur(L,0)=L. Exactly the reviewer's cascade. */
export function octaveBands(L, w, h, radii = OCTAVE_RADII) {
  const bands = [];
  let prev = L;
  for (const r of radii) {
    const b = boxBlur(L, w, h, r);
    const d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) d[i] = prev[i] - b[i];
    bands.push(d);
    prev = b;
  }
  return { bands, residual: prev };
}
export function sigmaIn(arr, w, h, box) {
  const { left, top, width, height } = box;
  let s = 0, n = 0, m = 0;
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) { m += arr[y * w + x]; n++; }
  m /= n;
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) { const d = arr[y * w + x] - m; s += d * d; }
  return Math.sqrt(s / n);
}
export function lumaOf(rgb, n, out) {
  const L = out || new Float32Array(n);
  for (let k = 0; k < n; k++) L[k] = 0.2126 * rgb[k * 3] + 0.7152 * rgb[k * 3 + 1] + 0.0722 * rgb[k * 3 + 2];
  return L;
}
export function octaveProfile(rgb, w, h, box) {
  const L = lumaOf(rgb, w * h);
  const { bands } = octaveBands(L, w, h);
  return bands.map((b) => sigmaIn(b, w, h, box));
}

/* ─────────────────────────── colour ─────────────────────────── */
export function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0; const d = mx - mn;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
export function hsl2rgb(h, s, l, out) {
  h = ((h % 360) + 360) % 360 / 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  out[0] = r * 255; out[1] = g * 255; out[2] = b * 255;
  return out;
}
export function hslStats(rgb, w, h, box) {
  const { left, top, width, height } = box;
  let H = 0, S = 0, L = 0, n = 0;
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
    const k = (y * w + x) * 3;
    const [hh, ss, ll] = rgb2hsl(rgb[k], rgb[k + 1], rgb[k + 2]);
    H += hh; S += ss; L += ll; n++;
  }
  return { H: H / n, S: S / n, L: L / n };
}
