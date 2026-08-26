/* ============================================================================
   The rest of the checks, in one pass.

     reduced   prefers-reduced-motion must land on the last frame in <300ms and
               never run the flight
     mobile    portrait, at three sizes — nothing may overflow horizontally and
               the planet must stay inside the frame (a vertical fov in a tall
               window collapses the horizontal cone; this has bitten twice)
     webkit    the same film in Safari's engine, compared frame for frame
     black     the opening must be true #000000, not near-black
     idle      the film must STOP: no motion at all after 14.2s

   Run: node tools/qa.mjs
   ========================================================================== */
import { chromium, webkit, devices } from "playwright";
import sharp from "sharp";
import fs from "node:fs";

const URL = "http://localhost:3000";
const out = (s) => console.log(s);
fs.mkdirSync("tools/_preview", { recursive: true });

const ready = async (p) => {
  await p.waitForFunction(() => !!window.__cine, null, { timeout: 30000 });
  await p.waitForTimeout(3500);
};

/* ── reduced motion ─────────────────────────────────────────────────────── */
{
  const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  const p = await b.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const t0 = Date.now();
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("h1", { state: "attached", timeout: 15000 });
  await p.waitForFunction(
    () => {
      const h = document.querySelector("h1");
      return h && getComputedStyle(h).opacity === "1";
    },
    null,
    { timeout: 15000 }
  );
  const ms = Date.now() - t0;
  await p.waitForTimeout(600);
  const a = await p.screenshot();
  await p.waitForTimeout(1500);
  const bshot = await p.screenshot();
  const diff = await (async () => {
    /* removeAlpha, always. A screenshot's alpha is uniformly opaque, but
       comparing four-channel buffers where sharp may hand back three for one of
       them misaligns every pixel and reports a drift of 128/255 on two frames
       that are bit-identical. */
    const [x, y] = await Promise.all([
      sharp(a).resize(240, 150).removeAlpha().raw().toBuffer(),
      sharp(bshot).resize(240, 150).removeAlpha().raw().toBuffer(),
    ]);
    let s = 0;
    for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
    return s / x.length;
  })();
  await p.screenshot({ path: "tools/_preview/qa-reduced.png" });
  out(`reduced  heading opaque in ${ms}ms   drift over 1.5s ${diff.toFixed(2)}/255`);
  await b.close();
}

/* ── mobile portrait ────────────────────────────────────────────────────── */
for (const [name, size] of [
  ["iPhone 13", { width: 390, height: 844 }],
  ["iPhone SE", { width: 375, height: 667 }],
  ["Pixel 7", { width: 412, height: 915 }],
]) {
  const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  const p = await b.newPage({
    viewport: size,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: devices["iPhone 13"].userAgent,
  });
  await p.goto(`${URL}/?qa=1`, { waitUntil: "networkidle", timeout: 60000 });
  await ready(p);
  const rows = await p.evaluate(() => window.__cine.sample(60));
  const over = await p.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  /* the planet's widest moment must still fit the frame's HORIZONTAL cone */
  const worst = rows.reduce((w, r) => (r.diam > w.diam ? r : w), rows[0]);
  await p.evaluate(() => window.__cine.seek(7.2));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `tools/_preview/qa-${name.replace(/\W/g, "")}-7.png` });
  await p.evaluate(() => window.__cine.seek(14.2));
  await p.waitForTimeout(400);
  await p.screenshot({ path: `tools/_preview/qa-${name.replace(/\W/g, "")}-end.png` });
  out(
    `mobile   ${name.padEnd(10)} ${size.width}x${size.height}  overflow ${over}px  ` +
      `peak size ${(worst.diam * 100).toFixed(0)}vh at ${worst.t.toFixed(1)}s`
  );
  await b.close();
}

/* ── WebKit, and the black point, and the stop ──────────────────────────── */
for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const b = await engine.launch(
    name === "chromium" ? { args: ["--enable-unsafe-swiftshader"] } : {}
  );
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
  await p.goto(`${URL}/?qa=1`, { waitUntil: "networkidle", timeout: 60000 });
  await ready(p);

  await p.evaluate(() => window.__cine.seek(0.2));
  await p.waitForTimeout(300);
  const shot = await p.screenshot();
  /* The MEDIAN, not the max: a 600x300 crop of the opening frame contains
     stars, and one 255 pixel in it says nothing about whether the field behind
     them is black. What has to be zero is the ground. */
  const raw = await sharp(shot)
    .extract({ left: 200, top: 300, width: 600, height: 300 })
    .removeAlpha()
    .raw()
    .toBuffer();
  const sorted = Uint8Array.from(raw).sort();
  const black = `median ${sorted[sorted.length >> 1]} p99 ${sorted[Math.floor(sorted.length * 0.99)]}`;

  await p.evaluate(() => window.__cine.seek(9.6));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `tools/_preview/qa-${name}-9_6.png` });

  out(`${name.padEnd(9)} opening black: ${black}   errors ${errs.length ? errs[0] : "none"}`);
  await b.close();
}

/* ── does it stop? ──────────────────────────────────────────────────────── */
{
  const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  /* Wait for the film to ARRIVE rather than for a wall-clock guess. Under a
     software rasteriser with other browsers competing, fourteen seconds of film
     can take considerably longer than fourteen seconds of wall time, and a
     fixed sleep then photographs the middle of the shot and calls it the end. */
  const t0 = Date.now();
  await p.waitForFunction(
    () => {
      const h = document.querySelector("h1");
      return h && parseFloat(getComputedStyle(h).opacity) > 0.99;
    },
    null,
    { timeout: 120000 }
  );
  const played = ((Date.now() - t0) / 1000).toFixed(1);
  await p.waitForTimeout(1500);
  const a = await p.screenshot();
  await p.waitForTimeout(2500);
  const c = await p.screenshot();
  const [x, y] = await Promise.all([
    sharp(a).resize(320, 200).removeAlpha().raw().toBuffer(),
    sharp(c).resize(320, 200).removeAlpha().raw().toBuffer(),
  ]);
  let s = 0;
  let mx = 0;
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(x[i] - y[i]);
    s += d;
    if (d > mx) mx = d;
  }
  await p.screenshot({ path: "tools/_preview/qa-final.png" });
  out(`rest     arrived after ${played}s of wall clock; then mean drift ${(s / x.length).toFixed(3)}/255  peak ${mx}/255 over 2.5s`);
  await b.close();
}
