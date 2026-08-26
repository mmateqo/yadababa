/* One frame, full size. `node tools/cine-frame.mjs 9.6` */
import { chromium } from "playwright";
const T = (process.env.TIMES || process.argv[2] || "9.6").split(",").map(Number);
const W = Number(process.env.W || 1512), H = Number(process.env.H || 945);
const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await p.goto("http://localhost:3000/?qa=1", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForFunction(() => !!window.__cine, null, { timeout: 30000 });
await p.waitForTimeout(4000);
for (const t of T) {
  await p.evaluate((tt) => window.__cine.seek(tt), t);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `tools/_preview/f${String(t).replace(".", "_")}.png` });
  console.log(`tools/_preview/f${String(t).replace(".", "_")}.png`);
}
await b.close();
