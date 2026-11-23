// High-resolution capture of the Photo 3D stage: front, turned left/right and tilted.
// Usage: node scripts/shot-photo3d.mjs [url] [outDir]   (uses the installed Google Chrome; PW_CHANNEL to override)
import { chromium } from "playwright";
const url = process.argv[2] ?? "http://localhost:3000/";
const out = process.argv[3] ?? "scripts/out/shots";
const b = await chromium.launch({ headless: true, channel: process.env.PW_CHANNEL ?? "chrome", args: ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=metal"] });
const pg = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await pg.addInitScript(() => localStorage.setItem("vaishora.viewer", "photo"));
await pg.emulateMedia({ reducedMotion: "reduce" });
await pg.goto(url, { waitUntil: "networkidle" });
await pg.waitForTimeout(9000);
const stage = pg.locator('[aria-label="Photo 3D controls"]').locator("xpath=../..");
const canvas = stage.locator("canvas").first();
const box = await canvas.boundingBox();
const arch = pg.locator(".arch").first();
const drag = async (dx, dy) => {
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 14 });
  await pg.mouse.up();
  await pg.waitForTimeout(2200);
};
const reset = async () => {
  await stage.getByRole("button", { name: "Reset view" }).click();
  await pg.waitForTimeout(1800);
};
await arch.screenshot({ path: `${out}/photo3d-front.png` });
await drag(260, 0);
await arch.screenshot({ path: `${out}/photo3d-left.png` });
await reset();
await drag(-260, 0);
await arch.screenshot({ path: `${out}/photo3d-right.png` });
await reset();
await drag(0, -200);
await arch.screenshot({ path: `${out}/photo3d-tilt.png` });
await b.close();
console.log("saved");
