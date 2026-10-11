import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Absurdity — The world's strange stories, already sorted",
  description:
    "A global strange-news reader with source links, favorites, permanent history and hands-free narration.",
};

export const viewport: Viewport = {
  themeColor: "#f2f2f2",
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
