import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Abeam Tech Tools",
  description: "Abeam Techが提供するWebツール一覧です。",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
