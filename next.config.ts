import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.TRAVEL_E2E === "1" ? ".next-e2e" : ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  // Bound build worker memory on the local Windows host; do not skip build checks.
  experimental: {
    cpus: 2,
  },
};
export default config;
