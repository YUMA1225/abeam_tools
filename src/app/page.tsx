import Link from "next/link";

const tools = [
  {
    name: "LLMOチェッカー",
    href: "/llmo-checker",
    description: "SEO・OGP・構造化データ・MEO・LLMOをまとめて診断します。",
    status: "公開準備中",
  },
  {
    name: "セキュリティ診断ツール",
    href: "/security-checker",
    description: "GET・HEAD・OPTIONSの安全メソッドだけで、HTTPS・ヘッダー・CMS・公開情報・クライアントコードを簡易診断します。",
    status: "公開準備中",
  },
  {
    name: "PDF分割ツール",
    href: "/pdf-splitter",
    description: "PDFを1ページごと、またはプレビューを見ながら指定位置で分割します。",
    status: "ブラウザ内処理",
  },
  {
    name: "PDF結合ツール",
    href: "/pdf-merger",
    description: "複数PDFを並べ替え、ページ範囲や回転を指定して1つのPDFに結合します。",
    status: "ブラウザ内処理",
  },
  {
    name: "Markdown表 → Excel変換",
    href: "/markdown-table-converter",
    description: "Markdown形式の表をExcelやスプレッドシートへ貼り付けやすい形式に変換します。",
    status: "ブラウザ内処理",
  },
];

export default function ToolsHome() {
  return (
    <main className="min-h-dvh bg-[#f3f6fb] text-[#172033]">
      <header className="border-b border-slate-100 bg-white px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-600">Abeam Tech Tools</p>
            <h1 className="mt-2 text-2xl font-black tracking-normal">ツール一覧</h1>
          </div>
          <span className="rounded-full bg-gradient-to-r from-purple-700 via-indigo-600 to-cyan-500 px-3 py-1 text-xs font-black text-white shadow-sm">
            tools.abeam.tech
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-purple-700 via-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-900/20">
                  {tool.href === "/pdf-splitter" ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="7" r="3" />
                      <circle cx="6" cy="17" r="3" />
                      <path d="M8.6 8.6 19 19" />
                      <path d="M8.6 15.4 19 5" />
                    </svg>
                  ) : tool.href === "/pdf-merger" ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 4v16" />
                      <path d="M17 4v16" />
                      <path d="M7 8h4a4 4 0 0 1 4 4 4 4 0 0 0 4 4h-2" />
                      <path d="m17 13 3 3-3 3" />
                    </svg>
                  ) : tool.href === "/markdown-table-converter" ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <path d="M3 10h18M9 4v16" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                  )}
                </div>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700">{tool.status}</span>
              </div>
              <h2 className="mt-5 text-lg font-black tracking-normal text-slate-900">{tool.name}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{tool.description}</p>
              <p className="mt-5 text-sm font-black text-indigo-600 transition group-hover:text-purple-700">開く →</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
