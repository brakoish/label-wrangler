import type { Metadata } from "next";
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