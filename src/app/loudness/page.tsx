"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import {
  analyzeMediaLoudnessInBrowser,
  normalizeMediaLoudnessInBrowser,
  prepareLoudnessFfmpegEngine,
  type LoudnessAnalyzePayload,
  type LoudnessNormalizePayload,
} from "@/lib/loudness-ffmpeg-client";
import { detectMediaKind, getMediaLabel } from "@/lib/loudness-media";
import { listLoudnessPlatforms, type LoudnessPlatform } from "@/lib/loudness-platforms";

type Tone = "ok" | "warn" | "danger";
type Analysis = {
  isPass: boolean;
  loudnessScore: number;
  peakScore: number;
  loudness: {
    tone: Tone;
    headline: string;
    detail: string;
    pass: boolean;
  };
  peak: {
    state: "ok" | "tolerated" | "high";
    line: string;
    pass: boolean;
  };
  recommendation: string;
};
type AnalyzeStep = "core" | "file" | "analyze";

const LOUDNESS_THRESHOLDS = {
  x1: -6.0,
  x2: -1.5,
  y1: 1.5,
};
const PEAK_RED_THRESHOLD = 1.0;
const X_PROFILE_URL = "https://x.com/okamoto_yuma_";
const DEFAULT_PLATFORMS = listLoudnessPlatforms();
const ANALYZE_STEPS: Array<{ key: AnalyzeStep; label: string }> = [
  { key: "core", label: "解析エンジン準備" },
  { key: "file", label: "ファイル読み込み" },
  { key: "analyze", label: "音量解析" },
];

const TONE_STYLE = {
  ok: {
    panel: "border-emerald-200 bg-emerald-50/70",
    badge: "border-emerald-200 bg-emerald-100 text-emerald-700",
    headline: "text-emerald-800",
  },
  warn: {
    panel: "border-amber-200 bg-amber-50/70",
    badge: "border-amber-200 bg-amber-100 text-amber-700",
    headline: "text-amber-800",
  },
  danger: {
    panel: "border-rose-200 bg-rose-50/70",
    badge: "border-rose-200 bg-rose-100 text-rose-700",
    headline: "text-rose-800",
  },
} satisfies Record<Tone, { panel: string; badge: string; headline: string }>;

function toFixed(value: number, digits = 1) {
  return Number(value).toFixed(digits);
}

function signed(value: number, digits = 1) {
  const num = Number(value);
  const str = toFixed(num, digits);
  return num > 0 ? `+${str}` : str;
}

function getDefaultPlatformKey(platforms: LoudnessPlatform[]) {
  if (platforms.some((item) => item.key === "youtube")) return "youtube";
  if (platforms.some((item) => item.key === "tiktok")) return "tiktok";
  return platforms[0]?.key || "";
}

function evaluateLoudness(score: number): Analysis["loudness"] {
  if (score <= LOUDNESS_THRESHOLDS.x1) {
    return {
      tone: "danger",
      headline: "音量が小さすぎます",
      detail: "目標よりかなり小さく、視聴時に物足りなく感じやすい状態です。",
      pass: false,
    };
  }

  if (score < LOUDNESS_THRESHOLDS.x2) {
    return {
      tone: "warn",
      headline: "音量が小さめです",
      detail: "目標より少し小さめです。",
      pass: false,
    };
  }

  if (score <= 0) {
    return {
      tone: "ok",
      headline: "適切な範囲内です",
      detail: "目標に十分近く、自然に聞こえやすい状態です。",
      pass: true,
    };
  }

  if (score < LOUDNESS_THRESHOLDS.y1) {
    return {
      tone: "warn",
      headline: "音量が大きめです",
      detail: "目標より少し大きめです。",
      pass: false,
    };
  }

  return {
    tone: "danger",
    headline: "音量が大きすぎます",
    detail: "目標よりかなり大きく、聞き疲れやすくなる可能性があります。",
    pass: false,
  };
}

function evaluatePeak(score: number): Analysis["peak"] {
  if (score <= 0) {
    return {
      state: "ok",
      line: "最大音量は上限以内です",
      pass: true,
    };
  }

  if (score < PEAK_RED_THRESHOLD) {
    return {
      state: "tolerated",
      line: "多少大きいですが許容範囲内です",
      pass: true,
    };
  }

  return {
    state: "high",
    line: "最大音量が上限を大きく超えています",
    pass: false,
  };
}

