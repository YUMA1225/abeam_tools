import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "セキュリティ診断ツール (by Abeam Tech)",
  description: "GET・HEAD・OPTIONSの安全メソッドだけで、HTTPS・ヘッダー・CMS・公開情報・JavaScript・フォーム保護を簡易診断するツールです。",
};

export default function SecurityCheckerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
