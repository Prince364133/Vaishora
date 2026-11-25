import "server-only";
import { siteUrl } from "./env";

// Search and social-preview helpers. Text is written to read well in a Google result and a WhatsApp /
// Instagram / X preview card, and stays true over time (no dates or "new" claims): evergreen.

export const SITE_NAME = "VAISHORA";
export const CITY = "Hyderabad";

export const abs = (path: string) => (/^https?:\/\//.test(path) ? path : `${siteUrl()}${path.startsWith("/") ? "" : "/"}${path}`);

export function clip(text: string, max = 158) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
}

const REGION_TEXT: Record<string, string> = { palm: "palm", back: "back of the hand", palm_back: "palm and back of the hand", feet: "feet" };

export function designDescription(d: { name: string; category_name: string; description: string; region: string; base_price_paise: number; artist_name?: string | null }) {
  const price = `₹${Math.round(d.base_price_paise / 100).toLocaleString("en-IN")}`;
  const by = d.artist_name ? ` by ${d.artist_name}` : "";
  return clip(`${d.name}${by}: ${d.category_name.toLowerCase()} mehndi design for the ${REGION_TEXT[d.region] ?? "hands"}, from ${price}. ${d.description} Book a mehndi artist at home in ${CITY}.`);
}

/** Best image for previews: real photo, else fitted hand photo, else henna artwork. */
export function designImage(d: { photos?: string[]; assets: Record<string, string | undefined> }) {
  return d.photos?.[0] ?? d.assets.palm_photo ?? d.assets.back_photo ?? d.assets.palm ?? d.assets.back ?? d.assets.feet ?? null;
}
