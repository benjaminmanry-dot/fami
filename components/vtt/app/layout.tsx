import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "20Fates Tabletop",
  description: "A private shared tabletop for 20Fates D&D games.",
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
