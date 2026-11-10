import type { NextConfig } from "next";
import { createHash } from "node:crypto";

// The deployed build's id, hashed (no commit or deployment name is shown),
// built into the page and the server alike, so a page can tell a deploy that
// landed before its first version check. Empty when the build can't tell
// (local builds): the server then falls back to .next/BUILD_ID and the page
// to its first check. Same inputs and order as src/lib/buildStamp.server.ts.
const buildRaw = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_DEPLOYMENT_ID || '';
const buildStamp = buildRaw ? createHash('sha256').update(buildRaw).digest('hex').slice(0, 16) : '';

// Conservative browser hardening for the website. The Pi station endpoints
// (/api/print-stations/*) are excluded so their responses stay byte-for-byte
// as they were. No enforcing CSP: the app relies on WASM (ZPL preview), a
// pdf.js module worker, inline scripts in the sheet print tab and the local
// Dazzle bridge on localhost, so the policy below only reports.
const reportOnlyCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' http://localhost:29100 http://127.0.0.1:29100",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Violations are logged (trimmed, rate-limited) by /api/csp-report.
  "report-uri /api/csp-report",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // WebUSB printing must keep working on this origin.
  { key: 'Permissions-Policy', value: 'usb=(self), camera=(), microphone=(), geolocation=(), payment=(), browsing-topics=()' },
  { key: 'Content-Security-Policy-Report-Only', value: reportOnlyCsp },
];

const nextConfig: NextConfig = {
  turbopack: {},
  env: { LW_BUILD_STAMP: buildStamp },
  outputFileTracingIncludes: { '/api/**': ['./assets/thermal-fonts/*.ttf', './scripts/thermal/fixtures/Lemon-Cherry-Gelato-Your-Edits.label.json'] },
  transpilePackages: ['pdfjs-dist'],
  async headers() {
    return [{ source: '/((?!api/print-stations).*)', headers: securityHeaders }];
  },
};

export default nextConfig;
