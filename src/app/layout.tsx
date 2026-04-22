import type { Metadata, Viewport } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { StoreHydrator } from "@/components/StoreHydrator";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// IBM Plex Mono approximates Zebra Font 0's clean monospace thermal look.
// Used only in the SVG designer preview for thermal labels so what you see
// in the canvas is close to what ZPL will print.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Label Wrangler",
  description: "Label format library and designer",
};

// Mobile-friendly viewport so phone browsers don't render the desktop
// breakpoints zoomed out to fit. themeColor matches our dark background
// so the status bar on iOS/Android blends in instead of flashing white.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 2,
  themeColor: "#0c0c0e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${plexMono.variable} font-sans antialiased`}>
        <StoreHydrator>{children}</StoreHydrator>
      </body>
    </html>
  );
}