import type { NextConfig } from "next";

const config: NextConfig = {
  // E2E 使用独立构建目录，可与本地 dev 服务器并行运行
  distDir: process.env.TRAVEL_E2E === "1" ? ".next-e2e" : ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  images: {
    // 高德 POI 实景图
    remotePatterns: [{ protocol: "https", hostname: "store.is.autonavi.com" }],
  },
  experimental: {
    // 限制本机构建并发，避免 Windows 上内存占用过高
    cpus: 2,
  },
};

export default config;
