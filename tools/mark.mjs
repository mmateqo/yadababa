/* ============================================================================
   SELORA mark.

   The silhouette is built the way a fish is shaped rather than by hand-placing
   bezier handles: a centreline, a depth profile sampled along it, fins spliced
   into the top and bottom edges at named stations, and a heterocercal tail
   closed across the peduncle. The whole outline is then smoothed with a
   Catmull-Rom pass, with the tips flagged as corners so they stay sharp.

   Everything worth tuning is in SHAPE below. Re-run: node tools/mark.mjs
   ========================================================================== */
import sharp from "sharp";
import fs from "node:fs";

const SHAPE = {
  nose: 93,
  peduncle: 30,
  /** depth profile along the body: [t, half-height] */
  depth: [
    [0.0, 0.5], [0.05, 2.4], [0.14, 6.0], [0.28, 8.8],
    [0.44, 9.4], [0.6, 8.2], [0.76, 5.6], [0.88, 3.6], [1.0, 2.3],
  ],
  centre: (t) => 54.0 + 1.5 * t,
  topScale: 0.94,
  bellyScale: 1.08,
  dorsal: { from: 0.32, to: 0.53, rise: 17.5, rake: 8.5, lead: 0.24, trail: 0.36 },
  pectoral: { from: 0.4, to: 0.6, rise: 14.5, rake: 11.5, lead: 0.22, trail: 0.34 },
  tail: {
    upper: [12.5, 28.5],
    fork: [22.0, 58.5],
    lower: [17.5, 68.5],
    leadBow: 0.3,
    trailBow: 0.16,
  },
};

const lerp = (a, b, t) => a + (b - a) * t;

function depthAt(t) {
  const d = SHAPE.depth;
  if (t <= d[0][0]) return d[0][1];
  if (t >= d[d.length - 1][0]) return d[d.length - 1][1];
  for (let i = 0; i < d.length - 1; i++) {
    if (t >= d[i][0] && t <= d[i + 1][0]) {
      const u = (t - d[i][0]) / (d[i + 1][0] - d[i][0]);
      return lerp(d[i][1], d[i + 1][1], u * u * (3 - 2 * u));
    }
  }
  return 0;
}

const xAt = (t) => lerp(SHAPE.nose, SHAPE.peduncle, t);
const topAt = (t) => [xAt(t), SHAPE.centre(t) - depthAt(t) * SHAPE.topScale];
const botAt = (t) => [xAt(t), SHAPE.centre(t) + depthAt(t) * SHAPE.bellyScale];

/** A fin spliced into an edge: root, swept tip, root — with a bowed leading
    edge and a hollow trailing edge, which is what makes a fin falcate. */
function fin(edgeAt, cfg, dir) {
  const a = edgeAt(cfg.from);
  const b = edgeAt(cfg.to);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const tip = [mid[0] - cfg.rake, mid[1] + dir * cfg.rise];
  const pts = [];
  // leading edge, bowed outward
  for (let i = 1; i <= 4; i++) {
    const u = i / 5;
    const bx = lerp(a[0], tip[0], u) + Math.sin(Math.PI * u) * cfg.rake * cfg.lead;
    const by = lerp(a[1], tip[1], u) - Math.sin(Math.PI * u) * cfg.rise * 0.06 * dir;
    pts.push([bx, by]);
  }
  pts.push({ p: tip, corner: true });
  // trailing edge, hollow
  for (let i = 1; i <= 4; i++) {
    const u = i / 5;
    const bx = lerp(tip[0], b[0], u) + Math.sin(Math.PI * u) * cfg.rake * cfg.trail;
    const by = lerp(tip[1], b[1], u) - Math.sin(Math.PI * u) * cfg.rise * 0.16 * dir;
    pts.push([bx, by]);
  }
  return pts;
}

function bow(a, b, amount, sign) {
  const out = [];
  const nx = -(b[1] - a[1]);
  const ny = b[0] - a[0];
  const len = Math.hypot(nx, ny) || 1;
  for (let i = 1; i <= 4; i++) {
    const u = i / 5;
    const s = Math.sin(Math.PI * u) * amount * len * 0.25 * sign;
    out.push([lerp(a[0], b[0], u) + (nx / len) * s, lerp(a[1], b[1], u) + (ny / len) * s]);
  }
  return out;
}

