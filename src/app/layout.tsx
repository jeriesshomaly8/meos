import type { Metadata, Viewport } from "next";
import { Fraunces, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

/**
 * The only imported face, and only for display sizes — body text stays on the
 * platform font so the app feels native rather than webby. Loaded as a
 * variable font (weight axis only) to keep the payload small.
 */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MeOS",
    template: "%s · MeOS",
  },
  description: "Your private personal memory system.",
  applicationName: "MeOS",
  manifest: "/manifest.webmanifest",
  // iOS ignores the manifest for the home-screen icon and reads these instead.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "MeOS" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Match the paper colour so the iOS status bar and Android chrome blend
  // into the page instead of framing it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1917" },
  ],
  // Deliberately NOT disabling zoom — pinch-to-zoom is an accessibility
  // requirement, and `viewportFit` gives us the safe-area insets.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
