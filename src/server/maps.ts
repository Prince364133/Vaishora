import "server-only";
import { Queryable } from "./db";

// Google Maps Platform, called from the server only (the API key never reaches the browser):
// Places API (New) autocomplete + details, Geocoding, Maps Static (URL with the browser key).
//   GOOGLE_MAPS_API_KEY          server key (Places New, Geocoding)
//   GOOGLE_MAPS_BROWSER_API_KEY  referrer-restricted key, only for Maps Static images

export class MapsError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

/** Greater Hyderabad (GHMC + HMDA core): searches are restricted to it, addresses outside are refused. */
export const HYDERABAD_BOUNDS = { low: { latitude: 17.15, longitude: 78.15 }, high: { latitude: 17.75, longitude: 78.8 } };
const inHyderabad = (lat: number, lng: number) =>
  lat >= HYDERABAD_BOUNDS.low.latitude && lat <= HYDERABAD_BOUNDS.high.latitude && lng >= HYDERABAD_BOUNDS.low.longitude && lng <= HYDERABAD_BOUNDS.high.longitude;

const key = () => process.env.GOOGLE_MAPS_API_KEY || "";
export const mapsConfigured = () => !!key();

async function google<T>(url: string, init: RequestInit & { fieldMask?: string } = {}): Promise<T> {
  if (!key()) throw new MapsError("Location search is not configured.", 503);
  const { fieldMask, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key(), ...(fieldMask ? { "X-Goog-FieldMask": fieldMask } : {}), ...(rest.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    console.error("[maps]", res.status, json?.error?.message);
    throw new MapsError("Location service is unavailable right now. Please try again.");
  }
  return json;
}

export interface Suggestion {
  placeId: string;
  main: string;
  secondary: string;
}

/** Address or area suggestions inside Hyderabad. `kind: "region"` returns localities/neighbourhoods only. */
export async function autocomplete(input: string, sessionToken: string, kind: "address" | "region" = "address"): Promise<Suggestion[]> {
  const r = await google<{ suggestions?: { placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } }; text?: { text: string } } }[] }>(
    "https://places.googleapis.com/v1/places:autocomplete",
    {
      method: "POST",
      body: JSON.stringify({
        input,
        sessionToken,
        languageCode: "en",
        includedRegionCodes: ["in"],
        locationRestriction: { rectangle: HYDERABAD_BOUNDS },
        ...(kind === "region" ? { includedPrimaryTypes: ["neighborhood", "sublocality", "sublocality_level_1", "sublocality_level_2", "locality"] } : {}),
      }),
    },
  );
  return (r.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      placeId: p.placeId,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondary: (p.structuredFormat?.secondaryText?.text ?? "").replace(/, India$/, ""),
    }));
}

type Component = { longText: string; types: string[] };
export interface PlaceInfo {
  placeId: string | null;
  formatted: string;
  lat: number;
  lng: number;
  components: Component[];
}

export async function placeDetails(placeId: string, sessionToken?: string): Promise<PlaceInfo> {
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) throw new MapsError("Invalid place.", 400);
  const r = await google<{ id: string; formattedAddress?: string; location?: { latitude: number; longitude: number }; addressComponents?: Component[] }>(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : ""}`,
    { fieldMask: "id,formattedAddress,location,addressComponents" },
  );
  if (!r.location) throw new MapsError("That place has no location.", 422);
  return { placeId: r.id, formatted: (r.formattedAddress ?? "").replace(/, India$/, ""), lat: r.location.latitude, lng: r.location.longitude, components: r.addressComponents ?? [] };
}

/** Address at a point (for "use my current location" and for map pin moves). */
export async function reverseGeocode(lat: number, lng: number): Promise<PlaceInfo> {
  const r = await google<{ results?: { place_id: string; formatted_address: string; address_components: { long_name: string; types: string[] }[] }[]; status?: string }>(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(key())}&language=en`,
  );
  const best = r.results?.[0];
  if (!best) throw new MapsError("We couldn’t find an address at that spot.", 422);
  return {
    placeId: best.place_id,
    formatted: best.formatted_address.replace(/, India$/, ""),
    lat,
    lng,
    components: best.address_components.map((c) => ({ longText: c.long_name, types: c.types })),
  };
}