function outline() {
  const pts = [];
  const push = (p, corner = false) => pts.push({ p: Array.isArray(p) ? p : p.p, corner: corner || p.corner === true });

  // snout, then the back to the dorsal
  push(topAt(0), true);
  for (let t = 0.04; t < SHAPE.dorsal.from - 1e-6; t += 0.04) push(topAt(t));
  push(topAt(SHAPE.dorsal.from));
  for (const q of fin(topAt, SHAPE.dorsal, -1)) push(q);
  push(topAt(SHAPE.dorsal.to));
  for (let t = SHAPE.dorsal.to + 0.05; t < 1; t += 0.05) push(topAt(t));

  // the tail, closed across the peduncle
  const pt = topAt(1);
  const pb = botAt(1);
  const T = SHAPE.tail;
  for (const q of bow(pt, T.upper, T.leadBow, 1)) push(q);
  push(T.upper, true);
  for (const q of bow(T.upper, T.fork, T.trailBow, 1)) push(q);
  push(T.fork, true);
  for (const q of bow(T.fork, T.lower, 0.12, 1)) push(q);
  push(T.lower, true);
  for (const q of bow(T.lower, pb, 0.26, 1)) push(q);

  // the belly forward, through the pectoral, to the chin
  for (let t = 1 - 0.05; t > SHAPE.pectoral.to; t -= 0.05) push(botAt(t));
  push(botAt(SHAPE.pectoral.to));
  for (const q of fin(botAt, SHAPE.pectoral, 1).reverse()) push(q);
  push(botAt(SHAPE.pectoral.from));
  for (let t = SHAPE.pectoral.from - 0.05; t > 0.02; t -= 0.05) push(botAt(t));

  return pts;
}

/** Catmull-Rom → cubic, with corners left sharp. */
function smooth(points) {
  const n = points.length;
  const P = (i) => points[((i % n) + n) % n].p;
  const isCorner = (i) => points[((i % n) + n) % n].corner;
  const r = (v) => Math.round(v * 100) / 100;
  const d = [`M ${r(P(0)[0])} ${r(P(0)[1])}`];
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const k1 = isCorner(i) ? 0 : 1 / 6;
    const k2 = isCorner(i + 1) ? 0 : 1 / 6;
    const c1 = [p1[0] + (p2[0] - p0[0]) * k1, p1[1] + (p2[1] - p0[1]) * k1];
    const c2 = [p2[0] - (p3[0] - p1[0]) * k2, p2[1] - (p3[1] - p1[1]) * k2];
    d.push(`C ${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p2[0])} ${r(p2[1])}`);
  }
  d.push("Z");
  return d.join(" ");
}

const shark = smooth(outline());

/* The dorsal alone, for the scroll marker. */
const fin2 = (() => {
  const pts = [{ p: [70, 11], corner: true }];
  for (const q of bow([70, 11], [86, 82], 0.16, 1)) pts.push({ p: q });
  pts.push({ p: [86, 82], corner: true });
  for (const q of bow([86, 82], [18, 82], 0.06, 1)) pts.push({ p: q });
  pts.push({ p: [18, 82], corner: true });
  for (const q of bow([18, 82], [70, 11], -0.3, 1)) pts.push({ p: q });
  return smooth(pts);
})();

/* ── preview ────────────────────────────────────────────────────────────── */
const OUT = "tools/_preview";
fs.mkdirSync(OUT, { recursive: true });
const svg = (d, size, fg, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><rect width="100" height="100" fill="${bg}"/><path d="${d}" fill="${fg}" fill-rule="evenodd"/></svg>`;

const SIZES = [16, 22, 32, 56, 260];
const rows = [];
for (const d of [shark, fin2]) {
  for (const [fg, bg] of [["#0d1116", "#eef2f4"], ["#f2f6f8", "#0b1015"]]) {
    const tiles = [];
    let x = 0;
    for (const s of SIZES) {
      tiles.push({
        input: await sharp(Buffer.from(svg(d, s, fg, bg))).png().toBuffer(),
        left: x + Math.round((280 - s) / 2),
        top: Math.round((280 - s) / 2),
      });
      x += 280;
    }
    rows.push(
      await sharp({ create: { width: 280 * SIZES.length, height: 280, channels: 3, background: bg } })
        .composite(tiles).png().toBuffer()
    );
  }
}
await sharp({ create: { width: 280 * SIZES.length, height: 280 * rows.length, channels: 3, background: "#777" } })
  .composite(rows.map((b, i) => ({ input: b, left: 0, top: i * 280 })))
  .png().toFile(`${OUT}/mark-sheet.png`);

fs.writeFileSync(
  "components/ui/sharkPaths.ts",
  `/* ============================================================================
   SELORA — the mark.

   One closed silhouette on a 100x100 box: pointed snout, one falcate dorsal,
   one swept pectoral, a heterocercal tail. No strokes, no counters, nothing
   that does not survive 16px.

   Generated by tools/mark.mjs from a depth profile and a handful of named
   stations — tune the SHAPE block there and re-run rather than editing these
   numbers by hand.
   ========================================================================== */

export const SHARK_VIEWBOX = "0 0 100 100";

export const SHARK_PATH =
  "${shark}";

/** Reduced to the dorsal alone, for the scroll marker at 13px. */
export const SHARK_FIN_PATH =
  "${fin2}";
`
);
fs.mkdirSync("public/icons", { recursive: true });
for (const [file, d] of [["shark.svg", shark], ["shark-fin.svg", fin2]]) {
  fs.writeFileSync(
    `public/icons/${file}`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${d}" fill="currentColor" fill-rule="evenodd"/></svg>\n`
  );
}
console.log(`${OUT}/mark-sheet.png`);
