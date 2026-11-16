import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      // Each map build writes tiles into a new versioned folder, so they never change in place.
      { source: "/tiles/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/places/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
      { source: "/sprites/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
      { source: "/data/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=600, stale-while-revalidate=86400" }] },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
