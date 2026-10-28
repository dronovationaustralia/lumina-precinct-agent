import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumina Precinct Agent",
  description: "Verified, agentic answers about Sydney station precincts. A Dronovation Labs product.",
};

export const viewport: Viewport = { themeColor: "#f2f4f1" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&display=swap" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
