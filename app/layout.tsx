import type { Metadata } from "next";

// @phase TQ-11 — deterministic product metadata without remote font dependencies.
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
