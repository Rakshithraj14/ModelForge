import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const cabinet = localFont({
  src: [
    { path: "./fonts/CabinetGrotesk-Medium.woff2", weight: "500" },
    { path: "./fonts/CabinetGrotesk-Bold.woff2", weight: "700" },
    { path: "./fonts/CabinetGrotesk-Extrabold.woff2", weight: "800" },
  ],
  variable: "--font-cabinet",
  display: "swap",
});

const satoshi = localFont({
  src: [
    { path: "./fonts/Satoshi-Regular.woff2", weight: "400" },
    { path: "./fonts/Satoshi-Medium.woff2", weight: "500" },
    { path: "./fonts/Satoshi-Bold.woff2", weight: "700" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ModelForge | Model Doctor",
  description: "Health monitoring for the fraud-detector model: data quality, drift, performance and alerts.",
};

// Runs before first paint: applies a saved theme (no light flash for dark-mode users) and
// flags the once-per-session brand intro, skipped entirely under reduced motion.
const headScript = `try{var r=document.documentElement,t=localStorage.getItem("mf-theme");if(t==="light"||t==="dark")r.dataset.theme=t;if(!sessionStorage.getItem("mf-intro")&&!matchMedia("(prefers-reduced-motion: reduce)").matches)r.dataset.intro="1"}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${cabinet.variable} ${satoshi.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: headScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
