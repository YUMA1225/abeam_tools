"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import { degrees, PDFDocument as PdfLibDocument } from "pdf-lib";

type Rotation = 0 | 90 | 180 | 270;
type DropPosition = "before" | "after";

type PdfViewport = {
  width: number;
  height: number;
};

type PdfRenderTask = {
  promise: Promise<void>;
  cancel: () => void;
};

type PdfPage = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: { canvas: HTMLCanvasElement | null; canvasContext?: CanvasRenderingContext2D; viewport: PdfViewport }) => PdfRenderTask;
};

type PdfJsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

type PdfSource = {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  pdfDocument: PdfJsDocument;
  pageCount: number;
};

type PageQueueItem = {
  id: string;
  sourceId: string;
  pageNumber: number;
  rotation: Rotation;
  enabled: boolean;
};

type DragTarget = {
  pageId: string;
  position: DropPosition;
};

const rotationOptions: Rotation[] = [0, 90, 180, 270];

export default function PdfMergerPage() {
  const sourcesRef = useRef<PdfSource[]>([]);
  const [sources, setSources] = useState<PdfSource[]>([]);
  const [pages, setPages] = useState<PageQueueItem[]>([]);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [draggedPageId, setDraggedPageId] = useState("");
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null;
  const selectedSource = selectedPage ? sourceById.get(selectedPage.sourceId) ?? null : null;
  const enabledPages = pages.filter((page) => page.enabled && sourceById.has(page.sourceId));
  const rotatedPageCount = pages.filter((page) => page.rotation !== 0).length;

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  useEffect(() => {
    return () => {
      for (const source of sourcesRef.current) void source.pdfDocument.destroy();
    };
  }, []);

  async function loadFiles(files: FileList | File[]) {
    const pdfFiles = Array.from(files).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));

    if (pdfFiles.length === 0) {
      setError("PDFファイルを選択してください。");
      return;
    }

    setIsLoading(true);
    setError("");
    setStatus(`${pdfFiles.length}ファイルを読み込んでいます...`);

    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

      const loadedSources: PdfSource[] = [];
      const loadedPages: PageQueueItem[] = [];
      let failedCount = 0;

      for (const file of pdfFiles) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const task = pdfjs.getDocument({ data: bytes.slice() });
          const pdfDocument = (await task.promise) as unknown as PdfJsDocument;
          const sourceId = createId();

          loadedSources.push({
            id: sourceId,
            name: file.name,
            size: file.size,
            bytes,
            pdfDocument,
            pageCount: pdfDocument.numPages,
          });

          for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
            loadedPages.push({
              id: createId(),
              sourceId,
              pageNumber,
              rotation: 0,
              enabled: true,
            });
          }
        } catch (loadError) {
          console.error(loadError);
          failedCount += 1;
        }
      }

      if (loadedSources.length > 0) {
        setSources((current) => [...current, ...loadedSources]);
        setPages((current) => [...current, ...loadedPages]);
        setSelectedPageId((current) => current || loadedPages[0]?.id || "");
      }

      setStatus(`${loadedSources.length}ファイル / ${loadedPages.length}ページを追加しました。`);
      if (failedCount > 0) setError(`${failedCount}ファイルは読み込めませんでした。暗号化PDFや破損ファイルの可能性があります。`);
    } finally {
      setIsLoading(false);
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void loadFiles(event.target.files);
    event.target.value = "";
  }

  function handleDropFiles(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (event.dataTransfer.files) void loadFiles(event.dataTransfer.files);
  }

  function updatePage(pageId: string, updates: Partial<Pick<PageQueueItem, "enabled" | "rotation">>) {
    setPages((current) => current.map((page) => (page.id === pageId ? { ...page, ...updates } : page)));
  }

  function movePage(pageId: string, direction: -1 | 1) {
    setPages((current) => {
      const index = current.findIndex((page) => page.id === pageId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [page] = next.splice(index, 1);
      next.splice(nextIndex, 0, page);
      return next;
    });
  }

  function removePage(pageId: string) {
    setPages((current) => {
      const next = current.filter((page) => page.id !== pageId);
      if (selectedPageId === pageId) setSelectedPageId(next[0]?.id ?? "");
      return next;
    });
  }

  function removeSource(sourceId: string) {
    const source = sources.find((item) => item.id === sourceId);
    if (source) void source.pdfDocument.destroy();

    setSources((current) => current.filter((item) => item.id !== sourceId));
    setPages((current) => {
      const next = current.filter((page) => page.sourceId !== sourceId);
      if (selectedPageId && !next.some((page) => page.id === selectedPageId)) setSelectedPageId(next[0]?.id ?? "");
      return next;
    });
  }

  function clearAll() {
    for (const source of sources) void source.pdfDocument.destroy();
    setSources([]);
    setPages([]);
    setSelectedPageId("");
    setDraggedPageId("");
    setDragTarget(null);
    setStatus("");
    setError("");
  }

  function handlePageDragStart(event: DragEvent<HTMLElement>, pageId: string) {
    setDraggedPageId(pageId);
    setSelectedPageId(pageId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", pageId);
  }

  function handlePageDragOver(event: DragEvent<HTMLElement>, pageId: string) {
    event.preventDefault();
    if (!draggedPageId || draggedPageId === pageId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const position: DropPosition = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setDragTarget({ pageId, position });
  }

  function handlePageDrop(event: DragEvent<HTMLElement>, pageId: string) {
    event.preventDefault();
    const movingPageId = draggedPageId || event.dataTransfer.getData("text/plain");
    const position = dragTarget?.pageId === pageId ? dragTarget.position : "before";
    movePageToTarget(movingPageId, pageId, position);
  }

  function handleDropAtEnd(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const movingPageId = draggedPageId || event.dataTransfer.getData("text/plain");
    setPages((current) => movePageWithinList(current, movingPageId, null, "after"));
    setDraggedPageId("");
    setDragTarget(null);
  }

  function movePageToTarget(movingPageId: string, targetPageId: string, position: DropPosition) {
    setPages((current) => movePageWithinList(current, movingPageId, targetPageId, position));
    setDraggedPageId("");
    setDragTarget(null);
  }

  async function exportMergedPdf() {
    if (enabledPages.length === 0) {
      setError("結合するページを1ページ以上チェックしてください。");
      return;
    }

    setIsExporting(true);
    setError("");
    setStatus("チェック済みページを順番どおりに結合しています...");

    try {
      const outputPdf = await PdfLibDocument.create();
      const sourcePdfCache = new Map<string, PdfLibDocument>();

      for (const pageItem of enabledPages) {
        const source = sourceById.get(pageItem.sourceId);
        if (!source) continue;

        let sourcePdf = sourcePdfCache.get(source.id);
        if (!sourcePdf) {
          sourcePdf = await PdfLibDocument.load(source.bytes);
          sourcePdfCache.set(source.id, sourcePdf);
        }

        const [copiedPage] = await outputPdf.copyPages(sourcePdf, [pageItem.pageNumber - 1]);
        if (pageItem.rotation !== 0) {
          const currentRotation = copiedPage.getRotation().angle;
          copiedPage.setRotation(degrees((currentRotation + pageItem.rotation) % 360));
        }
        outputPdf.addPage(copiedPage);
      }

      const bytes = await outputPdf.save();
      const blob = new Blob([toArrayBuffer(bytes)], { type: "application/pdf" });
      prepareDownload(blob, buildOutputFileName(sources));
      setStatus(`${enabledPages.length}ページの結合PDFを保存します。`);
    } catch (exportError) {
      console.error(exportError);
      setError("PDFの結合に失敗しました。別のPDFや少ないページ数でお試しください。");
      setStatus("");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[#edf2f6] text-[#172033] lg:h-dvh lg:overflow-hidden">
      <header className="border-b border-slate-200 bg-white px-5 py-4 lg:h-16 lg:py-0">
        <div className="mx-auto flex h-full max-w-[1760px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid size-10 place-items-center rounded-xl bg-[#0f766e] text-white shadow-sm">
              <MergeIcon className="size-5" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-teal-700">Abeam Tech Tools</p>
              <h1 className="text-lg font-black tracking-normal">PDF結合ツール</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <ShieldIcon className="size-4 text-teal-700" />
            ブラウザ内で処理
          </div>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-[1760px] gap-4 p-4 lg:h-[calc(100dvh-64px)] lg:grid-cols-[330px_minmax(0,1fr)_340px] lg:overflow-hidden">
        <aside className="flex min-h-0 flex-col gap-3 lg:overflow-hidden">
          <label
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDropFiles}
            className="group flex min-h-28 shrink-0 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 shadow-sm transition hover:border-teal-400 hover:bg-teal-50/40"
          >
            <input type="file" accept="application/pdf,.pdf" multiple onChange={handleFileInput} className="sr-only" />
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-slate-950 text-white transition group-hover:bg-teal-700">
              <UploadIcon className="size-5" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block text-sm font-black">{sources.length ? "PDFを追加" : "PDFを選択"}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">複数選択、またはドラッグ&ドロップ</span>
              <span className="mt-1 block text-xs font-bold text-slate-400">{pages.length ? `${sources.length}ファイル / ${pages.length}ページ` : "PDFは端末内で読み込みます"}</span>
            </span>
          </label>

          <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-black">結合設定</h2>
              <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-black text-teal-700">{enabledPages.length}ページ出力</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Metric label="PDF" value={sources.length.toString()} />
              <Metric label="ページ" value={pages.length.toString()} />
              <Metric label="回転" value={rotatedPageCount.toString()} />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">中央のページをドラッグして差し込み、チェック済みのページだけを表示順に結合します。</p>
          </section>

          <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-black">読み込みPDF</h2>
              {sources.length > 0 && (
                <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 text-xs font-black text-slate-400 transition hover:text-red-600">
                  <TrashIcon className="size-3.5" />
                  クリア
                </button>
              )}
            </div>

            {sources.length ? (
              <div className="mt-3 grid min-h-0 flex-1 auto-rows-min gap-2 overflow-auto pr-1">
                {sources.map((source) => {
                  const sourcePages = pages.filter((page) => page.sourceId === source.id);
                  const enabledSourcePages = sourcePages.filter((page) => page.enabled);
                  return (
                    <div key={source.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black text-slate-800">{source.name}</p>
                          <p className="mt-1 text-[11px] font-bold text-slate-400">
                            {formatBytes(source.size)} / {enabledSourcePages.length}/{source.pageCount}ページ
                          </p>
                        </div>
                        <button type="button" onClick={() => removeSource(source.id)} className="grid size-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-red-50 hover:text-red-600" aria-label={`${source.name}を削除`}>
                          <TrashIcon className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-slate-500">PDFを読み込むと、すべてのページが中央に並びます。</p>
            )}
          </section>

          <div className="shrink-0 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPages((current) => current.map((page) => ({ ...page, enabled: true })))}
                disabled={pages.length === 0}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-teal-300 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                全チェック
              </button>
              <button
                type="button"
                onClick={() => setPages((current) => current.map((page) => ({ ...page, rotation: 0 })))}
                disabled={pages.length === 0}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition hover:border-teal-300 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                回転リセット
              </button>
            </div>
            <button
              type="button"
              onClick={exportMergedPdf}
              disabled={enabledPages.length === 0 || isLoading || isExporting}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <DownloadIcon className="size-4" />
              {isExporting ? "結合中..." : "チェック済みページを結合保存"}
            </button>
            {(status || error) && <p className={`min-h-5 truncate text-xs font-bold ${error ? "text-red-600" : "text-slate-500"}`}>{error || status}</p>}
          </div>
        </aside>

        <section className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 px-4">
            <h2 className="flex items-center gap-2 text-sm font-black">
              <GridIcon className="size-4 text-teal-700" />
              ページ順
            </h2>
            <span className="text-xs font-bold text-slate-400">ドラッグで差し込み</span>
          </header>

          {pages.length === 0 ? (
            <div className="grid min-h-[520px] place-items-center px-6 text-center lg:h-[calc(100%-56px)]">
              <div className="max-w-sm">
                <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-slate-100 text-slate-700">
                  <FileStackIcon className="size-8" />
                </div>
                <h2 className="mt-6 text-2xl font-black tracking-normal">ページを並べて結合</h2>
                <p className="mt-4 text-sm leading-7 text-slate-500">PDFを追加すると全ページがここに並びます。必要なページをチェックして、好きな順番に動かせます。</p>
              </div>
            </div>
          ) : (
            <div className="h-[680px] overflow-auto bg-[#dfe7ef] p-4 lg:h-[calc(100%-56px)]">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(138px,1fr))] gap-3">
                {pages.map((page, index) => {
                  const source = sourceById.get(page.sourceId);
                  if (!source) return null;
                  const selected = selectedPage?.id === page.id;
                  const activeDropTarget = dragTarget?.pageId === page.id;

                  return (
                    <article
                      key={page.id}
                      draggable
                      onDragStart={(event) => handlePageDragStart(event, page.id)}
                      onDragOver={(event) => handlePageDragOver(event, page.id)}
                      onDrop={(event) => handlePageDrop(event, page.id)}
                      onDragEnd={() => {
                        setDraggedPageId("");
                        setDragTarget(null);
                      }}
                      className={`group relative cursor-grab rounded-xl border bg-white p-2 shadow-sm transition active:cursor-grabbing ${
                        selected ? "border-teal-400 ring-4 ring-teal-100" : "border-slate-200 hover:border-teal-200"
                      } ${page.enabled ? "" : "opacity-55"} ${draggedPageId === page.id ? "scale-95 opacity-40" : ""}`}
                    >
                      {activeDropTarget && (
                        <span
                          className={`pointer-events-none absolute inset-y-2 z-20 w-1 rounded-full bg-teal-600 shadow-lg ${
                            dragTarget.position === "before" ? "left-0 -translate-x-1.5" : "right-0 translate-x-1.5"
                          }`}
                        />
                      )}

                      <div className="flex items-center justify-between gap-2 px-1 pb-2">
                        <span className="truncate text-[11px] font-black text-slate-500">#{index + 1}</span>
                        <label className="grid size-6 cursor-pointer place-items-center rounded-md bg-white shadow-sm ring-1 ring-slate-200" title={page.enabled ? "出力する" : "出力しない"}>
                          <input type="checkbox" checked={page.enabled} onChange={() => updatePage(page.id, { enabled: !page.enabled })} className="size-4 accent-teal-700" />
                        </label>
                      </div>

                      <button type="button" onClick={() => setSelectedPageId(page.id)} className="block w-full text-left">
                        <div className="relative mx-auto grid h-44 place-items-center overflow-hidden rounded-lg bg-slate-100 shadow-inner ring-1 ring-slate-200">
                          <div style={{ transform: `rotate(${page.rotation}deg)` }} className="transition-transform duration-200">
                            <PdfCanvas pdfDocument={source.pdfDocument} pageNumber={page.pageNumber} targetWidth={106} className="bg-white shadow-md" />
                          </div>
                          {page.rotation !== 0 && <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-1 text-[10px] font-black text-white">{page.rotation}度</span>}
                        </div>
                        <p className="mt-2 truncate text-xs font-black text-slate-800">{source.name}</p>
                        <p className="mt-0.5 text-[11px] font-bold text-slate-400">元PDF {page.pageNumber}ページ</p>
                      </button>
                    </article>
                  );
                })}

                <div
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDropAtEnd}
                  className="grid min-h-56 place-items-center rounded-xl border border-dashed border-slate-300 bg-white/50 px-3 text-center text-xs font-black text-slate-400 transition hover:border-teal-300 hover:text-teal-700"
                >
                  末尾へ移動
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <header className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 px-4">
            <h2 className="flex items-center gap-2 text-sm font-black">
              <SlidersIcon className="size-4 text-teal-700" />
              選択ページ
            </h2>
            {selectedPage && <span className="text-xs font-bold text-slate-400">{pages.findIndex((page) => page.id === selectedPage.id) + 1}/{pages.length}</span>}
          </header>

          {selectedPage && selectedSource ? (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="overflow-hidden rounded-xl bg-[#dfe7ef] p-4">
                <div className="mx-auto flex h-72 items-center justify-center overflow-hidden rounded-lg bg-[#202a34] p-3 shadow-xl shadow-slate-950/20">
                  <div style={{ transform: `rotate(${selectedPage.rotation}deg)` }} className="transition-transform duration-200">
                    <PdfCanvas pdfDocument={selectedSource.pdfDocument} pageNumber={selectedPage.pageNumber} targetWidth={170} className="bg-white shadow-md" />
                  </div>
                </div>
              </div>

              <div className="mt-4 min-w-0">
                <p className="truncate text-sm font-black text-slate-900">{selectedSource.name}</p>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  元PDF {selectedPage.pageNumber}ページ / {formatBytes(selectedSource.size)}
                </p>
              </div>

              <div className="mt-5 space-y-5">
                <section className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                  <div>
                    <h3 className="text-sm font-black">出力</h3>
                    <p className="mt-1 text-xs font-bold text-slate-400">{selectedPage.enabled ? "このページを結合します" : "このページは除外します"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updatePage(selectedPage.id, { enabled: !selectedPage.enabled })}
                    className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-black transition ${
                      selectedPage.enabled ? "bg-teal-700 text-white hover:bg-teal-800" : "bg-white text-slate-500 ring-1 ring-slate-200 hover:text-slate-900"
                    }`}
                  >
                    <CheckIcon className="size-4" />
                    {selectedPage.enabled ? "チェック済み" : "除外中"}
                  </button>
                </section>

                <section>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-black">回転</h3>
                    <span className="text-xs font-bold text-slate-400">ページ単位</span>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1 rounded-xl bg-slate-100 p-1">
                    {rotationOptions.map((rotation) => (
                      <button
                        key={rotation}
                        type="button"
                        onClick={() => updatePage(selectedPage.id, { rotation })}
                        className={`h-10 rounded-lg text-xs font-black transition ${
                          selectedPage.rotation === rotation ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"
                        }`}
                      >
                        {rotation}度
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-black">位置</h3>
                    <span className="text-xs font-bold text-slate-400">微調整</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => movePage(selectedPage.id, -1)} disabled={pages[0]?.id === selectedPage.id} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 text-xs font-black text-slate-600 transition hover:border-teal-300 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-35">
                      <ArrowUpIcon className="size-4" />
                      前へ
                    </button>
                    <button type="button" onClick={() => movePage(selectedPage.id, 1)} disabled={pages.at(-1)?.id === selectedPage.id} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 text-xs font-black text-slate-600 transition hover:border-teal-300 hover:text-teal-700 disabled:cursor-not-allowed disabled:opacity-35">
                      <ArrowDownIcon className="size-4" />
                      後ろへ
                    </button>
                  </div>
                </section>

                <button type="button" onClick={() => removePage(selectedPage.id)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-100 bg-red-50 text-xs font-black text-red-700 transition hover:border-red-200 hover:bg-red-100">
                  <TrashIcon className="size-4" />
                  このページを削除
                </button>
              </div>
            </div>
          ) : (
            <div className="grid min-h-[360px] flex-1 place-items-center px-6 text-center">
              <div>
                <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                  <SlidersIcon className="size-7" />
                </div>
                <p className="mt-5 text-sm font-black">ページを選ぶと詳細を編集できます</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">チェック、回転、位置をページ単位で調整します。</p>
              </div>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function PdfCanvas({
  pdfDocument,
  pageNumber,
  targetWidth,
  className,
}: {
  pdfDocument: PdfJsDocument;
  pageNumber: number;
  targetWidth: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRendering, setIsRendering] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let renderTask: PdfRenderTask | null = null;

    async function renderPage() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      setIsRendering(true);

      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = targetWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const context = canvas.getContext("2d");
        if (!context) return;

        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = "auto";
        canvas.style.aspectRatio = `${Math.floor(viewport.width)} / ${Math.floor(viewport.height)}`;

        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        renderTask = page.render({ canvas: null, canvasContext: context, viewport });
        await renderTask.promise;
        if (!cancelled) setIsRendering(false);
      } catch (renderError) {
        if (!cancelled) {
          console.error(renderError);
          setIsRendering(false);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdfDocument, targetWidth]);

  return (
    <div className="relative mx-auto inline-block">
      {isRendering && <div className="absolute inset-0 z-10 grid place-items-center bg-white/75 text-[10px] font-black text-slate-500">描画中</div>}
      <canvas ref={canvasRef} className={className} />
    </div>
  );
}

function movePageWithinList(pages: PageQueueItem[], movingPageId: string, targetPageId: string | null, position: DropPosition) {
  if (!movingPageId || movingPageId === targetPageId) return pages;

  const movingIndex = pages.findIndex((page) => page.id === movingPageId);
  if (movingIndex < 0) return pages;

  const next = [...pages];
  const [movingPage] = next.splice(movingIndex, 1);

  if (!targetPageId) {
    next.push(movingPage);
    return next;
  }

  const targetIndex = next.findIndex((page) => page.id === targetPageId);
  if (targetIndex < 0) return pages;

  next.splice(position === "before" ? targetIndex : targetIndex + 1, 0, movingPage);
  return next;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-3">
      <p className="text-lg font-black leading-none text-slate-950">{value}</p>
      <p className="mt-1 text-[11px] font-bold text-slate-400">{label}</p>
    </div>
  );
}

function buildOutputFileName(sources: PdfSource[]) {
  const base = sources[0] ? baseName(sources[0].name) : "merged";
  return `${base}_merged.pdf`;
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function prepareDownload(blob: Blob, generatedFileName: string) {
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = generatedFileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function baseName(fileName: string) {
  const name = fileName.replace(/\.pdf$/i, "") || "merged";
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 KB";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
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

function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M20 16.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5" />
    </IconBase>
  );
}

function DownloadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M20 20H4" />
    </IconBase>
  );
}

function MergeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 4v16" />
      <path d="M17 4v16" />
      <path d="M7 8h4a4 4 0 0 1 4 4 4 4 0 0 0 4 4h-2" />
      <path d="m17 13 3 3-3 3" />
    </IconBase>
  );
}

function ShieldIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-5" />
    </IconBase>
  );
}

function FileStackIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 2H7a2 2 0 0 0-2 2v12" />
      <path d="M14 2v5h5" />
      <path d="M7 22h10a2 2 0 0 0 2-2V7l-5-5" />
      <path d="M3 7v13a2 2 0 0 0 2 2h12" />
    </IconBase>
  );
}

function GridIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </IconBase>
  );
}

function SlidersIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 21v-7" />
      <path d="M4 10V3" />
      <path d="M12 21v-9" />
      <path d="M12 8V3" />
      <path d="M20 21v-5" />
      <path d="M20 12V3" />
      <path d="M2 14h4" />
      <path d="M10 8h4" />
      <path d="M18 16h4" />
    </IconBase>
  );
}

function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 12 4 4L19 6" />
    </IconBase>
  );
}

function ArrowUpIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m18 15-6-6-6 6" />
    </IconBase>
  );
}

function ArrowDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 9 6 6 6-6" />
    </IconBase>
  );
}

function TrashIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </IconBase>
  );
}
