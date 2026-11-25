import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" }, // location: "use my current location" when adding an address,
];

const nextConfig: NextConfig = {
  // Allows a second, isolated dev/build output (e.g. NEXT_DIST_DIR=.next-alt) alongside another dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  // Artist portal uploads several (browser-compressed) photos per design in one server action.
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  partialPrefetching: true,
  // PGlite ships WASM + data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Artists sign in from the website; the old portal login address keeps working for earlier emails
  // (the original query, e.g. ?applied=1, is carried over).
  async redirects() {
    return [{ source: "/artist-portal/login", destination: "/account?artist=1", permanent: false }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/models/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/designs/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};

export default nextConfig;
