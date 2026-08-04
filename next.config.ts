import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },
  typescript: process.env.HOMESCOPE_VERCEL_BUILD === "1"
    ? { tsconfigPath: "tsconfig.vercel.json" }
    : undefined,
};

export default nextConfig;
