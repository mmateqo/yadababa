/* ============================================================================
   SELORA — colour.

   OKLab, not sRGB or HSL. A straight lerp from black to cobalt in sRGB dips
   through a muddy desaturated middle, and HSL swings the hue through purple on
   the way. OKLab is perceptually uniform: the midpoint of black-to-cobalt looks
   like the midpoint, and the sky never passes through a colour it does not
   contain.

   There is no purple anywhere in this site, and this file is the reason.
   ========================================================================== */

export type Rgb = [number, number, number];

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const toSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function rgbToOklab([r, g, b]: Rgb): Rgb {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp01(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp01(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp01(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

export const cssRgb = (c: Rgb) =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

/** relative luminance of a display-referred triple */
export const luminance = ([r, g, b]: Rgb) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/* ── ramps ────────────────────────────────────────────────────────────────── */

export type ColorStop = [at: number, hex: string];

const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** A colour ramp sampled in OKLab and returned display-referred. */
export function sampleRamp(stops: ColorStop[], t: number): Rgb {
  if (!stops.length) return [0, 0, 0];
  if (t <= stops[0][0]) return hexToRgb(stops[0][1]);
  const last = stops[stops.length - 1];
  if (t >= last[0]) return hexToRgb(last[1]);
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (t >= a && t <= b) {
      const u = smootherstep((t - a) / (b - a));
      const A = rgbToOklab(hexToRgb(ca));
      const B = rgbToOklab(hexToRgb(cb));
      return oklabToRgb([
        A[0] + (B[0] - A[0]) * u,
        A[1] + (B[1] - A[1]) * u,
        A[2] + (B[2] - A[2]) * u,
      ]);
    }
  }
  return hexToRgb(last[1]);
}
