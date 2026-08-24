import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "Pet Connect | Find your dog",
  description: "Thoughtful dog matches for your home and everyday life.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="Pet Connect home">
            <span className="brand-mark" aria-hidden="true">♥</span>
            Pet Connect
          </Link>
          <span className="header-note">Good dogs. Thoughtful matches.</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

