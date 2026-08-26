/* ============================================================================
   The contact sheet.

   The film is deterministic, so it can be parked at an exact second and
   photographed. Every still has to look art-directed and the strip has to read
   as one shot — if you can point at the frame where one thing became another,
   the implementation is wrong.

   Run:  node tools/cine.mjs                 (TIMES=0,2,4 to pick)
   Out:  tools/_preview/cine.png
   ========================================================================== */
import { chromium } from "playwright";
import sharp from "sharp";
import fs from "node:fs";

const W = Number(process.env.W || 1512);
const H = Number(process.env.H || 945);
const TIMES = (process.env.TIMES ||
  "0,0.8,1.6,2.4,3.2,4,4.8,5.6,6.4,7.2,8,8.8,9.6,10.4,11.2,12,12.8,13.6,14.2")
  .split(",")
  .map(Number);

const b = await chromium.launch({
  headless: process.env.HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=metal", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERROR " + e.message.slice(0, 200)));
p.on("console", (m) => m.type() === "error" && errs.push("CONSOLE " + m.text().slice(0, 200)));

await p.goto("http://localhost:3000/?qa=1", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForFunction(() => !!window.__cine, null, { timeout: 30000 });
// let every texture upload and every program link before the first capture
await p.waitForTimeout(4000);

fs.mkdirSync("tools/_preview", { recursive: true });
const shots = [];
for (const t of TIMES) {
  await p.evaluate((tt) => window.__cine.seek(tt), t);
  await p.waitForTimeout(320);
  shots.push({ buf: await p.screenshot(), label: `${t.toFixed(1)}s` });
}
await b.close();

const cols = Number(process.env.COLS || 4);
const TW = Math.round(1900 / cols);
const TH = Math.round((TW * H) / W) + 18;
const rows = Math.ceil(shots.length / cols);
const comps = [];
for (let i = 0; i < shots.length; i++) {
  comps.push({
    input: await sharp(shots[i].buf).resize(TW, TH - 18, { fit: "fill" }).png().toBuffer(),
    left: (i % cols) * TW,
    top: Math.floor(i / cols) * TH + 18,
  });
  comps.push({
    input: {
      text: {
        text: `<span foreground="#8e9aa6" size="8000">${shots[i].label}</span>`,
        rgba: true,
        dpi: 96,
        width: TW - 12,
      },
    },
    left: (i % cols) * TW + 7,
    top: Math.floor(i / cols) * TH + 3,
  });
}
await sharp({ create: { width: TW * cols, height: TH * rows, channels: 3, background: "#0b0e11" } })
  .composite(comps)
  .png()
  .toFile("tools/_preview/cine.png");

console.log(errs.length ? errs.slice(0, 5).join("\n") : "no page errors");
console.log("tools/_preview/cine.png");
