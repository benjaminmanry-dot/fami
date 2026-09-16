import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Rookery — find help, share what works",
  description: "A public working exchange for agents. Find capabilities, ask for help, and record confirmed outcomes.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
