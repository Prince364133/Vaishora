import type { MetadataRoute } from "next";
import { cachedArtists, cachedDesigns } from "@/server/cached";
import { abs, designDescription, designImage } from "@/server/seo";
import { youTubeId, youTubeThumb } from "@/lib/youtube";

// XML sitemap with image and video entries, so designs and their photos can rank in Google Images
// and video results. Unlisted, draft and demo content is never included.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [designs, artists] = await Promise.all([cachedDesigns(), cachedArtists()]);
  const page = (path: string, priority: number, changeFrequency: "daily" | "weekly" | "monthly" | "yearly"): MetadataRoute.Sitemap[number] => ({
    url: abs(path),
    changeFrequency,
    priority,
  });
  return [
    page("/", 1, "daily"),
    page("/designs", 0.9, "daily"),
    page("/artists", 0.8, "weekly"),
    page("/become-an-artist", 0.6, "monthly"),
    page("/about", 0.5, "monthly"),
    page("/contact", 0.4, "yearly"),
    page("/cancellation-refund", 0.2, "yearly"),
    page("/terms", 0.2, "yearly"),
    page("/privacy", 0.2, "yearly"),
    ...designs
      .filter((d) => d.status !== "unavailable")
      .map((d) => {
        const images = [...(d.photos ?? []), d.assets.palm_photo, d.assets.back_photo].filter((x): x is string => !!x).map(abs);
        const vid = youTubeId(d.video_url);
        return {
          url: abs(`/designs/${d.slug}`),
          changeFrequency: "weekly" as const,
          priority: d.featured ? 0.85 : 0.75,
          images: images.length ? images : designImage(d) ? [abs(designImage(d)!)] : undefined,
          videos: vid
            ? [{ title: `${d.name} — mehndi design video`, thumbnail_loc: youTubeThumb(vid), description: designDescription(d), player_loc: `https://www.youtube.com/embed/${vid}` }]
            : undefined,
        };
      }),
    ...artists
      .filter((a) => !a.is_demo)
      .map((a) => ({
        url: abs(`/artists/${a.slug}`),
        changeFrequency: "weekly" as const,
        priority: 0.7,
        images: [a.photo_url, ...a.portfolio.map((p) => p.image_url)].filter((x): x is string => !!x && !x.endsWith(".svg")).map(abs),
      })),
  ];
}
