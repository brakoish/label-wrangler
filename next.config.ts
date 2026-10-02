import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  outputFileTracingIncludes: { '/api/**': ['./assets/thermal-fonts/*.ttf', './scripts/thermal/fixtures/Lemon-Cherry-Gelato-Your-Edits.label.json'] },
  transpilePackages: ['pdfjs-dist'],
};

export default nextConfig;
