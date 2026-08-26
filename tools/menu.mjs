/* ============================================================================
   The menu — the only interactive thing in the site.

   Opens over the film, closes on Escape, returns focus. Run it at the END of
   the shot, because that is where the ink has crossed to dark and the overlay
   has to work against a pale sky rather than against black.

   Run: node tools/menu.mjs
   ========================================================================== */
import { chromium } from "playwright";

const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1512, height: 945 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message.slice(0, 140)));

await p.goto("http://localhost:3000/?qa=1", { waitUntil: "networkidle" });
await p.waitForFunction(() => !!window.__cine, null, { timeout: 30000 });
await p.waitForTimeout(3000);
await p.evaluate(() => window.__cine.seek(14.2));
await p.waitForTimeout(500);

await p.getByRole("button", { name: /menu/i }).click();
await p.waitForTimeout(1400);
await p.screenshot({ path: "tools/_preview/menu-open.png" });

await p.keyboard.press("Escape");
await p.waitForTimeout(900);
await p.screenshot({ path: "tools/_preview/menu-closed.png" });

const focus = await p.evaluate(() => {
  const a = document.activeElement;
  return a ? `${a.tagName} "${(a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 24)}"` : "none";
});
console.log("focus returned to:", focus);
console.log(errs.length ? errs.slice(0, 3) : "no errors");
await b.close();
