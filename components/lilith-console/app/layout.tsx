import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lilith • Iridescent Rampage",
  description: "Lilith's illustrated offline-first 2024 D&D character sheet and Roll20 console.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
