import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Condensed } from "next/font/google";
import "./globals.css";
import { StoreHydrator } from "@/components/StoreHydrator";
import { FeedbackHost } from "@/components/ui/feedback";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Zebra Font 0 (what native thermal labels print in) is a bold condensed
// sans. The designer canvas draws thermal text in this face so it looks like
// the printout. Not preloaded: only the designer uses it.
const zebraFace = Roboto_Condensed({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-zebra",
  preload: false,
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
      <body className={`${inter.variable} ${zebraFace.variable} font-sans antialiased`}>
        <StoreHydrator>{children}</StoreHydrator>
        <FeedbackHost />
      </body>
    </html>
  );
}