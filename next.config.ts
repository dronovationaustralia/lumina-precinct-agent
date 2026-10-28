import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // WASM and native database packages load at runtime on the server, not bundled.
  serverExternalPackages: ['@electric-sql/pglite', '@electric-sql/pglite-postgis', 'libpg-query', 'pg'],
  outputFileTracingIncludes: { '/api/**': ['./db/schema.sql'] },
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