async function geocodeText(text: string): Promise<{ placeId: string; lat: number; lng: number } | null> {
  const r = await google<{ results?: { place_id: string; geometry: { location: { lat: number; lng: number } } }[] }>(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&components=country:IN&key=${encodeURIComponent(key())}`,
  );
  const g = r.results?.[0];
  if (!g || !inHyderabad(g.geometry.location.lat, g.geometry.location.lng)) return null;
  return { placeId: g.place_id, lat: g.geometry.location.lat, lng: g.geometry.location.lng };
}

/** Fills coordinates for localities that don't have them yet (a few per call; idempotent). */
export async function geocodeLocalities(q: Queryable, limit = 30) {
  if (!mapsConfigured()) return 0;
  const rows = await q.query<{ id: number; name: string; city: string }>(`SELECT id, name, city FROM localities WHERE lat IS NULL AND geocoded_at IS NULL ORDER BY id LIMIT $1`, [limit]);
  let n = 0;
  await Promise.all(
    rows.map(async (l) => {
      try {
        const g = await geocodeText(`${l.name}, ${l.city}, Telangana`);
        await q.query(`UPDATE localities SET geocoded_at = now() WHERE id = $1`, [l.id]);
        if (!g) return;
        await q.query(`UPDATE localities SET lat = $2, lng = $3, place_id = COALESCE(place_id, $4) WHERE id = $1`, [l.id, g.lat, g.lng, g.placeId]).catch(() =>
          q.query(`UPDATE localities SET lat = $2, lng = $3 WHERE id = $1`, [l.id, g.lat, g.lng]),
        );
        n++;
      } catch (e) {
        console.warn("[maps] geocode locality failed", l.name, (e as Error).message);
      }
    }),
  );
  return n;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const AREA_TYPES = ["sublocality_level_2", "neighborhood", "sublocality_level_1", "sublocality"];

function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export interface ResolvedLocality {
  id: number;
  name: string;
  /** How the match was made: the area's own name, or the nearest locality we know. */
  match: "name" | "nearest" | "new";
}

/**
 * Matches a place to the locality artists choose in their service areas: by the area name Google gives
 * (neighbourhood / sublocality), else the nearest known locality within 3.5 km, else a new locality is
 * created from Google's data (so the list grows with real Hyderabad areas).
 */
export async function resolveLocality(q: Queryable, p: PlaceInfo): Promise<ResolvedLocality> {
  if (!inHyderabad(p.lat, p.lng)) throw new MapsError("We currently serve Hyderabad only.", 422);
  await geocodeLocalities(q, 40);
  const areaNames = AREA_TYPES.flatMap((t) => p.components.filter((c) => c.types.includes(t)).map((c) => c.longText));
  const locs = await q.query<{ id: number; name: string; zone: string; lat: number | null; lng: number | null }>(`SELECT id, name, zone, lat, lng FROM localities WHERE active`);
  for (const a of areaNames) {
    const hit = locs.find((l) => norm(l.name) === norm(a));
    if (hit) return { id: hit.id, name: hit.name, match: "name" };
  }
  const near = locs
    .filter((l) => l.lat != null && l.lng != null)
    .map((l) => ({ l, d: km(p.lat, p.lng, l.lat!, l.lng!) }))
    .sort((a, b) => a.d - b.d);
  if (near[0] && near[0].d <= 3.5) return { id: near[0].l.id, name: near[0].l.name, match: "nearest" };
  const name = areaNames[0];
  if (!name) {
    if (near[0]) return { id: near[0].l.id, name: near[0].l.name, match: "nearest" };
    throw new MapsError("We couldn’t place this address in a Hyderabad locality. Try searching for your area.", 422);
  }
  const zone = near[0]?.l.zone ?? "Hyderabad";
  const r = await q.query<{ id: number; name: string }>(
    `INSERT INTO localities(name, zone, city, lat, lng, source) VALUES ($1, $2, 'Hyderabad', $3, $4, 'google')
     ON CONFLICT (name) DO UPDATE SET lat = COALESCE(localities.lat, EXCLUDED.lat), lng = COALESCE(localities.lng, EXCLUDED.lng), active = true
     RETURNING id, name`,
    [name, zone, p.lat, p.lng],
  );
  return { id: r[0].id, name: r[0].name, match: "new" };
}

/** Creates (or finds) a locality from a Google area place — used when artists add service areas. */
export async function localityFromPlace(q: Queryable, placeId: string, sessionToken?: string) {
  const p = await placeDetails(placeId, sessionToken);
  if (!inHyderabad(p.lat, p.lng)) throw new MapsError("Choose an area in Hyderabad.", 422);
  const name = AREA_TYPES.concat(["locality"]).flatMap((t) => p.components.filter((c) => c.types.includes(t)).map((c) => c.longText))[0] ?? p.formatted.split(",")[0];
  const existing = (await q.query<{ id: number; name: string }>(`SELECT id, name FROM localities WHERE place_id = $1 OR lower(name) = lower($2) LIMIT 1`, [p.placeId, name]))[0];
  if (existing) {
    await q.query(`UPDATE localities SET active = true, lat = COALESCE(lat, $2), lng = COALESCE(lng, $3) WHERE id = $1`, [existing.id, p.lat, p.lng]);
    return existing;
  }
  const locs = await q.query<{ zone: string; lat: number | null; lng: number | null }>(`SELECT zone, lat, lng FROM localities WHERE lat IS NOT NULL`);
  const zone = locs.map((l) => ({ z: l.zone, d: km(p.lat, p.lng, l.lat!, l.lng!) })).sort((a, b) => a.d - b.d)[0]?.z ?? "Hyderabad";
  return (
    await q.query<{ id: number; name: string }>(
      `INSERT INTO localities(name, zone, city, lat, lng, place_id, source) VALUES ($1,$2,'Hyderabad',$3,$4,$5,'google') RETURNING id, name`,
      [name, zone, p.lat, p.lng, p.placeId],
    )
  )[0];
}

/** Maps Static image URL (browser key; restrict it to your domains in Google Cloud). */
export function staticMapUrl(lat: number, lng: number, size = "640x260") {
  const k = process.env.GOOGLE_MAPS_BROWSER_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!k) return null;
  const marker = `color:0x4b1d3f|${lat},${lng}`;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=16&scale=2&size=${size}&markers=${encodeURIComponent(marker)}&key=${encodeURIComponent(k)}`;
}
