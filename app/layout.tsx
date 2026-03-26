import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Analytics } from "@vercel/analytics/react";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://convergence-mvp.vercel.app';

export const metadata: Metadata = {
  title: {
    default: "Convergence — Ask anything about mindfulness",
    template: "%s — Convergence",
  },
  description:
    "AI-powered Q&A grounded in hundreds of hours of guided meditations, teachings, and conversations from leading mindfulness teachers and practitioners.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    siteName: "Convergence",
    type: "website",
    title: "Convergence — Ask anything about mindfulness",
    description:
      "AI-powered Q&A grounded in hundreds of hours of guided meditations, teachings, and conversations from leading mindfulness teachers and practitioners.",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "Convergence — Ask anything about mindfulness",
    description:
      "AI-powered Q&A grounded in hundreds of hours of guided meditations, teachings, and conversations from leading mindfulness teachers and practitioners.",
  },
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
      <body className="min-h-full flex flex-col">
          <Providers>{children}</Providers>
          <Analytics />
        </body>
    </html>
  );
}
