import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  transpilePackages: ['pdfjs-dist'],
};

export default nextConfig;
