import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "セキュリティ診断ツール (by Abeam Tech)",
  description: "SSL・セキュリティヘッダー・WordPress/CMS・公開情報・フォーム保護をまとめて診断するチェックツールです。",
};

export default function SecurityCheckerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
