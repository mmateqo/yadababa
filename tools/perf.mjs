/* ============================================================================
   Frame pacing, measured over the film rather than over a scroll.

   The film is time-driven, so there is nothing to drive: load it and watch. The
   two numbers that matter are the proportion of frames over 16.7ms — one
   dropped frame in a fourteen-second continuous camera move is visible — and
   WHERE the slow ones land, because a hitch inside the approach is worth ten
   at the very end.

   HEADED=1 uses the real GPU. Headless is SwiftShader and is a software
   rasteriser: treat its absolute numbers as a floor, not as a measurement.

   Run: node tools/perf.mjs        HEADED=1 node tools/perf.mjs
   ========================================================================== */
import { chromium } from "playwright";

const HEADED = process.env.HEADED === "1";
const b = await chromium.launch({
  headless: !HEADED,
  args: HEADED
    ? ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
    : ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const p = await b.newPage({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 1 });

const t0 = Date.now();
await p.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });

const res = await p.evaluate(async () => {
  const frames = [];
  const slow = [];
  let last = performance.now();
  const start = last;
  let running = true;
  const tick = (t) => {
    const dt = t - last;
    frames.push(dt);
    if (dt > 33) slow.push({ dt: Math.round(dt), at: +((t - start) / 1000).toFixed(2) });
    last = t;
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  /* Stop when the film has arrived, not after a fixed sleep. */
  await new Promise((resolve) => {
    const done = () => {
      const h = document.querySelector("h1");
      if (h && parseFloat(getComputedStyle(h).opacity) > 0.99) return resolve();
      setTimeout(done, 100);
    };
    done();
  });
  await new Promise((r) => setTimeout(r, 400));
  running = false;

  const f = frames.slice(20).sort((a, b) => a - b);
  const pct = (q) => f[Math.floor(f.length * q)];
  return {
    frames: f.length,
    wall: +((performance.now() - start) / 1000).toFixed(2),
    median: +pct(0.5).toFixed(2),
    p90: +pct(0.9).toFixed(2),
    p99: +pct(0.99).toFixed(2),
    worst: +f[f.length - 1].toFixed(2),
    over16: +((f.filter((x) => x > 16.9).length / f.length) * 100).toFixed(1),
    over33: +((f.filter((x) => x > 33).length / f.length) * 100).toFixed(1),
    mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
    slow: slow.slice(0, 12),
  };
});
console.log(`first byte to arrival: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
console.log(JSON.stringify(res, null, 1));
console.log(HEADED ? "headed: real GPU" : "headless SwiftShader software raster — a real GPU is materially faster");
await b.close();
