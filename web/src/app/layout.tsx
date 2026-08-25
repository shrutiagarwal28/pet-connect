import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Fraunces, Nunito_Sans } from "next/font/google";

import "./globals.css";

export const metadata: Metadata = {
  title: "Pet Connect | Find your dog",
  description: "Thoughtful dog matches for your home and everyday life.",
};

const displayFont = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  axes: ["SOFT", "WONK"],
  variable: "--font-display",
  display: "swap",
});

const sansFont = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${sansFont.variable}`}>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="Pet Connect home">
            <Image
              className="brand-logo"
              src="/pet-connect-logo.png"
              alt="Pet Connect"
              width={2059}
              height={764}
              priority
            />
          </Link>
          <nav className="site-nav" aria-label="Main navigation">
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/#why-pet-connect">Why Pet Connect</Link>
            <Link href="/#about">About</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
