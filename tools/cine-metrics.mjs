/* ============================================================================
   The shot, in numbers.

   Composition is not a matter of taste until it is first a matter of geometry.
   This samples the film at a fine cadence and reports, for each moment:

     diam   the planet's apparent diameter, as a percentage of frame HEIGHT
     horiz  where the horizon crosses the frame, top = 0%, bottom = 100%.
            This is the composition. Above 100 the planet has left the frame
            through the bottom and the shot is inside the air.
     grow   apparent-size acceleration, %vh/s². The world-space numbers below
            are reported too, but at r≈296 a large world acceleration moves
            almost nothing on screen — this is what is actually seen.
     r      altitude, in scene units
     v      world-space camera speed, units per second
     acc    world-space acceleration — the number that decides whether the
            motion reads as smooth. A camera whose acceleration has spikes at
            control points is the "jumpy" everyone can see and nobody can find.
     fov    degrees
     roll   degrees
     lum    background luminance, which must rise monotonically and smoothly

   Run:  node tools/cine-metrics.mjs
   ========================================================================== */
import { chromium } from "playwright";
import sharp from "sharp";
import fs from "node:fs";

const W = 1512;
const H = 945;
const N = Number(process.env.N || 285); // 0.05s steps

const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await p.goto("http://localhost:3000/?qa=1", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForFunction(() => !!window.__cine, null, { timeout: 30000 });
await p.waitForTimeout(2500);

const rows = await p.evaluate((n) => window.__cine.sample(n), N);
await b.close();

/* central differences on the raw position trace */
const dt = rows[1].t - rows[0].t;
const vel = rows.map((_, i) => {
  const a = rows[Math.max(0, i - 1)];
  const c = rows[Math.min(rows.length - 1, i + 1)];
  const d = Math.hypot(c.px - a.px, c.py - a.py, c.pz - a.pz);
  return d / ((c.t - a.t) || dt);
});
const acc = vel.map((_, i) => {
  const a = vel[Math.max(0, i - 1)];
  const c = vel[Math.min(vel.length - 1, i + 1)];
  return (c - a) / (2 * dt);
});

const dia = rows.map((r) => r.diam * 100);
const grow = dia.map((_, i) => {
  const a = dia[Math.max(0, i - 1)];
  const c = dia[Math.min(dia.length - 1, i + 1)];
  return (c - 2 * dia[i] + a) / (dt * dt);
});

console.log(
  "  t     diam%  horiz%   grow      r      v      acc     fov    roll   lum"
);
for (let i = 0; i < rows.length; i += 8) {
  const r = rows[i];
  console.log(
    `${r.t.toFixed(1).padStart(5)} ` +
      `${(r.diam * 100).toFixed(1).padStart(6)} ` +
      `${(r.hy * 100).toFixed(1).padStart(6)} ` +
      `${grow[i].toFixed(1).padStart(6)} ` +
      `${r.r.toFixed(1).padStart(7)} ` +
      `${vel[i].toFixed(1).padStart(6)} ` +
      `${acc[i].toFixed(1).padStart(7)} ` +
      `${r.fov.toFixed(1).padStart(6)} ` +
      `${r.roll.toFixed(2).padStart(6)} ` +
      `${r.lum.toFixed(3).padStart(6)}`
  );
}

const worstAcc = Math.max(...acc.map(Math.abs));
const jerk = acc.map((_, i) => Math.abs((acc[Math.min(acc.length - 1, i + 1)] - acc[Math.max(0, i - 1)]) / (2 * dt)));
const gj = grow.map((_, i) => Math.abs((grow[Math.min(grow.length - 1, i + 1)] - grow[Math.max(0, i - 1)]) / (2 * dt)));
console.log(`\nworld  peak |acc| ${worstAcc.toFixed(1)} u/s²   peak |jerk| ${Math.max(...jerk).toFixed(0)} u/s³`);
console.log(`screen peak |size acc| ${Math.max(...grow).toFixed(1)} vh/s²  peak |size jerk| ${Math.max(...gj).toFixed(0)} vh/s³`);
console.log(`horizon crosses mid-frame at t=${(rows.find((r) => r.t > 5 && r.hy >= 0.5)?.t ?? -1).toFixed(2)}s, leaves frame at t=${(rows.find((r) => r.t > 5 && r.hy >= 1)?.t ?? -1).toFixed(2)}s`);

/* plot: speed and acceleration, so a kink is seen rather than inferred */
const PW = 1180;
const PH = 260;
const PAD = 40;
const line = (arr, colour, width = 1.6) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of arr) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const pts = arr
    .map((v, i) => {
      const x = PAD + (i / (arr.length - 1)) * (PW - PAD * 2);
      const y = PH - PAD - ((v - lo) / span) * (PH - PAD * 1.7);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<polyline fill="none" stroke="${colour}" stroke-width="${width}" points="${pts}"/>`;
};
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}">` +
  `<rect width="${PW}" height="${PH}" fill="#14181c"/>` +
  line(vel, "#54c08a") +
  line(acc, "#e0a05a", 1.2) +
  line(rows.map((r) => r.diam), "#4a6b8e", 1.2) +
  `<text x="10" y="18" fill="#9aa6b2" font-family="monospace" font-size="12">camera — speed (green), acceleration (amber), apparent size (blue)</text>` +
  `</svg>`;
fs.mkdirSync("tools/_preview", { recursive: true });
await sharp(Buffer.from(svg)).png().toFile("tools/_preview/cine-motion.png");
console.log("tools/_preview/cine-motion.png");
