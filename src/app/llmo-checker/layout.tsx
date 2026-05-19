import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LLMOチェッカー (by Abeam Tech)",
  description: "SEO・OGP・構造化データ・MEO・LLMOをまとめて診断するチェックツールです。",
};

export default function LlmoCheckerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
