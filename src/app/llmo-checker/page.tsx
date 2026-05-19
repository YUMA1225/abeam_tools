"use client";

import { useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { AnalyzeResponse, CheckStatus, SeoCategory, SeoCategoryKey, SeoCheck, SeoReport } from "../../lib/seo-types";

const sampleUrl = "https://abeam.tech/kanagawa-seo-llmo/";
const categoryOrder: SeoCategoryKey[] = ["basic", "technical", "ogp", "structured", "meo", "llmo"];

const categoryShortLabel: Record<SeoCategoryKey, string> = {
  basic: "SEO",
  technical: "TECH",
  ogp: "SNS",
  structured: "DATA",
  meo: "MEO",
  llmo: "LLMO",
};

const categoryIcon: Record<SeoCategoryKey, ReactNode> = {
  basic: <FileTextIcon />,
  technical: <SettingsIcon />,
  ogp: <MegaphoneIcon />,
  structured: <NodesIcon />,
  meo: <MapPinIcon />,
  llmo: <BotIcon />,
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<SeoReport | null>(null);
  const [activeKey, setActiveKey] = useState<SeoCategoryKey>("basic");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const activeCategory = useMemo(() => {
    return report?.categories.find((category) => category.key === activeKey) ?? report?.categories[0] ?? null;
  }, [activeKey, report]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setCopied(false);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json()) as AnalyzeResponse;
      if (!payload.ok) {
        setError(payload.error);
        setReport(null);
        return;
      }
      setReport(payload.report);
      setActiveKey("basic");
    } catch {
      setError("診断に失敗しました。時間を置いて再度お試しください。");
      setReport(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function copyReport() {
    if (!report) return;
    await navigator.clipboard.writeText(formatReport(report));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="min-h-dvh bg-[#f3f6fb] text-[#172033]">
      <Header />

      <section className="border-b border-slate-100 bg-white px-6 py-5">
        <form onSubmit={handleSubmit} className="flex max-w-[860px] gap-3">
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
            className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-[15px] shadow-inner outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-700 via-indigo-600 to-cyan-500 px-8 text-sm font-bold text-white shadow-md shadow-indigo-900/20 transition hover:brightness-105 disabled:cursor-wait disabled:opacity-60"
          >
            <SearchIcon className="size-4" />
            診断スタート
          </button>
        </form>
        <div className="mt-3 max-w-[860px] space-y-2 text-xs text-slate-500">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <BoltIcon className="size-3.5 text-indigo-500" />
            <span>CORSプロキシ経由でページを取得します。プライベートな内部URLは使用できません。</span>
            <span>|</span>
            <button type="button" onClick={() => setUrl(sampleUrl)} className="text-teal-600 underline underline-offset-2">
              サンプルURLで試す
            </button>
          </p>
          <p>※ HTMLの静的解析による簡易チェッカーです。ページ速度・被リンク等は対象外となります。</p>
        </div>
      </section>

      <section className="px-6 py-6">
        {!report && !isLoading && !error && <InitialState />}
        {isLoading && <LoadingState />}
        {error && <ErrorState message={error} />}
        {report && activeCategory && (
          <Report
            report={report}
            activeCategory={activeCategory}
            activeKey={activeKey}
            onTabChange={setActiveKey}
            onCopy={copyReport}
            copied={copied}
          />
        )}
      </section>
    </main>
  );
}

function Header() {
  return (
    <header className="flex h-[76px] items-center justify-between border-b border-slate-100 bg-white px-6">
      <div className="flex items-center gap-4">
        <div className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-purple-700 via-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-900/20">
          <SearchIcon className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-black tracking-normal">LLMOチェッカー</h1>
          <p className="mt-1 text-xs text-slate-500">by Abeam Tech・SEO/OGP/構造化データ/MEO/LLMOを診断</p>
        </div>
      </div>
      <span className="rounded-full bg-gradient-to-r from-purple-700 via-indigo-600 to-cyan-500 px-3 py-1 text-xs font-black text-white shadow-sm">v2.0</span>
    </header>
  );
}

function InitialState() {
  return (
    <div className="flex min-h-[calc(100dvh-205px)] items-center justify-center text-center">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center">
        <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200">
          <SearchIcon className="size-8" />
        </div>
        <h2 className="mt-7 text-2xl font-black tracking-normal">URLを入力して診断開始</h2>
        <p className="mx-auto mt-5 text-sm leading-7 text-slate-500">
          WebページのSEO・OGP・構造化データ・MEO・LLMOを
          <br />
          まとめて自動チェックします。
        </p>
        <div className="mx-auto mt-8 flex w-full max-w-4xl flex-wrap items-center justify-center gap-3">
          {categoryOrder.map((key) => (
            <span
              key={key}
              className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-[0_2px_7px_rgba(15,23,42,0.10)]"
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center text-indigo-600">{categoryIcon[key]}</span>
              {labelFor(key)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid min-h-[470px] place-items-center text-center">
      <div>
        <div className="mx-auto size-11 animate-spin rounded-full border-4 border-slate-200 border-t-teal-400" />
        <p className="mt-5 font-bold">診断中...</p>
        <p className="mt-4 text-sm text-slate-500">ページを取得しています...</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="mx-auto mt-12 max-w-3xl rounded-2xl border border-red-100 bg-white p-6 text-red-900 shadow-sm">
      <p className="font-black">診断できませんでした</p>
      <p className="mt-2 text-sm">{message}</p>
    </div>
  );
}

function Report({
  report,
  activeCategory,
  activeKey,
  onTabChange,
  onCopy,
  copied,
}: {
  report: SeoReport;
  activeCategory: SeoCategory;
  activeKey: SeoCategoryKey;
  onTabChange: (key: SeoCategoryKey) => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const sorted = report.categories.slice().sort((a, b) => categoryOrder.indexOf(a.key) - categoryOrder.indexOf(b.key));
  const totalChecks = sorted.reduce((sum, category) => sum + category.checks.length, 0);

  return (
    <div className="mx-auto max-w-[1152px] space-y-5">
      <div className="flex min-h-16 items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 shadow-sm">
        <p className="text-sm text-slate-600">
          診断URL: <strong className="break-all text-slate-900">{report.finalUrl}</strong>
        </p>
        <div className="flex items-center gap-4">
          <time className="text-xs text-slate-400">{new Date(report.checkedAt).toLocaleString("ja-JP")}</time>
          <button
            type="button"
            onClick={() => exportReportPdf(report)}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-700 via-indigo-600 to-cyan-500 px-4 py-2 text-sm font-bold text-white shadow-md shadow-indigo-900/20"
          >
            <PrinterIcon className="size-4" />
            PDFで保存
          </button>
          <button type="button" onClick={onCopy} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm">
            <CopyIcon className="size-4 text-indigo-600" />
            {copied ? "コピー済み" : "クリップボードにコピー"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-7">
        {sorted.map((category) => (
          <ScoreCard key={category.key} category={category} />
        ))}
        <ScoreCard
          category={{
            key: "basic",
            label: "総合スコア",
            score: report.score,
            summary: `全${totalChecks}項目`,
            checks: [],
          }}
          totalLabel={`全${totalChecks}項目`}
          highlighted
        />
      </div>

      <div className="flex gap-5 overflow-x-auto border-b border-slate-200 pb-2">
        {sorted.map((category) => {
          const counts = countStatuses(category.checks);
          const badge = counts.fail > 0 ? `×${counts.fail}` : counts.warn > 0 ? `!${counts.warn}` : "✓";
          return (
            <button
              type="button"
              key={category.key}
              onClick={() => onTabChange(category.key)}
              className={`min-w-fit border-b-2 px-4 py-3 text-sm font-bold transition ${
                activeKey === category.key ? "border-amber-400 text-slate-900" : "border-transparent text-slate-500"
              }`}
            >
              <span className="inline-flex size-4 align-[-2px] text-indigo-600">{categoryIcon[category.key]}</span> {category.label} <span className={badgeClass(counts)}>{badge}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        {activeCategory.checks.map((check) => (
          <CheckCard key={check.id} check={check} />
        ))}
      </div>
    </div>
  );
}

function ScoreCard({
  category,
  totalLabel,
  highlighted,
}: {
  category: SeoCategory;
  totalLabel?: string;
  highlighted?: boolean;
}) {
  const counts = countStatuses(category.checks);
  return (
    <div className={`rounded-2xl border bg-white p-4 text-center shadow-sm ${highlighted ? scoreBorderClass(category.score) : "border-slate-200"}`}>
      <ScoreGauge score={category.score} />
      <p className="mt-3 text-xs font-semibold text-slate-500">
        {highlighted ? "総合スコア" : (
          <span className="inline-flex items-center justify-center gap-1">
            <span className="inline-flex size-3.5 text-indigo-600">{categoryIcon[category.key]}</span>
            {category.label}
          </span>
        )}
      </p>
      <p className={`mt-1 text-base font-black ${scoreTextClass(category.score)}`}>{category.score}点</p>
      <p className="mt-1 text-[11px] text-slate-500">
        {totalLabel || `✓${counts.pass} !${counts.warn} ×${counts.fail}`}
      </p>
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);

  return (
    <div className="relative mx-auto size-16">
      <svg viewBox="0 0 64 64" className="-rotate-90">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="#e8edf5"
          strokeWidth="6"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={scoreTextClass(score)}
        />
      </svg>
      <span className={`absolute inset-0 grid place-items-center text-sm font-black ${scoreTextClass(score)}`}>
        {score}
      </span>
    </div>
  );
}

function CheckCard({ check }: { check: SeoCheck }) {
  const good = check.status === "pass";
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex gap-4">
        <div className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-black ${statusPillClass(check.status)}`}>
          {statusMark(check.status)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-black tracking-normal">{check.label}</h3>
          <p className="mt-2 text-sm text-slate-600">{check.detail}</p>
          {check.value && (
            <div className="mt-4 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-700">
              {check.value}
            </div>
          )}
          {good ? (
            <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
              ✓ 適切に設定されています。
            </div>
          ) : (
            check.recommendation && (
              <div className="mt-4 rounded-md border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <span className="inline-flex items-center gap-1.5">
                  <LightbulbIcon className="size-3.5 shrink-0" />
                  {check.recommendation}
                </span>
              </div>
            )
          )}
        </div>
      </div>
    </article>
  );
}

function countStatuses(checks: SeoCheck[]) {
  return checks.reduce(
    (sum, check) => {
      if (check.status === "pass") sum.pass += 1;
      if (check.status === "warn") sum.warn += 1;
      if (check.status === "fail") sum.fail += 1;
      if (check.status === "info") sum.info += 1;
      return sum;
    },
    { pass: 0, warn: 0, fail: 0, info: 0 },
  );
}

function labelFor(key: SeoCategoryKey) {
  if (key === "basic") return "SEO基本";
  if (key === "technical") return "テクニカルSEO";
  if (key === "ogp") return "OGP / SNS";
  if (key === "structured") return "構造化データ";
  if (key === "meo") return "MEO（ローカルSEO）";
  return "LLMO（AI最適化）";
}

function statusMark(status: CheckStatus) {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  if (status === "fail") return "✗";
  return "i";
}

function statusReportMark(status: CheckStatus) {
  if (status === "pass") return "[✓]";
  if (status === "warn") return "[!]";
  if (status === "fail") return "[✗]";
  return "[i]";
}

function statusPillClass(status: CheckStatus) {
  if (status === "pass") return "bg-emerald-50 text-emerald-700";
  if (status === "warn") return "bg-amber-50 text-amber-700";
  if (status === "fail") return "bg-red-50 text-red-700";
  return "bg-sky-50 text-sky-700";
}

function badgeClass(counts: ReturnType<typeof countStatuses>) {
  if (counts.fail > 0) return "ml-2 text-red-500";
  if (counts.warn > 0) return "ml-2 text-amber-600";
  return "ml-2 text-emerald-600";
}

function scoreTextClass(score: number) {
  if (score >= 80) return "text-emerald-700";
  if (score >= 50) return "text-amber-700";
  return "text-red-700";
}

function scoreBorderClass(score: number) {
  if (score >= 80) return "border-emerald-600";
  if (score >= 50) return "border-amber-500";
  return "border-red-500";
}

function formatReport(report: SeoReport): string {
  const lines = [
    "■ LLMOチェッカー診断レポート",
    `URL: ${report.finalUrl}`,
    `診断日時: ${new Date(report.checkedAt).toLocaleString("ja-JP")}`,
    "────────────────────────────────",
    "",
  ];

  for (const category of report.categories.slice().sort((a, b) => categoryOrder.indexOf(a.key) - categoryOrder.indexOf(b.key))) {
    lines.push(`${category.label}  [${category.score}点]`);
    for (const check of category.checks) {
      lines.push(`  ${statusReportMark(check.status)} ${check.label}`);
      lines.push(`      → ${check.detail}`);
      if (check.value) lines.push(`      ${check.value.replace(/\n/g, "\n      ")}`);
      if (check.recommendation && check.status !== "pass") lines.push(`      改善: ${check.recommendation}`);
    }
    lines.push("");
  }

  lines.push("────────────────────────────────");
  lines.push(`総合スコア: ${report.score}点`);
  return lines.join("\n");
}

function exportReportPdf(report: SeoReport) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";

  document.body.appendChild(iframe);

  const iframeWindow = iframe.contentWindow;
  const iframeDocument = iframe.contentDocument ?? iframeWindow?.document;
  if (!iframeWindow || !iframeDocument) {
    iframe.remove();
    return;
  }

  iframeDocument.open();
  iframeDocument.write(buildReportHtml(report));
  iframeDocument.close();

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 500);
  };

  iframeWindow.onafterprint = cleanup;
  iframe.onload = () => {
    iframeWindow.focus();
    iframeWindow.print();
    window.setTimeout(cleanup, 2000);
  };
}

function buildReportHtml(report: SeoReport) {
  const sorted = report.categories.slice().sort((a, b) => categoryOrder.indexOf(a.key) - categoryOrder.indexOf(b.key));
  const totalChecks = sorted.reduce((sum, category) => sum + category.checks.length, 0);
  const categorySummary = sorted
    .map((category) => {
      const counts = countStatuses(category.checks);
      return `
        <section class="score-card">
          ${pdfGauge(category.score)}
          <div class="score-label">${escapeHtml(categoryShortLabel[category.key])} ${escapeHtml(category.label)}</div>
          <div class="score-points ${scoreClassName(category.score)}">${category.score}点</div>
          <div class="score-counts"><span class="ok-text">✓${counts.pass}</span> <span class="warn-text">!${counts.warn}</span> <span class="bad-text">×${counts.fail}</span></div>
        </section>
      `;
    })
    .join("");

  const totalSummary = `
    <section class="score-card total-card">
      ${pdfGauge(report.score)}
      <div class="score-label">総合スコア</div>
      <div class="score-points ${scoreClassName(report.score)}">${report.score}点</div>
      <div class="score-counts">全${totalChecks}項目</div>
    </section>
  `;

  const categoryDetails = sorted
    .map((category) => {
      const checks = category.checks
        .map((check) => {
          const value = shouldShowPdfValue(check) ? `<pre>${escapeHtml(shortenPdfValue(check.value ?? ""))}</pre>` : "";
          const recommendation =
            check.recommendation && check.status !== "pass"
              ? `<div class="hint"><span class="hint-icon">i</span> ${escapeHtml(check.recommendation)}</div>`
              : check.status === "pass"
                ? `<div class="ok">✓ 適切に設定されています。</div>`
                : "";
          return `
            <article class="check">
              <div class="mark ${check.status}">${escapeHtml(statusMark(check.status))}</div>
              <div>
                <h3>${escapeHtml(check.label)}</h3>
                <p class="detail">${escapeHtml(check.detail)}</p>
                ${value}
                ${recommendation}
              </div>
            </article>
          `;
        })
        .join("");

      return `
        <section class="category">
          <div class="category-head">
            <h2><span>${escapeHtml(categoryShortLabel[category.key])}</span> ${escapeHtml(category.label)}</h2>
          </div>
          ${checks}
        </section>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>LLMOチェッカー診断レポート - ${escapeHtml(report.finalUrl)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #172033;
      background: #f6f8fc;
      font-family: Arial, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
      font-size: 13px;
      line-height: 1.55;
    }
    .page {
      background: #fff;
      min-height: 100vh;
      padding: 22px;
    }
    header {
      position: relative;
      overflow: hidden;
      border-radius: 22px;
      padding: 24px;
      margin-bottom: 18px;
      background: linear-gradient(135deg, #6d28d9 0%, #4f46e5 52%, #06b6d4 100%);
      color: white;
      box-shadow: 0 18px 42px rgba(15, 23, 42, 0.18);
    }
    header:after {
      content: "";
      position: absolute;
      right: -60px;
      top: -90px;
      width: 260px;
      height: 260px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.13);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 26px;
      letter-spacing: 0;
      font-weight: 800;
    }
    .meta {
      position: relative;
      color: rgba(255, 255, 255, 0.88);
      font-size: 12px;
      word-break: break-all;
    }
    .report-kicker {
      position: relative;
      margin-bottom: 8px;
      color: #bae6fd;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .overview {
      display: grid;
      grid-template-columns: 156px 1fr;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 18px;
    }
    .total-panel,
    .url-card {
      border: 1px solid #dbe5f1;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
    }
    .total-panel {
      display: grid;
      place-items: center;
      padding: 16px;
      text-align: center;
    }
    .total-panel .total-label {
      margin-top: 6px;
      color: #64748b;
      font-size: 11px;
      font-weight: 800;
    }
    .total-panel .total-score {
      color: #b45309;
      font-size: 20px;
      font-weight: 900;
    }
    .url-card {
      display: grid;
      align-content: center;
      gap: 7px;
      padding: 18px 22px;
    }
    .url-card .url {
      word-break: break-all;
      font-size: 14px;
    }
    .url-card .date {
      color: #64748b;
      font-size: 12px;
    }
    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 24px 0 12px;
      color: #334155;
      font-size: 14px;
      font-weight: 900;
    }
    .section-title:after {
      content: "";
      height: 1px;
      flex: 1;
      background: #dbe5f1;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 8px;
      margin-bottom: 26px;
    }
    .score-card {
      min-height: 116px;
      border: 1px solid #dbe5f1;
      border-radius: 18px;
      padding: 12px 8px;
      text-align: center;
      break-inside: avoid;
      background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
    }
    .total-card {
      border: 2px solid currentColor;
      color: #b45309;
    }
    .gauge {
      position: relative;
      width: 52px;
      height: 52px;
      margin: 0 auto 8px;
    }
    .gauge svg { display: block; width: 52px; height: 52px; transform: rotate(-90deg); }
    .gauge span {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 13px;
    }
    .score-label { color: #8a97aa; font-size: 10px; font-weight: 700; }
    .score-points { margin-top: 2px; font-size: 15px; font-weight: 800; }
    .score-counts { color: #8a97aa; font-size: 10px; }
    .good { color: #17834b; }
    .mid { color: #b45309; }
    .bad { color: #dc2626; }
    .ok-text { color: #15803d; }
    .warn-text { color: #b45309; }
    .bad-text { color: #dc2626; }
    .category {
      margin-top: 26px;
    }
    .category-head {
      border-bottom: 2px solid #dbe5f1;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .category h2 {
      margin: 0;
      font-size: 15px;
      color: #415066;
      font-weight: 800;
    }
    .check {
      display: grid;
      grid-template-columns: 32px 1fr;
      gap: 12px;
      border: 1px solid #dbe5f1;
      border-radius: 16px;
      padding: 14px;
      margin-top: 6px;
      break-inside: avoid;
      background: #fff;
    }
    .mark {
      width: 24px;
      height: 24px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      font-weight: 800;
    }
    .mark.pass { background: #ecfdf3; color: #15803d; }
    .mark.warn { background: #fffbeb; color: #b45309; }
    .mark.fail { background: #fef2f2; color: #dc2626; }
    .mark.info { background: #eff6ff; color: #2563eb; }
    .check h3 { margin: 0; font-size: 14px; font-weight: 800; }
    .detail {
      margin: 2px 0 0;
      color: #273244;
      padding-bottom: 10px;
      border-bottom: 1px solid #edf2f7;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      margin: 10px 0 0;
      padding: 8px 10px;
      border: 1px solid #e5edf6;
      border-radius: 8px;
      background: #f8fafc;
      font-family: inherit;
      font-size: 10px;
      color: #334155;
    }
    .hint {
      margin-top: 10px;
      padding: 8px 10px;
      border: 1px solid #facc15;
      border-radius: 8px;
      background: #fffbeb;
      color: #b45309;
    }
    .hint-icon {
      display: inline-grid;
      place-items: center;
      width: 16px;
      height: 16px;
      border-radius: 999px;
      background: #fef3c7;
      color: #b45309;
      font-weight: 900;
      font-size: 10px;
    }
    .ok {
      margin-top: 10px;
      padding: 8px 10px;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      background: #f0fdf4;
      color: #166534;
    }
    .footer {
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px solid #dbe5f1;
      color: #94a3b8;
      font-size: 10px;
      text-align: right;
    }
  </style>
</head>
<body>
  <main class="page">
    <header>
      <div class="report-kicker">SEO AUDIT REPORT</div>
      <h1>LLMOチェッカー診断レポート</h1>
      <div class="meta">
        診断URL: ${escapeHtml(report.finalUrl)}　｜　診断日時: ${escapeHtml(new Date(report.checkedAt).toLocaleString("ja-JP"))}
      </div>
    </header>
    <section class="overview">
      <div class="total-panel">
        ${pdfGauge(report.score)}
        <div class="total-label">総合スコア</div>
        <div class="total-score">${report.score}点</div>
      </div>
      <div class="url-card">
        <div class="url">診断URL: <strong>${escapeHtml(report.finalUrl)}</strong></div>
        <div class="date">診断日時: ${escapeHtml(new Date(report.checkedAt).toLocaleString("ja-JP"))}</div>
        <div class="date">SEO基本、テクニカル、OGP/SNS、構造化データ、MEO、LLMO の全${totalChecks}項目を診断しました。</div>
      </div>
    </section>
    <div class="section-title">スコアサマリー</div>
    <section class="summary">${categorySummary}${totalSummary}</section>
    <div class="section-title">診断詳細</div>
    ${categoryDetails}
    <div class="footer">Generated by LLMOチェッカー (by Abeam Tech)</div>
  </main>
</body>
</html>`;
}

function pdfGauge(score: number) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, score)) / 100);
  const color = score >= 80 ? "#17834b" : score >= 50 ? "#b45309" : "#dc2626";
  return `
    <div class="gauge ${scoreClassName(score)}">
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <circle cx="26" cy="26" r="${radius}" fill="none" stroke="#e8edf5" stroke-width="5"></circle>
        <circle cx="26" cy="26" r="${radius}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
      </svg>
      <span>${score}</span>
    </div>
  `;
}

function shouldShowPdfValue(check: SeoCheck) {
  if (!check.value) return false;
  return !["title", "description", "h1", "image-alt"].includes(check.id);
}

function shortenPdfValue(value: string) {
  return value.length > 900 ? `${value.slice(0, 900)}\n...` : value;
}

function scoreClassName(score: number) {
  if (score >= 80) return "good";
  if (score >= 50) return "mid";
  return "bad";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type IconProps = {
  className?: string;
};

function IconBase({ children, className }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className ?? "size-full"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4.2-4.2" />
    </IconBase>
  );
}

function BoltIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </IconBase>
  );
}

function FileTextIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </IconBase>
  );
}

function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </IconBase>
  );
}

function MegaphoneIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 11v2a2 2 0 0 0 2 2h2l4 5v-5l8-3V6l-8 3H5a2 2 0 0 0-2 2Z" />
      <path d="M19 6a3 3 0 0 1 0 6" />
    </IconBase>
  );
}

function NodesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="12" cy="18" r="3" />
      <path d="M8.6 7.5 10.8 15" />
      <path d="m15.4 7.5-2.2 7.5" />
      <path d="M9 6h6" />
    </IconBase>
  );
}

function MapPinIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 22s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12Z" />
      <circle cx="12" cy="10" r="2.5" />
    </IconBase>
  );
}

function BotIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 8V4" />
      <path d="M9 4h6" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
      <path d="M10 17h4" />
    </IconBase>
  );
}

function PrinterIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 9V3h10v6" />
      <path d="M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <path d="M7 14h10v7H7z" />
    </IconBase>
  );
}

function CopyIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </IconBase>
  );
}

function LightbulbIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.4 1 1.1 1 1.8V17h6v-.5c0-.7.4-1.4 1-1.8A7 7 0 0 0 12 2Z" />
    </IconBase>
  );
}
