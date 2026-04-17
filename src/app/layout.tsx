import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { StoreHydrator } from "@/components/StoreHydrator";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
      <body className={`${inter.variable} font-sans antialiased`}>
        <StoreHydrator>{children}</StoreHydrator>
      </body>
    </html>
  );
}