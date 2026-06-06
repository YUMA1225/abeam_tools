"use client";

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type Toast = {
  title: string;
  description: string;
  tone: "success" | "error";
};

export default function MarkdownTableConverterPage() {
  const [markdown, setMarkdown] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rows = useMemo(() => parseMarkdownTable(markdown), [markdown]);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

  function showToast(nextToast: Toast) {
    setToast(nextToast);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }

  async function copyAsTsv() {
    if (rows.length === 0) {
      showToast({
        title: "変換できません",
        description: "Markdown形式の表を入力してください。",
        tone: "error",
      });
      return;
    }

    const tsv = rows.map((row) => row.map(toTsvCell).join("\t")).join("\n");

    try {
      await navigator.clipboard.writeText(tsv);
      showToast({
        title: "コピーしました",
        description: "Excelやスプレッドシートへそのまま貼り付けられます。",
        tone: "success",
      });
    } catch {
      const copied = fallbackCopy(tsv);
      showToast(
        copied
          ? {
              title: "コピーしました",
              description: "Excelやスプレッドシートへそのまま貼り付けられます。",
              tone: "success",
            }
          : {
              title: "コピーできませんでした",
              description: "ブラウザのクリップボード設定をご確認ください。",
              tone: "error",
            },
      );
    }
  }

  return (
    <main className="min-h-dvh bg-[#eef3f8] text-[#172033] lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden">
      <header className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid size-11 place-items-center rounded-xl bg-[#0f766e] text-white shadow-sm">
              <TableIcon className="size-5" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-teal-700">Abeam Tech Tools</p>
              <h1 className="mt-0.5 text-xl font-black tracking-normal">Markdown表 → Excel変換ツール</h1>
              <p className="mt-1 text-xs text-slate-500">Markdownの表を、セルが崩れないタブ区切り形式に変換します。</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <ShieldIcon className="size-4 text-teal-700" />
            入力内容はブラウザ内で処理
          </div>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-[1500px] gap-5 p-4 md:p-6 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:overflow-hidden">
        <ToolPanel
          title="Markdownを入力"
          icon={<FileTextIcon className="size-4" />}
          action={
            <button
              type="button"
              onClick={() => setMarkdown("")}
              disabled={!markdown}
              className="inline-flex items-center gap-1.5 text-xs font-black text-slate-500 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <TrashIcon className="size-3.5" />
              クリア
            </button>
          }
        >
          <div className="flex min-h-[560px] flex-col p-4 md:p-5 lg:min-h-0 lg:flex-1">
            <p className="mb-3 text-xs font-bold text-slate-500">表全体を貼り付けてください。</p>

            <textarea
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              spellCheck={false}
              aria-label="Markdown表"
              placeholder={"| ヘッダー1 | ヘッダー2 |\n| --- | --- |\n| データA | データB |"}
              className="min-h-[390px] flex-1 resize-y rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm leading-6 text-slate-800 shadow-inner outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-100 lg:min-h-0 lg:resize-none"
            />

          </div>
        </ToolPanel>

        <ToolPanel
          title="貼り付けプレビュー"
          icon={<PreviewIcon className="size-4" />}
          action={
            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-black text-teal-700">
              {rows.length > 0 ? `${rows.length}行 × ${columnCount}列` : "リアルタイム表示"}
            </span>
          }
        >
          <div className="flex min-h-[560px] flex-col p-4 md:p-5 lg:min-h-0 lg:flex-1">
            <div className="min-h-[390px] flex-1 overflow-auto overscroll-contain rounded-xl border border-slate-200 bg-slate-50 lg:min-h-0">
              {rows.length > 0 ? (
                <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="sticky left-0 z-20 h-9 min-w-11 border-b border-r border-slate-300 bg-slate-100" />
                      {Array.from({ length: columnCount }, (_, index) => (
                        <th
                          key={index}
                          className="h-9 min-w-36 border-b border-r border-slate-300 bg-slate-100 px-3 text-center text-xs font-black text-slate-500"
                        >
                          {columnLabel(index)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className={rowIndex === 0 ? "font-black text-slate-900" : "text-slate-700"}>
                        <th className="sticky left-0 z-[5] h-10 border-b border-r border-slate-300 bg-slate-100 px-2 text-center text-xs font-black text-slate-400">
                          {rowIndex + 1}
                        </th>
                        {Array.from({ length: columnCount }, (_, columnIndex) => (
                          <td
                            key={columnIndex}
                            className={`h-10 max-w-80 border-b border-r border-slate-200 px-3 whitespace-nowrap ${
                              rowIndex === 0 ? "bg-teal-50/70" : "bg-white"
                            }`}
                          >
                            <span className="block max-w-72 overflow-hidden text-ellipsis">{row[columnIndex] ?? ""}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="grid min-h-[390px] place-items-center px-6 text-center">
                  <div>
                    <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                      <TableIcon className="size-7" />
                    </div>
                    <p className="mt-5 text-sm font-black">表のプレビューがここに表示されます</p>
                    <p className="mt-2 text-xs leading-5 text-slate-500">左の入力欄にMarkdown形式の表を貼り付けてください。</p>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={copyAsTsv}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 text-sm font-black text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus:ring-4 focus:ring-teal-200"
              >
                <CopyIcon className="size-4" />
                変換してコピー
              </button>
            </div>
          </div>
        </ToolPanel>
      </section>

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-40px)] items-center gap-3 rounded-xl bg-slate-950 px-4 py-3 text-white shadow-xl"
        >
          <span className={`grid size-7 shrink-0 place-items-center rounded-full ${toast.tone === "success" ? "bg-teal-500" : "bg-red-500"}`}>
            {toast.tone === "success" ? <CheckIcon className="size-4" /> : <AlertIcon className="size-4" />}
          </span>
          <span>
            <span className="block text-sm font-black">{toast.title}</span>
            <span className="mt-0.5 block text-xs text-slate-300">{toast.description}</span>
          </span>
        </div>
      )}
    </main>
  );
}

function ToolPanel({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 md:px-5">
        <h2 className="flex items-center gap-2 text-sm font-black text-slate-800">
          <span className="text-teal-700">{icon}</span>
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function parseMarkdownTable(markdown: string) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("|"))
    .map(splitMarkdownRow)
    .filter((row) => row.length > 0 && !isSeparatorRow(row));
}

function splitMarkdownRow(line: string) {
  const cells: string[] = [];
  let cell = "";
  let codeDelimiterLength = 0;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === "\\" && line[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }

    if (character === "`") {
      let delimiterLength = 1;
      while (line[index + delimiterLength] === "`") delimiterLength += 1;
      const delimiter = "`".repeat(delimiterLength);
      codeDelimiterLength = codeDelimiterLength === delimiterLength ? 0 : codeDelimiterLength === 0 ? delimiterLength : codeDelimiterLength;
      cell += delimiter;
      index += delimiterLength - 1;
      continue;
    }

    if (character === "|" && codeDelimiterLength === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }

    cell += character;
  }

  cells.push(cell.trim());
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells;
}

function isSeparatorRow(row: string[]) {
  return row.length > 0 && row.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function toTsvCell(cell: string) {
  return cell.replace(/\t/g, " ").replace(/\n/g, " ");
}

function columnLabel(index: number) {
  let label = "";
  let value = index;

  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);

  return label;
}

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function Icon({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function TableIcon({ className }: { className?: string }) {
  return <Icon className={className}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></Icon>;
}

function ShieldIcon({ className }: { className?: string }) {
  return <Icon className={className}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></Icon>;
}

function FileTextIcon({ className }: { className?: string }) {
  return <Icon className={className}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></Icon>;
}

function TrashIcon({ className }: { className?: string }) {
  return <Icon className={className}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" /></Icon>;
}

function CopyIcon({ className }: { className?: string }) {
  return <Icon className={className}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Icon>;
}

function PreviewIcon({ className }: { className?: string }) {
  return <Icon className={className}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></Icon>;
}

function CheckIcon({ className }: { className?: string }) {
  return <Icon className={className}><path d="m5 12 4 4L19 6" /></Icon>;
}

function AlertIcon({ className }: { className?: string }) {
  return <Icon className={className}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></Icon>;
}
