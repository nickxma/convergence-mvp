import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/react";

// Injected before hydration to prevent flash of unstyled content (FOUC).
// Reads localStorage first, then falls back to OS preference.
const themeScript = `(function(){try{var s=localStorage.getItem('theme');var d=s==='dark'||(s===null&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Convergence — Ask anything about mindfulness",
  description:
    "AI-powered Q&A grounded in 760+ hours of guided meditations, teachings, and conversations from leading mindfulness teachers. By Paradox of Acceptance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium"
            style={{ background: 'var(--sage)', color: '#fff' } as React.CSSProperties}
          >
            Skip to main content
          </a>
          <Providers>{children}</Providers>
          <Analytics />
        </body>
    </html>
  );
}
