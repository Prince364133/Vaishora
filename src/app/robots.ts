import type { MetadataRoute } from "next";
import { siteUrl } from "@/server/env";

// Public pages are crawlable; private areas (admin, artist portal, account, bookings, checkout, APIs) are not.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/designs/", "/artists/", "/uploads/", "/tryon/", "/designs/photo/"],
        disallow: ["/admin", "/artist-portal", "/api/", "/account", "/booking", "/book/", "/oauth/", "/review/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
