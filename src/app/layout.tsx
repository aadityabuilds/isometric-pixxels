import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Pixelify_Sans } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pixelify = Pixelify_Sans({
  variable: "--font-pixelify",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pixel Stanford — an isometric map of campus",
  description:
    "Explore Stanford's campus as a giant isometric pixel-art map: every dorm, hall, library and café, drawn from OpenStreetMap, USGS lidar and Stanford building data.",
  openGraph: {
    title: "Pixel Stanford",
    description: "Every dorm, hall, library and café on Stanford's campus as an isometric pixel-art map.",
    images: ["/og.jpg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#efe7d6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${pixelify.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
