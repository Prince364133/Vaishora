import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "VAISHORA — Mehndi artists in Hyderabad, booked online", template: "%s · VAISHORA" },
  description:
    "Explore mehndi designs on an interactive 3D hand, see transparent prices and book a mehndi artist at home in Hyderabad.",
  applicationName: "VAISHORA",
  keywords: ["mehndi artist Hyderabad", "mehndi designs", "bridal mehndi", "henna artist at home", "Arabic mehndi", "mehndi booking"],
  category: "beauty",
  openGraph: { siteName: "VAISHORA", locale: "en_IN", type: "website" },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#4b1d3f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={`${cormorant.variable} ${manrope.variable}`}>
      <body className="min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
