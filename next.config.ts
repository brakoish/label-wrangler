import type { NextConfig } from "next";

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
  outputFileTracingIncludes: { '/api/**': ['./assets/thermal-fonts/*.ttf', './scripts/thermal/fixtures/Lemon-Cherry-Gelato-Your-Edits.label.json'] },
  transpilePackages: ['pdfjs-dist'],
  async headers() {
    return [{ source: '/((?!api/print-stations).*)', headers: securityHeaders }];
  },
};

export default nextConfig;
