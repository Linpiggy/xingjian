import type { NextConfig } from "next";

const config: NextConfig = {
  distDir: process.env.TRAVEL_E2E === "1" ? ".next-e2e" : ".next",
  poweredByHeader: false,
  reactStrictMode: true,
};
export default config;
