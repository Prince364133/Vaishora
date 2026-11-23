// Generates the built-in mehndi artwork SVGs into public/designs/.
// Run: npx tsx scripts/generate-artwork.ts [--preview]
import fs from "node:fs";
import { artworkSvg, STYLE_SIDES, ArtStyle } from "../src/lib/mehndi/artwork";

fs.mkdirSync("public/designs", { recursive: true });
const preview: string[] = [];
for (const [style, sides] of Object.entries(STYLE_SIDES) as [ArtStyle, string[]][]) {
  for (const side of sides) {
    const svg = artworkSvg(style, side as "palm");
    fs.writeFileSync(`public/designs/${style}-${side}.svg`, svg);
    if (process.argv.includes("--preview")) {
      const sil = side === "feet" ? "" : fs.readFileSync(`scripts/out/silhouette-${side}.path.txt`, "utf8");
      const art = artworkSvg(style, side as "palm", { color: "#5b1f0f" }).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
      preview.push(`<figure><svg viewBox="0 0 1000 1000" width="420" height="420"><path d="${sil}" fill="#d9a07f" stroke="#d9a07f" stroke-width="1"/>${art}</svg><figcaption>${style} / ${side}</figcaption></figure>`);
    }
  }
}
if (preview.length) fs.writeFileSync("scripts/out/preview.html", `<html><body style="display:flex;flex-wrap:wrap;gap:8px;background:#fff;font:14px sans-serif">${preview.join("")}</body></html>`);
console.log("done");
