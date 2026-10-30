import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lumina Precinct Agent",
  description: "Verified, agentic answers about Sydney station precincts. A Dronovation Labs product.",
};

export const viewport: Viewport = { themeColor: "#f2f4f1" };

/**
 * Some form-filling browser extensions stamp `fdprocessedid` on every button and input before
 * React hydrates, which React reports as a hydration mismatch. Strip that one attribute until the
 * page has settled; nothing else is touched.
 */
const STRIP_EXTENSION_ATTRS = `(()=>{const a='fdprocessedid',s=()=>document.querySelectorAll('['+a+']').forEach(e=>e.removeAttribute(a));const o=new MutationObserver(m=>{for(const r of m){if(r.type==='attributes'&&r.attributeName===a)r.target.removeAttribute(a);else if(r.addedNodes.length)s()}});o.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:[a]});addEventListener('load',()=>{s();setTimeout(()=>o.disconnect(),10000)})})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: STRIP_EXTENSION_ATTRS }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&display=swap" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
