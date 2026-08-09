import type { Metadata } from "next";

// @phase TQ-01 — product metadata and Indonesian document shell.
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Taysriul Qur'ani — Studio Video Al-Qur'an",
  description:
    "Ruang produksi untuk mencocokkan audio bacaan dengan ayat, menata Mushaf Madinah, terjemahan, tafsir, dan video Qur'an.",
  applicationName: "Taysriul Qur'ani",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
