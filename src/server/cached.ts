import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { listCategories, listDesigns, listLocalities, listPricingRules, listPublicArtists } from "./catalog";
import { getSettings } from "./settings";

// Catalogue reads are cached and tagged; admin mutations call revalidateTag("catalog").

export async function cachedDesigns() {
  "use cache";
  cacheTag("catalog");
  cacheLife("minutes");
  return listDesigns();
}

export async function cachedCategories() {
  "use cache";
  cacheTag("catalog");
  cacheLife("minutes");
  return listCategories();
}

export async function cachedPricingRules() {
  "use cache";
  cacheTag("catalog");
  cacheLife("minutes");
  return listPricingRules();
}

export async function cachedLocalities() {
  "use cache";
  cacheTag("catalog");
  cacheLife("minutes");
  return listLocalities();
}

export async function cachedSettings() {
  "use cache";
  cacheTag("catalog");
  cacheLife("minutes");
  return getSettings();
}

export async function cachedArtists() {
  "use cache";
  cacheTag("artists");
  cacheLife("minutes");
  const s = await getSettings();
  return listPublicArtists({ includeDemo: s.allow_demo_artists });
}
