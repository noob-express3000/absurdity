import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Absurdity — The world's strange stories, already sorted",
  description:
    "A global strange-news reader with source links, favorites, permanent history and hands-free narration.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
