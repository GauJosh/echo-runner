// Smoke test — loads the actual game in a headless browser and checks it
// starts cleanly. No framework, just Playwright directly: catches the class
// of bug that only shows up at runtime (a typo, a null reference on init)
// that `node --check`'s syntax check can't, without needing to refactor the
// game into unit-testable modules first.
import { chromium } from "playwright";

const url = process.env.SMOKE_TEST_URL || "http://localhost:8080";
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage();

page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
});

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(500); // let the first frame(s) render

const canvasSize = await page.evaluate(() => {
  const c = document.getElementById("gameCanvas");
  return c ? { width: c.width, height: c.height } : null;
});

const hudText = await page.evaluate(() => document.getElementById("roundLine")?.textContent ?? null);

await browser.close();

let failed = false;

if (errors.length > 0) {
  console.error("FAIL: console/page errors detected:\n" + errors.join("\n"));
  failed = true;
}
if (!canvasSize || canvasSize.width !== 480 || canvasSize.height !== 800) {
  console.error(`FAIL: canvas did not initialize to the expected 480x800 (got ${JSON.stringify(canvasSize)})`);
  failed = true;
}
if (!hudText) {
  console.error("FAIL: HUD did not render");
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`Smoke test passed. Canvas: ${JSON.stringify(canvasSize)}, HUD: "${hudText}"`);