function buildAnalysis(measured: { integratedLufs: number; truePeakDbtp: number }, target: LoudnessPlatform): Analysis {
  const loudnessScore = measured.integratedLufs - target.targetI;
  const peakScore = measured.truePeakDbtp - target.targetTP;
  const loudness = evaluateLoudness(loudnessScore);
  const peak = evaluatePeak(peakScore);
  const isPass = loudness.pass && peak.pass;

  let recommendation = "このまま公開しましょう。";
  if (!isPass) {
    if (!loudness.pass && !peak.pass) {
      recommendation = "音量を最適化したファイルを生成して、全体音量と最大音量をまとめて整えるのがおすすめです。";
    } else if (!loudness.pass) {
      recommendation =
        loudnessScore < 0
          ? `音量を最適化したファイルを生成して、音量を ${toFixed(Math.abs(loudnessScore))} ほど上げるのがおすすめです。`
          : `音量を最適化したファイルを生成して、音量を ${toFixed(Math.abs(loudnessScore))} ほど下げるのがおすすめです。`;
    } else {
      recommendation = "音量を最適化したファイルを生成して、最大音量を抑えるのがおすすめです。";
    }
  }

  return {
    isPass,
    loudnessScore,
    peakScore,
    loudness,
    peak,
    recommendation,
  };
}

function getStepState(currentStep: AnalyzeStep, stepKey: AnalyzeStep) {
  const order: AnalyzeStep[] = ["core", "file", "analyze"];
  const currentIndex = order.indexOf(currentStep);
  const stepIndex = order.indexOf(stepKey);

  if (currentIndex > stepIndex) return "done";
  if (currentIndex === stepIndex) return "active";
  return "wait";
}

function ScoreBox({ title, score, help, ok }: { title: string; score: number; help: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold tracking-wide text-slate-500">{title}</p>
      <p className={`mt-1 text-3xl font-black ${ok ? "text-emerald-700" : "text-amber-700"}`}>{signed(score)}</p>
      <p className="mt-1 text-xs text-slate-500">{help}</p>
    </div>
  );
}

function StatusLine({ status, text }: { status: "ok" | "warn" | "error"; text: string }) {
  const style =
    status === "ok"
      ? "text-emerald-700"
      : status === "warn"
        ? "text-amber-700"
        : "text-rose-700";
  const icon = status === "ok" ? "OK" : status === "warn" ? "!" : "NG";

  return (
    <p className={`flex items-center gap-2 text-sm ${style}`}>
      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-current px-1 text-[10px] font-black">
        {icon}
      </span>
      <span>{text}</span>
    </p>
  );
}

