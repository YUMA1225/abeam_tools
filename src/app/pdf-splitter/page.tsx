"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, ReactNode } from "react";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

type SplitMode = "single" | "breaks";
type Range = {
  start: number;
  end: number;
};

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

type PdfDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

const maxPreviewPages = 120;
const webpTargetWidth = 1800;

export default function PdfSplitterPage() {
  const pdfDocumentRef = useRef<PdfDocument | null>(null);
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const previewGestureZoomRef = useRef(1);
  const [mode, setMode] = useState<SplitMode>("single");
  const [pdfDocument, setPdfDocument] = useState<PdfDocument | null>(null);
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [selectedPage, setSelectedPage] = useState(1);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewBaseWidth, setPreviewBaseWidth] = useState(430);
  const [breaks, setBreaks] = useState<Set<number>>(new Set());
  const [excludedRangeKeys, setExcludedRangeKeys] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const pageCount = pdfDocument?.numPages ?? 0;
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount]);
  const ranges = useMemo(() => buildRanges(pageCount, mode, breaks), [breaks, mode, pageCount]);
  const selectedRanges = useMemo(() => ranges.filter((range) => !excludedRangeKeys.has(rangeKey(range))), [excludedRangeKeys, ranges]);
  const isTooLargeForPreview = pageCount > maxPreviewPages;

  useEffect(() => {
    return () => {
      void pdfDocumentRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    const frame = previewFrameRef.current;
    if (!frame) return;

    const observer = new ResizeObserver(([entry]) => {
      setPreviewBaseWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });

    observer.observe(frame);
    return () => observer.disconnect();
  }, [pdfDocument]);

  useEffect(() => {
    const frame = previewFrameRef.current;
    if (!frame) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setPreviewZoom((zoom) => {
        const next = event.deltaY < 0 ? zoom * 1.08 : zoom * 0.92;
        return clampZoom(next);
      });
    };

    const handleGestureStart = (event: Event) => {
      event.preventDefault();
      previewGestureZoomRef.current = previewZoom;
    };

    const handleGestureChange = (event: Event) => {
      event.preventDefault();
      setPreviewZoom(clampZoom(previewGestureZoomRef.current * gestureScale(event)));
    };

    frame.addEventListener("wheel", handleWheel, { passive: false });
    frame.addEventListener("gesturestart", handleGestureStart);
    frame.addEventListener("gesturechange", handleGestureChange);
    return () => {
      frame.removeEventListener("wheel", handleWheel);
      frame.removeEventListener("gesturestart", handleGestureStart);
      frame.removeEventListener("gesturechange", handleGestureChange);
    };
  }, [pdfDocument, previewZoom]);

  async function loadFile(file: File) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("PDFファイルを選択してください。");
      return;
    }

    setIsLoading(true);
    setError("");
    setStatus("PDFを読み込んでいます...");
    setBreaks(new Set());
    setExcludedRangeKeys(new Set());
    setSelectedPage(1);
    setPreviewZoom(1);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

      const task = pdfjs.getDocument({ data: bytes.slice() });
      const loadedDocument = (await task.promise) as unknown as PdfDocument;

      void pdfDocumentRef.current?.destroy();
      pdfDocumentRef.current = loadedDocument;
      setPdfBytes(bytes);
      setPdfDocument(loadedDocument);
      setFileName(file.name);
      setFileSize(file.size);
      setStatus(`${loadedDocument.numPages}ページのPDFを読み込みました。`);
      setMode("single");
    } catch (loadError) {
      console.error(loadError);
      void pdfDocumentRef.current?.destroy();
      pdfDocumentRef.current = null;
      setPdfBytes(null);
      setPdfDocument(null);
      setFileName("");
      setFileSize(0);
      setStatus("");
      setError("PDFを読み込めませんでした。暗号化PDFや破損したファイルの可能性があります。");
    } finally {
      setIsLoading(false);
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }

  function toggleBreak(pageNumber: number) {
    if (mode !== "breaks") setExcludedRangeKeys(new Set());
    setMode("breaks");
    setBreaks((current) => {
      const next = new Set(current);
      if (next.has(pageNumber)) {
        next.delete(pageNumber);
      } else {
        next.add(pageNumber);
      }
      return next;
    });
  }

  function setEveryPageBreak() {
    setMode("single");
    setBreaks(new Set());
    setExcludedRangeKeys(new Set());
  }

  function setManualBreakMode() {
    setMode("breaks");
    setExcludedRangeKeys(new Set());
  }

  function toggleRangeOutput(range: Range) {
    const key = rangeKey(range);
    setExcludedRangeKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function selectAllRanges() {
    setExcludedRangeKeys(new Set());
  }

  function clearAllRanges() {
    setExcludedRangeKeys(new Set(ranges.map((range) => rangeKey(range))));
  }

  async function exportSplitPdf() {
    if (!pdfBytes || !pageCount) return;
    if (selectedRanges.length === 0) {
      setError("出力するページを1つ以上チェックしてください。");
      return;
    }

    const outputFileName = selectedRanges.length === 1 ? `${baseName(fileName)}_${selectedRanges[0].start}-${selectedRanges[0].end}.pdf` : `${baseName(fileName)}_split.zip`;
    setIsExporting(true);
    setError("");
    setStatus("分割PDFを作成しています...");

    try {
      const sourcePdf = await PDFDocument.load(pdfBytes);
      const outputs = [];

      for (const range of selectedRanges) {
        const pdf = await PDFDocument.create();
        const pageIndexes = Array.from({ length: range.end - range.start + 1 }, (_, index) => range.start + index - 1);
        const copiedPages = await pdf.copyPages(sourcePdf, pageIndexes);
        for (const page of copiedPages) pdf.addPage(page);
        const bytes = await pdf.save();
        outputs.push({
          name: `${baseName(fileName)}_${range.start}-${range.end}.pdf`,
          bytes,
        });
      }

      if (outputs.length === 1) {
        const blob = new Blob([toArrayBuffer(outputs[0].bytes)], { type: "application/pdf" });
        prepareDownload(blob, outputs[0].name);
      } else {
        const zip = new JSZip();
        for (const output of outputs) zip.file(output.name, output.bytes);
        const zipBlob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
        prepareDownload(zipBlob, outputFileName);
      }

      setStatus(`${outputs.length}ファイルの保存を開始しました。`);
    } catch (exportError) {
      console.error(exportError);
      setError("分割PDFの作成に失敗しました。別のPDFでお試しください。");
      setStatus("");
    } finally {
      setIsExporting(false);
    }
  }

  async function exportWebpZip() {
    if (!pdfDocument || mode !== "single") return;
    if (selectedRanges.length === 0) {
      setError("WebPにするページを1つ以上チェックしてください。");
      return;
    }

    setIsExporting(true);
    setError("");
    const outputFileName = `${baseName(fileName)}_webp.zip`;

    setStatus("WebP画像を作成しています...");

    try {
      const zip = new JSZip();
      for (let index = 0; index < selectedRanges.length; index += 1) {
        const pageNumber = selectedRanges[index].start;
        setStatus(`WebP画像を作成しています... ${index + 1}/${selectedRanges.length}`);
        const blob = await renderPageToWebp(pdfDocument, pageNumber);
        zip.file(`${baseName(fileName)}_page-${String(pageNumber).padStart(3, "0")}.webp`, blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
      prepareDownload(zipBlob, outputFileName);
      setStatus(`${selectedRanges.length}ページのWebP保存を開始しました。`);
    } catch (webpError) {
      console.error(webpError);
      setError("WebP画像の作成に失敗しました。別のPDFでお試しください。");
      setStatus("");
    } finally {
      setIsExporting(false);
    }
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

  return (
    <main className="h-dvh overflow-hidden bg-[#eef3f8] text-[#172033]">
      <header className="h-16 border-b border-slate-200 bg-white px-5">
        <div className="mx-auto flex h-full max-w-[1760px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid size-10 place-items-center rounded-xl bg-[#0f766e] text-white shadow-sm">
              <ScissorsIcon className="size-5" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-teal-700">Abeam Tech Tools</p>
              <h1 className="text-lg font-black tracking-normal">PDF分割ツール</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <ShieldIcon className="size-4 text-teal-700" />
            ブラウザ内で処理
          </div>
        </div>
      </header>

      <section className="mx-auto grid h-[calc(100dvh-64px)] max-w-[1760px] gap-4 overflow-hidden p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <label
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="group flex h-24 shrink-0 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 shadow-sm transition hover:border-teal-400 hover:bg-teal-50/40"
          >
            <input type="file" accept="application/pdf,.pdf" onChange={handleFileInput} className="sr-only" />
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-900 text-white transition group-hover:bg-teal-700">
              <UploadIcon className="size-5" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block text-sm font-black">{fileName ? "PDFを変更" : "PDFを選択"}</span>
              <span className="mt-1 block truncate text-xs text-slate-500">
                {fileName ? fileName : "クリック、またはドラッグ&ドロップ"}
              </span>
              {fileName && (
                <span className="mt-1 block text-xs font-bold text-slate-400">
                  {formatBytes(fileSize)} / {pageCount || "-"}ページ
                </span>
              )}
            </span>
          </label>

          <section className="shrink-0 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-black">分割方法</h2>
              <span className="text-xs font-bold text-slate-400">{pageCount ? `${selectedRanges.length}/${ranges.length}出力` : "未選択"}</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={setEveryPageBreak}
                className={`h-9 rounded-md text-xs font-black transition ${mode === "single" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
              >
                1ページごと
              </button>
              <button
                type="button"
                onClick={setManualBreakMode}
                className={`h-9 rounded-md text-xs font-black transition ${mode === "breaks" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
              >
                区切り指定
              </button>
            </div>

            <div className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
              <p className="max-h-10 overflow-hidden">
                {mode === "single"
                  ? "各ページを1つずつPDFにして、ZIPでまとめて保存します。"
                  : "ページ間のボタンを押した位置でPDFを区切ります。"}
              </p>
              {mode === "breaks" && pageCount > 1 && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setBreaks(new Set())} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-teal-300 hover:text-teal-700">
                    区切りを解除
                  </button>
                  <button
                    type="button"
                    onClick={() => setBreaks(new Set(Array.from({ length: pageCount - 1 }, (_, index) => index + 1)))}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-teal-300 hover:text-teal-700"
                  >
                    すべて区切る
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <h2 className="text-sm font-black">出力</h2>
              {pageCount > 0 && (
                <span className="text-xs font-bold text-slate-400">
                  {selectedRanges.length}/{ranges.length}
                </span>
              )}
            </div>
            {pageCount ? (
              <>
                <div className="mt-2 flex shrink-0 flex-wrap gap-2">
                  <button type="button" onClick={selectAllRanges} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-teal-300 hover:text-teal-700">
                    すべてチェック
                  </button>
                  <button type="button" onClick={clearAllRanges} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-teal-300 hover:text-teal-700">
                    すべて外す
                  </button>
                </div>
                <div className="mt-2 grid min-h-0 flex-1 auto-rows-min content-start gap-1.5 overflow-auto pr-1">
                  {ranges.map((range, index) => {
                    const checked = !excludedRangeKeys.has(rangeKey(range));
                    return (
                      <label
                        key={rangeKey(range)}
                        className={`flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-2 text-xs font-black transition ${
                          checked ? "border-teal-200 bg-teal-50 text-slate-800" : "border-slate-200 bg-slate-50 text-slate-400"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRangeOutput(range)}
                          className="size-4 accent-teal-700"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {index + 1}: {rangeLabel(range)}
                        </span>
                        <span className={checked ? "text-teal-700" : "text-slate-400"}>{checked ? "出力" : "除外"}</span>
                      </label>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="mt-3 text-xs leading-5 text-slate-500">PDFを読み込むと、分割後の範囲が表示されます。</p>
            )}
          </section>

          <div className="shrink-0 space-y-2">
            <button
              type="button"
              onClick={exportSplitPdf}
              disabled={!pdfBytes || isExporting || isLoading || selectedRanges.length === 0}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <DownloadIcon className="size-4" />
              {isExporting ? "作成中..." : selectedRanges.length > 1 ? "PDF ZIP保存" : "PDF保存"}
            </button>

            <button
              type="button"
              onClick={exportWebpZip}
              disabled={mode !== "single" || !pdfDocument || isExporting || isLoading || selectedRanges.length === 0}
              className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-black shadow-sm transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${
                mode === "single" ? "border-teal-200 bg-white text-teal-800 hover:border-teal-400 hover:bg-teal-50" : "border-slate-200 bg-slate-50 text-slate-400"
              }`}
            >
              <ImageIcon className="size-4" />
              {isExporting ? "作成中..." : selectedRanges.length === ranges.length ? "全ページをWebP ZIP保存" : "チェック済みページをWebP ZIP保存"}
            </button>
            {(status || error) && (
              <p className={`min-h-5 truncate text-xs font-bold ${error ? "text-red-600" : "text-slate-500"}`}>
                {error || status}
              </p>
            )}
          </div>
        </aside>

        <section className="min-h-0 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {!pdfDocument ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto grid size-16 place-items-center rounded-2xl bg-slate-100 text-slate-700">
                  <FileTextIcon className="size-8" />
                </div>
                <h2 className="mt-6 text-2xl font-black tracking-normal">プレビューしながら分割</h2>
                <p className="mt-4 text-sm leading-7 text-slate-500">PDFを読み込むと、左で分割方法を選び、ここでページを確認しながら区切り位置を指定できます。</p>
              </div>
            </div>
          ) : (
            <div className="grid h-full min-h-0 lg:grid-cols-[auto_minmax(0,1fr)]">
              <div className="h-full min-h-0 border-b border-slate-200 bg-[#dfe7ef] p-3 lg:border-b-0 lg:border-r">
                <div className="grid h-full min-h-0 place-items-center">
                  <div
                    ref={previewFrameRef}
                    className="relative aspect-[210/297] h-full min-w-[360px] max-w-[520px] overflow-hidden rounded-xl bg-[#202a34] shadow-xl shadow-slate-950/25"
                  >
                    <div className="absolute inset-0 overflow-auto p-2">
                      <div className="grid min-h-full place-items-center">
                        <PdfCanvas
                          key={`main-${selectedPage}-${previewZoom}-${previewBaseWidth}`}
                          pdfDocument={pdfDocument}
                          pageNumber={selectedPage}
                          targetWidth={Math.round(previewBaseWidth * 0.96 * previewZoom)}
                          className="bg-white shadow-lg shadow-black/20"
                        />
                      </div>
                    </div>

                    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
                      <div className="rounded-lg bg-black/60 px-3 py-2 text-white shadow-lg backdrop-blur-sm">
                        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-white/65">Preview</p>
                        <p className="mt-0.5 text-sm font-black">Page {selectedPage} / {pageCount}</p>
                      </div>
                      {previewZoom !== 1 && (
                        <button
                          type="button"
                          onClick={() => setPreviewZoom(1)}
                          className="pointer-events-auto rounded-lg bg-black/60 px-2.5 py-2 text-xs font-black text-white shadow-lg backdrop-blur-sm transition hover:bg-black/75"
                          title="100%に戻す"
                        >
                          {Math.round(previewZoom * 100)}%
                        </button>
                      )}
                    </div>

                    <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-black/60 p-1.5 shadow-lg backdrop-blur-sm">
                      <button
                        type="button"
                        onClick={() => setSelectedPage((page) => Math.max(1, page - 1))}
                        disabled={selectedPage <= 1}
                        className="grid size-9 place-items-center rounded-md text-white transition hover:bg-white/15 disabled:opacity-35"
                        aria-label="前のページ"
                      >
                        <ChevronLeftIcon className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPage((page) => Math.min(pageCount, page + 1))}
                        disabled={selectedPage >= pageCount}
                        className="grid size-9 place-items-center rounded-md text-white transition hover:bg-white/15 disabled:opacity-35"
                        aria-label="次のページ"
                      >
                        <ChevronRightIcon className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 min-w-0 flex-col p-3">
                <div className="flex shrink-0 items-center justify-between gap-3">
                  <h2 className="text-sm font-black">ページ一覧</h2>
                  <span className="text-xs font-bold text-slate-400">{mode === "breaks" ? "間を押して区切る" : "全ページ分割"}</span>
                </div>
                {isTooLargeForPreview && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">ページ数が多いため、プレビュー描画に時間がかかる場合があります。</p>
                )}
                <div className="mt-3 grid min-h-0 flex-1 grid-cols-3 content-start gap-x-12 gap-y-6 overflow-auto pr-12">
                  {pages.map((pageNumber) => {
                    const range = findRangeForPage(ranges, pageNumber);
                    const checked = range ? !excludedRangeKeys.has(rangeKey(range)) : false;
                    return (
                      <div key={pageNumber} className="group relative">
                        {range && (
                          <label
                            className="absolute right-4 top-4 z-20 grid size-6 cursor-pointer place-items-center"
                            title={checked ? `${rangeLabel(range)}を出力しない` : `${rangeLabel(range)}を出力する`}
                            aria-label={checked ? `${rangeLabel(range)}を出力しない` : `${rangeLabel(range)}を出力する`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRangeOutput(range)}
                              className="size-5 accent-teal-700 drop-shadow-sm"
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedPage(pageNumber)}
                          className={`relative flex w-full flex-col items-center gap-2 bg-sky-50/70 px-3 py-3 text-left transition ${
                            selectedPage === pageNumber
                              ? "bg-sky-100 shadow-[inset_0_0_0_2px_rgba(20,184,166,0.35)]"
                              : "hover:bg-sky-50"
                          } ${checked ? "" : "opacity-55"}`}
                        >
                          <PdfCanvas pdfDocument={pdfDocument} pageNumber={pageNumber} targetWidth={150} className="max-w-full border border-dashed border-slate-300 bg-white shadow-sm" />
                          <span className="text-sm font-black leading-none text-slate-500">{pageNumber}</span>
                        </button>
                        {mode === "breaks" && pageNumber < pageCount && (
                          <button
                            type="button"
                            onClick={() => toggleBreak(pageNumber)}
                            className={`group/split absolute bottom-0 left-full top-0 z-10 flex w-12 items-center justify-center transition ${
                              mode === "breaks" && breaks.has(pageNumber)
                                ? "text-teal-600 opacity-100 hover:bg-teal-50/70 hover:text-teal-800"
                                : "text-sky-400 opacity-100 hover:bg-sky-100/60 hover:text-teal-600"
                            }`}
                            aria-label={breaks.has(pageNumber) ? `Page ${pageNumber} の後の区切りを解除` : `Page ${pageNumber} の後で区切る`}
                          >
                            <span
                              className={`absolute bottom-0 top-0 border-l-2 ${
                                mode === "breaks" && breaks.has(pageNumber)
                                  ? "border-teal-600 transition group-hover/split:border-teal-800"
                                  : "border-dashed border-sky-300 transition group-hover/split:border-solid group-hover/split:border-teal-500"
                              }`}
                            />
                            <span
                              className={`relative grid size-7 place-items-center rounded-full border shadow-sm transition ${
                                mode === "breaks" && breaks.has(pageNumber)
                                  ? "border-teal-600 bg-teal-600 text-white group-hover/split:border-teal-800 group-hover/split:bg-teal-800"
                                  : "border-sky-300 bg-sky-300 text-white group-hover/split:border-teal-500 group-hover/split:bg-teal-500"
                              }`}
                            >
                              <ScissorsIcon className="size-3.5" />
                            </span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>
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
  pdfDocument: PdfDocument;
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
      } catch (error) {
        if (!cancelled) {
          console.error(error);
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
      {isRendering && <div className="absolute inset-0 z-10 grid place-items-center bg-white/75 text-xs font-black text-slate-500">描画中</div>}
      <canvas ref={canvasRef} className={className} />
    </div>
  );
}

function buildRanges(pageCount: number, mode: SplitMode, breaks: Set<number>): Range[] {
  if (!pageCount) return [];
  if (mode === "single") return Array.from({ length: pageCount }, (_, index) => ({ start: index + 1, end: index + 1 }));

  const sortedBreaks = Array.from(breaks)
    .filter((pageNumber) => pageNumber >= 1 && pageNumber < pageCount)
    .sort((a, b) => a - b);

  const ranges: Range[] = [];
  let start = 1;
  for (const breakPage of sortedBreaks) {
    ranges.push({ start, end: breakPage });
    start = breakPage + 1;
  }
  ranges.push({ start, end: pageCount });
  return ranges;
}

function clampZoom(value: number) {
  return Math.min(3, Math.max(0.75, Number(value.toFixed(3))));
}

function gestureScale(event: Event) {
  const maybeGesture = event as Event & { scale?: unknown };
  return typeof maybeGesture.scale === "number" ? maybeGesture.scale : 1;
}

async function renderPageToWebp(pdfDocument: PdfDocument, pageNumber: number) {
  const page = await pdfDocument.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = webpTargetWidth / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is not available.");

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const renderTask = page.render({ canvas: null, canvasContext: context, viewport });
  await renderTask.promise;
  return canvasToBlob(canvas, "image/webp", 0.9);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to create image blob."));
        }
      },
      type,
      quality,
    );
  });
}

function rangeKey(range: Range) {
  return `${range.start}-${range.end}`;
}

function rangeLabel(range: Range) {
  return range.start === range.end ? `${range.start}ページ` : `${range.start}-${range.end}ページ`;
}

function findRangeForPage(ranges: Range[], pageNumber: number) {
  return ranges.find((range) => range.start <= pageNumber && pageNumber <= range.end);
}

function baseName(fileName: string) {
  const name = fileName.replace(/\.pdf$/i, "") || "split";
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

function ScissorsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="7" r="3" />
      <circle cx="6" cy="17" r="3" />
      <path d="M8.6 8.6 19 19" />
      <path d="M8.6 15.4 19 5" />
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

function ChevronLeftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m15 18-6-6 6-6" />
    </IconBase>
  );
}

function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 18 6-6-6-6" />
    </IconBase>
  );
}

function ImageIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8" cy="10" r="1.5" />
      <path d="m21 15-4.5-4.5L8 19" />
    </IconBase>
  );
}
