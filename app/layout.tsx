import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Absurdity — Autonomous Global Absurdity Desk",
  description: "A researched global briefing of the genuinely extraordinary.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
