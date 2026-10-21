import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MIL Digital Workplace", template: "%s · MIL Digital Workplace" },
  description: "MIL Digital's internal platform: company hub, team and client directory, work plans, leave, approvals and internal events in one place.",
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
