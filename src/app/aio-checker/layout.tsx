import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AIOチェッカー (by Abeam Tech)",
  description: "SEO・OGP・構造化データ・MEO・AIOをまとめて診断するチェックツールです。",
};

export default function AioCheckerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