function ScoreCard({ title, analysis }: { title: string; analysis: Analysis }) {
  const style = TONE_STYLE[analysis.loudness.tone];
  const loudnessStatus = analysis.loudness.pass ? "ok" : analysis.loudness.tone === "warn" ? "warn" : "error";
  const peakStatus = analysis.peak.state === "high" ? "warn" : "ok";

  return (
    <section className={`rounded-2xl border p-4 ${style.panel}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-black text-slate-900">{title}</h3>
        <span className={`rounded-full border px-3 py-1 text-xs font-black ${style.badge}`}>
          {analysis.isPass ? "適切です" : "調整推奨"}
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className={`text-xl font-black ${style.headline}`}>{analysis.loudness.headline}</p>
        <p className="mt-1 text-sm text-slate-600">{analysis.loudness.detail}</p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ScoreBox title="音量スコア" score={analysis.loudnessScore} help="0に近いほどOK" ok={analysis.loudness.pass} />
        <ScoreBox title="最大音量スコア" score={analysis.peakScore} help="0以下が目安" ok={analysis.peak.pass} />
      </div>

      <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <StatusLine status={loudnessStatus} text={analysis.loudness.detail} />
        <StatusLine status={peakStatus} text={analysis.peak.line} />
      </div>

      <p className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
        {analysis.recommendation}
      </p>
    </section>
  );
}

function TechnicalDetails({
  analyzePayload,
  normalizePayload,
}: {
  analyzePayload: LoudnessAnalyzePayload | null;
  normalizePayload: LoudnessNormalizePayload | null;
}) {
  if (!analyzePayload) return null;

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-xs font-bold text-slate-600">編集ソフト向けの詳細</summary>

      <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
        <p>Integrated Loudness: {toFixed(analyzePayload.measured.integratedLufs)} LUFS</p>
        <p>True Peak: {toFixed(analyzePayload.measured.truePeakDbtp)} dBTP</p>
        <p>LRA: {toFixed(analyzePayload.measured.lra)} LU</p>
        <p>Threshold: {toFixed(analyzePayload.measured.threshold)} LUFS</p>
      </div>

      {normalizePayload ? (
        <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
          <p>After Loudness: {toFixed(normalizePayload.after.integratedLufs)} LUFS</p>
          <p>After True Peak: {toFixed(normalizePayload.after.truePeakDbtp)} dBTP</p>
        </div>
      ) : null}

      <pre className="mt-3 max-h-60 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-relaxed text-emerald-300">
        {JSON.stringify({ analyze: analyzePayload, normalize: normalizePayload || null }, null, 2)}
      </pre>
    </details>
  );
}

export default function LoudnessPage() {
  const [platforms] = useState(DEFAULT_PLATFORMS);
  const [selectedPlatform, setSelectedPlatform] = useState(getDefaultPlatformKey(DEFAULT_PLATFORMS));
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [measured, setMeasured] = useState<LoudnessAnalyzePayload["measured"] | null>(null);
  const [analyzePayload, setAnalyzePayload] = useState<LoudnessAnalyzePayload | null>(null);
  const [normalizeByPlatform, setNormalizeByPlatform] = useState<Record<string, LoudnessNormalizePayload>>({});
  const [loadingAnalyze, setLoadingAnalyze] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [analyzeStep, setAnalyzeStep] = useState<AnalyzeStep>("core");
  const [analyzeStatus, setAnalyzeStatus] = useState("音量を解析しています...");
  const [loadingNormalizeKey, setLoadingNormalizeKey] = useState("");
  const [normalizeProgress, setNormalizeProgress] = useState(0);
  const [normalizeStatus, setNormalizeStatus] = useState("ファイルを生成しています...");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationSectionRef = useRef<HTMLElement>(null);
  const normalizeUrlMapRef = useRef<Record<string, string>>({});

  const selectedTarget = useMemo(
    () => platforms.find((item) => item.key === selectedPlatform) || null,
    [platforms, selectedPlatform],
  );

  const platformOptions = useMemo(() => {
    const hasYoutube = platforms.some((item) => item.key === "youtube");
    return platforms
      .filter((item) => !(hasYoutube && item.key === "tiktok"))
      .map((item) => ({
        ...item,
        displayLabel: item.key === "youtube" || (!hasYoutube && item.key === "tiktok") ? "YouTube/TikTok" : item.label,
      }));
  }, [platforms]);

  const mediaKind = useMemo(() => detectMediaKind({ filename: mediaFile?.name, mimeType: mediaFile?.type }), [mediaFile]);
  const mediaLabel = getMediaLabel(mediaKind);

  const currentAnalysis = useMemo(() => {
    if (!measured || !selectedTarget) return null;
    return buildAnalysis(measured, selectedTarget);
  }, [measured, selectedTarget]);

  const normalizePayload = normalizeByPlatform[selectedPlatform] || null;

  const normalizedAnalysis = useMemo(() => {
    if (!normalizePayload || !selectedTarget) return null;
    return buildAnalysis(
      {
        integratedLufs: normalizePayload.after.integratedLufs,
        truePeakDbtp: normalizePayload.after.truePeakDbtp,
      },
      selectedTarget,
    );
  }, [normalizePayload, selectedTarget]);

  const clearNormalizeOutputs = useCallback(() => {
    Object.values(normalizeUrlMapRef.current).forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
    normalizeUrlMapRef.current = {};
    setNormalizeByPlatform({});
  }, []);

  useEffect(() => {
    if (!loadingNormalizeKey && !normalizePayload?.output) return;
    generationSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loadingNormalizeKey, normalizePayload]);

  useEffect(() => {
    return () => {
      Object.values(normalizeUrlMapRef.current).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, []);

  const runAnalyze = async (file: File) => {
    try {
      const analyzeTarget = selectedTarget || platforms[0];
      if (!analyzeTarget) throw new Error("プラットフォーム設定が見つかりません。");

      setError("");
      setLoadingAnalyze(true);
      setAnalyzeStep("core");
      setAnalyzeProgress(0.01);
      setAnalyzeStatus("アップロード完了。解析エンジンを起動しています...");
      clearNormalizeOutputs();

      await prepareLoudnessFfmpegEngine({
        onStatus: (text) => {
          setAnalyzeStep("core");
          setAnalyzeStatus(text);
        },
        onProgress: (value) => {
          setAnalyzeProgress(Math.max(0.02, Math.min(0.32, value * 0.32)));
        },
      });

      const data = await analyzeMediaLoudnessInBrowser({
        file,
        target: analyzeTarget,
        onProgress: (value) => {
          setAnalyzeProgress(Math.max(0.33, Math.min(1, 0.32 + value * 0.68)));
        },
        onStatus: (text) => {
          if (text.includes("ファイルを読み込")) {
            setAnalyzeStep("file");
          } else if (text.includes("解析")) {
            setAnalyzeStep("analyze");
          }
          setAnalyzeStatus(text);
        },
      });

      setAnalyzeStep("analyze");
      setAnalyzeStatus("解析が完了しました。");
      setAnalyzeProgress(1);
      setAnalyzePayload(data);
      setMeasured(data.measured);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析に失敗しました。");
      setAnalyzeStep("core");
      setAnalyzeProgress(0);
      setMeasured(null);
      setAnalyzePayload(null);
    } finally {
      setLoadingAnalyze(false);
    }
  };

  const onPickedFile = async (file: File | null) => {
    setMediaFile(file);

    if (!file) {
      setMeasured(null);
      setAnalyzePayload(null);
      setAnalyzeStep("core");
      setAnalyzeProgress(0);
      setAnalyzeStatus("音量を解析しています...");
      setNormalizeProgress(0);
      clearNormalizeOutputs();
      return;
    }

    await runAnalyze(file);
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    await onPickedFile(file);
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    const file = event.dataTransfer.files?.[0] || null;
    await onPickedFile(file);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
  };

  const onUploadKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const runNormalize = async () => {
    if (!mediaFile || !selectedPlatform || !selectedTarget) return;

    try {
      setError("");
      setLoadingNormalizeKey(selectedPlatform);
      setNormalizeProgress(0.02);
      setNormalizeStatus("解析エンジンを準備しています...");

      const data = await normalizeMediaLoudnessInBrowser({
        file: mediaFile,
        target: selectedTarget,
        onProgress: (value) => {
          setNormalizeProgress(Math.max(0.03, Math.min(1, value)));
        },
        onStatus: (text) => {
          setNormalizeStatus(text);
        },
      });

      const previousUrl = normalizeUrlMapRef.current[selectedPlatform];
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      if (data?.output?.downloadUrl) normalizeUrlMapRef.current[selectedPlatform] = data.output.downloadUrl;

      setNormalizeByPlatform((prev) => ({ ...prev, [selectedPlatform]: data }));
      setNormalizeProgress(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "正規化に失敗しました。");
      setNormalizeProgress(0);
    } finally {
      setLoadingNormalizeKey("");
    }
  };

  const uiPhase = loadingAnalyze ? "analyzing" : measured ? "analyzed" : "upload";

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_12%_0%,#dbeafe_0%,transparent_34%),radial-gradient(circle_at_84%_8%,#ccfbf1_0%,transparent_38%),#f3f6fb] px-4 py-8 text-[#172033]">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-teal-700">Abeam Tech Tools</p>
              <h1 className="mt-2 text-4xl font-black tracking-normal text-slate-900">ラウドネス</h1>
              <p className="mt-2 text-base font-bold text-slate-700">YouTube/TikTokに最適な音量を分析し、動画も音声も自動で音量調節</p>
              <p className="mt-1 text-sm text-slate-600">動画に加えて、MP3/WAVの音声ファイルもそのままの形式で書き出せます。</p>
            </div>
            <Link href="/" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600 transition hover:border-teal-300 hover:text-teal-700">
              ツール一覧へ
            </Link>
          </div>
        </header>

        <input ref={fileInputRef} type="file" accept="video/*,audio/*,.mp3,.wav" onChange={onFileChange} className="hidden" />

        {uiPhase === "upload" ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={onUploadKeyDown}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              className={`flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
                isDragActive ? "border-teal-500 bg-teal-50" : "border-slate-300 bg-slate-50 hover:border-teal-400 hover:bg-teal-50/70"
              }`}
            >
              <p className="text-lg font-black text-slate-900">ここに動画または音声ファイルをドラッグ&ドロップ</p>
              <p className="mt-1 text-sm text-slate-600">またはクリックしてファイルを選択</p>
              <p className="mt-2 text-xs text-slate-500">音声はMP3/WAVの書き出しに対応しています。</p>
            </div>

            {error ? <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
          </section>
        ) : null}

        {uiPhase === "analyzing" ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-lg font-black text-slate-900">解析中...</p>
            <p className="mt-1 text-sm text-slate-600">{analyzeStatus}</p>
            {mediaFile ? <p className="mt-1 text-xs text-slate-500">対象ファイル: {mediaFile.name}</p> : null}
            <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-teal-500 transition-all duration-300" style={{ width: `${Math.max(8, Math.round(analyzeProgress * 100))}%` }} />
            </div>
            <p className="mt-2 text-right text-xs font-bold text-slate-500">{Math.round(analyzeProgress * 100)}%</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {ANALYZE_STEPS.map((step) => {
                const state = getStepState(analyzeStep, step.key);
                const style =
                  state === "done"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : state === "active"
                      ? "border-teal-300 bg-teal-50 text-teal-700"
                      : "border-slate-200 bg-slate-50 text-slate-500";
                const icon = state === "done" ? "OK" : state === "active" ? "..." : "-";

                return (
                  <div key={step.key} className={`rounded-lg border px-3 py-2 text-xs font-bold ${style}`}>
                    {icon} {step.label}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {uiPhase === "analyzed" ? (
          <section className="space-y-4">
            {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-800">解析設定</p>
                  <p className="text-xs text-slate-600">
                    {selectedTarget
                      ? `${platformOptions.find((item) => item.key === selectedPlatform)?.displayLabel || selectedTarget.label} を表示中。ここを変えると書き出しの設定値も変わります。`
                      : "設定を選択してください。"}
                  </p>
                </div>
                <div className="w-44">
                  <select
                    value={selectedPlatform}
                    onChange={(event) => setSelectedPlatform(event.target.value)}
                    disabled={Boolean(loadingNormalizeKey)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none ring-teal-500 transition focus:ring-2"
                  >
                    {platformOptions.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.displayLabel}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
              >
                別のファイルをアップロード
              </button>
            </div>

            {currentAnalysis ? <ScoreCard title="解析結果" analysis={currentAnalysis} /> : null}

            <section ref={generationSectionRef} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={runNormalize}
                  disabled={Boolean(loadingNormalizeKey)}
                  className="inline-flex min-w-[280px] items-center justify-center rounded-xl border border-teal-700 bg-teal-700 px-6 py-3 text-base font-bold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingNormalizeKey ? "生成中..." : `音量を最適化した${mediaLabel}ファイルを生成`}
                </button>
              </div>

              {loadingNormalizeKey ? (
                <div className="mx-auto mt-4 max-w-md">
                  <p className="text-center text-sm font-bold text-slate-700">{normalizeStatus}</p>
                  <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-teal-500 transition-all duration-300" style={{ width: `${Math.max(8, Math.round(normalizeProgress * 100))}%` }} />
                  </div>
                </div>
              ) : null}
            </section>

            {normalizedAnalysis ? <ScoreCard title="書き出し後" analysis={normalizedAnalysis} /> : null}

            {normalizePayload?.output ? (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-center text-sm font-bold text-emerald-800">生成が完了しました。下のボタンからダウンロードできます。</p>
                {normalizePayload.note ? <p className="mt-2 text-center text-xs font-bold text-emerald-700">{normalizePayload.note}</p> : null}
                <div className="mt-3 flex justify-center">
                  <a
                    href={normalizePayload.output.downloadUrl}
                    download={normalizePayload.output.filename}
                    className="inline-flex min-w-[220px] items-center justify-center rounded-xl border border-emerald-300 bg-emerald-100 px-6 py-3 text-base font-bold text-emerald-800 transition hover:bg-emerald-200"
                  >
                    ダウンロード
                  </a>
                </div>
              </section>
            ) : null}

            <TechnicalDetails analyzePayload={analyzePayload} normalizePayload={normalizePayload} />
          </section>
        ) : null}

        <footer className="pb-2 pt-4 text-center">
          <a href={X_PROFILE_URL} target="_blank" rel="noreferrer" className="text-sm font-bold text-slate-600 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900">
            X: @okamoto_yuma_
          </a>
        </footer>
      </div>
    </main>
  );
}
