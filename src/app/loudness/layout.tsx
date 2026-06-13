import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ラウドネス | Abeam Tech Tools",
  description: "動画や音声ファイルのラウドネスをブラウザ内で解析し、YouTube/TikTokなどに合わせて音量を最適化します。",
};

export default function LoudnessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
