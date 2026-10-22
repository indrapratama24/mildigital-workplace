import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

const TITLE = "MIL Digital Workplace | A Better Way of Working";
const DESCRIPTION = "One connected workspace for everyone at MIL Digital. Bringing clarity to work planning, team collaboration, and everyday operations.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || "https://workplace.mildigital.id"),
  title: { default: TITLE, template: "%s · MIL Digital Workplace" },
  description: DESCRIPTION,
  applicationName: "MIL Digital Workplace",
  // Link previews (WhatsApp, Slack, LinkedIn…) use the team photo.
  openGraph: {
    type: "website",
    siteName: "MIL Digital Workplace",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    locale: "id_ID",
    images: [{ url: "/og/team.jpg", width: 1200, height: 630, alt: "The MIL Digital team together outdoors" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og/team.jpg"] },
  // Internal tool: keep it out of search results (link previews still work).
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f4f7fc", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Product Sans is proprietary; Google Sans (its successor) is the web fallback. SF Pro comes from the OS on Apple devices. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-sans)" } }} />
      </body>
    </html>
  );
}
