import type { LoudnessPlatform } from "@/lib/loudness-platforms";
import { buildAudioOutputPlan, detectMediaKind, getFileExtension, parseAudioProfileFromLog } from "@/lib/loudness-media";

type ProgressCallback = (value: number) => void;
type StatusCallback = (text: string) => void;
type FfmpegModule = typeof import("@ffmpeg/ffmpeg");
type FfmpegUtilModule = typeof import("@ffmpeg/util");
type FfmpegInstance = InstanceType<FfmpegModule["FFmpeg"]>;

export type LoudnessAnalyzePayload = {
  mediaKind: "audio" | "video";
  platform: LoudnessPlatform;
  filename: string;
  measured: {
    integratedLufs: number;
    truePeakDbtp: number;
    lra: number;
    threshold: number;
  };
  target: {
    integratedLufs: number;
    truePeakDbtp: number;
    lra: number;
    toleranceLufs: number;
  };
  adjustmentNeededLufs: number;
  isInRange: boolean;
  raw: Record<string, unknown>;
};

export type LoudnessNormalizePayload = {
  message: string;
  mediaKind: "audio" | "video";
  platform: LoudnessPlatform;
  before: {
    integratedLufs: number;
    truePeakDbtp: number;
    lra: number;
  };
  after: {
    integratedLufs: number;
    truePeakDbtp: number;
    lra: number;
  };
  output: {
    filename: string;
    downloadUrl: string;
    mimeType: string;
    sizeBytes: number;
  };
  note: string;
};

type InternalAnalysis = {
  raw: Record<string, unknown>;
  inputI: number;
  inputTP: number;
  inputLRA: number;
  inputThresh: number;
  targetOffset: number;
  delta: number;
  audioProfile: ReturnType<typeof parseAudioProfileFromLog>;
};

const CORE_VERSION = "0.12.9";
const CORE_BASE_URLS = [
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
];

let ffmpegInstance: FfmpegInstance | null = null;
let ffmpegModulesPromise: Promise<[FfmpegModule, FfmpegUtilModule]> | null = null;
let ffmpegLoadPromise: Promise<void> | null = null;
let activeProgressCallback: ProgressCallback | null = null;
let activeLogBuffer: string[] | null = null;

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "-inf") return -99;
  if (normalized === "inf" || normalized === "+inf") return 99;

  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizeBaseName(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename || "video";
  return base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "video";
}

function makeUniqueId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function parseLoudnormJson(logText: string) {
  const matches = [...logText.matchAll(/\{\s*"input_i"[\s\S]*?\}/gm)];
  const latest = matches[matches.length - 1];
  if (!latest) throw new Error("解析結果の取得に失敗しました。");
  return JSON.parse(latest[0]) as Record<string, unknown>;
}

function toBlobPart(data: Awaited<ReturnType<FfmpegInstance["readFile"]>>): BlobPart {
  if (typeof data === "string") return data;

  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

async function getFfmpegModules() {
  if (!ffmpegModulesPromise) {
    ffmpegModulesPromise = Promise.all([import("@ffmpeg/ffmpeg"), import("@ffmpeg/util")]);
  }
  return ffmpegModulesPromise;
}

async function getFfmpeg(onStatus?: StatusCallback) {
  const [{ FFmpeg }, { toBlobURL }] = await getFfmpegModules();

  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg();
    ffmpegInstance.on("progress", ({ progress }) => {
      activeProgressCallback?.(Math.max(0, Math.min(1, Number(progress) || 0)));
    });
    ffmpegInstance.on("log", ({ message }) => {
      activeLogBuffer?.push(String(message || ""));
    });
  }

  if (ffmpegInstance.loaded) return ffmpegInstance;

  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      onStatus?.("解析エンジンを読み込んでいます...");

      let lastError: unknown = null;
      for (const baseUrl of CORE_BASE_URLS) {
        try {
          const coreURL = await toBlobURL(`${baseUrl}/ffmpeg-core.js`, "text/javascript");
          const wasmURL = await toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, "application/wasm");
          await ffmpegInstance?.load({ coreURL, wasmURL });
          return;
        } catch (error) {
          lastError = error;
        }
      }

      const message = lastError instanceof Error ? lastError.message : "unknown";
      throw new Error(`解析エンジンの読み込みに失敗しました。ネットワーク設定をご確認ください。 (${message})`);
    })();
  }

  try {
    await ffmpegLoadPromise;
  } catch (error) {
    ffmpegLoadPromise = null;
    throw error;
  }

  return ffmpegInstance;
}

export function isLoudnessFfmpegReady() {
  return Boolean(ffmpegInstance?.loaded);
}

export async function prepareLoudnessFfmpegEngine({
  onStatus,
  onProgress,
}: {
  onStatus?: StatusCallback;
  onProgress?: ProgressCallback;
} = {}) {
  if (isLoudnessFfmpegReady()) {
    onStatus?.("解析エンジンの準備ができました。");
    onProgress?.(1);
    return;
  }

  onStatus?.("解析エンジンを読み込んでいます...");

  let timerId: ReturnType<typeof setInterval> | null = null;
  let pseudoProgress = 0;

  if (onProgress) {
    onProgress(0.02);
    timerId = setInterval(() => {
      pseudoProgress = Math.min(0.9, pseudoProgress + 0.03);
      onProgress(pseudoProgress);
    }, 160);
  }

  try {
    await getFfmpeg(onStatus);
  } finally {
    if (timerId) clearInterval(timerId);
  }

  onProgress?.(1);
}

async function safeDeleteFile(ffmpeg: FfmpegInstance, fileName: string) {
  if (!fileName) return;
  try {
    await ffmpeg.deleteFile(fileName);
  } catch {
    // FFmpeg FS cleanup is best-effort.
  }
}

async function runExecWithCapture(ffmpeg: FfmpegInstance, args: string[], onProgress?: ProgressCallback) {
  const logs: string[] = [];
  activeLogBuffer = logs;
  activeProgressCallback = onProgress || null;

  try {
    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}`);
  } finally {
    activeLogBuffer = null;
    activeProgressCallback = null;
  }

  return logs;
}

async function analyzeInput(ffmpeg: FfmpegInstance, inputFileName: string, target: LoudnessPlatform, onProgress?: ProgressCallback): Promise<InternalAnalysis> {
  const analyzeFilter = `loudnorm=I=${target.targetI}:TP=${target.targetTP}:LRA=${target.targetLRA}:print_format=json`;
  const logs = await runExecWithCapture(ffmpeg, ["-hide_banner", "-i", inputFileName, "-vn", "-af", analyzeFilter, "-f", "null", "-"], onProgress);

  const logText = logs.join("\n");
  const raw = parseLoudnormJson(logText);
  const inputI = toNumber(raw.input_i);
  const inputTP = toNumber(raw.input_tp);
  const inputLRA = toNumber(raw.input_lra);
  const inputThresh = toNumber(raw.input_thresh);
  const targetOffset = toNumber(raw.target_offset);
  const delta = target.targetI - inputI;

  return {
    raw,
    inputI,
    inputTP,
    inputLRA,
    inputThresh,
    targetOffset,
    delta,
    audioProfile: parseAudioProfileFromLog(logText),
  };
}

function buildNormalizeFilter(target: LoudnessPlatform, analysis: InternalAnalysis) {
  return [
    `loudnorm=I=${target.targetI}`,
    `TP=${target.targetTP}`,
    `LRA=${target.targetLRA}`,
    `measured_I=${analysis.inputI}`,
    `measured_TP=${analysis.inputTP}`,
    `measured_LRA=${analysis.inputLRA}`,
    `measured_thresh=${analysis.inputThresh}`,
    `offset=${analysis.targetOffset}`,
    "linear=true",
    "print_format=summary",
  ].join(":");
}

async function encodeNormalizedVideo(ffmpeg: FfmpegInstance, inputFileName: string, outputBaseName: string, filter: string, onProgress?: ProgressCallback) {
  const mp4Name = `${outputBaseName}.mp4`;

  try {
    await runExecWithCapture(
      ffmpeg,
      ["-hide_banner", "-y", "-i", inputFileName, "-af", filter, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", mp4Name],
      onProgress,
    );
    return { outputFileName: mp4Name, mimeType: "video/mp4", note: "" };
  } catch {
    const mkvName = `${outputBaseName}.mkv`;
    await runExecWithCapture(ffmpeg, ["-hide_banner", "-y", "-i", inputFileName, "-af", filter, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", mkvName], onProgress);
    return {
      outputFileName: mkvName,
      mimeType: "video/x-matroska",
      note: "入力ファイルの形式に合わせてMKVで書き出しました。",
    };
  }
}

async function encodeNormalizedAudio(
  ffmpeg: FfmpegInstance,
  inputFileName: string,
  outputBaseName: string,
  filter: string,
  source: { filename: string; mimeType: string; audioProfile: InternalAnalysis["audioProfile"] },
  onProgress?: ProgressCallback,
) {
  const outputPlan = buildAudioOutputPlan(source);
  if (!outputPlan) throw new Error("この音声形式の書き出しにはまだ対応していません。MP3またはWAVをお試しください。");

  const outputFileName = `${outputBaseName}.${outputPlan.extension}`;
  await runExecWithCapture(ffmpeg, ["-hide_banner", "-y", "-i", inputFileName, "-af", filter, ...outputPlan.ffmpegArgs, outputFileName], onProgress);

  return {
    outputFileName,
    mimeType: outputPlan.mimeType,
    note: outputPlan.note,
  };
}

async function encodeNormalizedMedia(
  ffmpeg: FfmpegInstance,
  inputFileName: string,
  outputBaseName: string,
  filter: string,
  source: { filename: string; mimeType: string; audioProfile: InternalAnalysis["audioProfile"] },
  onProgress?: ProgressCallback,
) {
  if (detectMediaKind(source) === "audio") return encodeNormalizedAudio(ffmpeg, inputFileName, outputBaseName, filter, source, onProgress);
  return encodeNormalizedVideo(ffmpeg, inputFileName, outputBaseName, filter, onProgress);
}

export async function analyzeMediaLoudnessInBrowser({
  file,
  target,
  onProgress,
  onStatus,
}: {
  file: File;
  target: LoudnessPlatform;
  onProgress?: ProgressCallback;
  onStatus?: StatusCallback;
}): Promise<LoudnessAnalyzePayload> {
  if (!file) throw new Error("ファイルを選択してください。");
  if (!target) throw new Error("プラットフォーム設定が見つかりません。");

  const ffmpeg = await getFfmpeg(onStatus);
  const [, { fetchFile }] = await getFfmpegModules();
  const mediaKind = detectMediaKind({ filename: file.name, mimeType: file.type });
  const inputFileName = `input-${makeUniqueId()}.${getFileExtension(file.name, mediaKind === "audio" ? "mp3" : "mp4")}`;

  try {
    onStatus?.("ファイルを読み込んでいます...");
    await ffmpeg.writeFile(inputFileName, await fetchFile(file));

    onStatus?.("音量を解析しています...");
    onProgress?.(0.08);
    const analysis = await analyzeInput(ffmpeg, inputFileName, target, (value) => {
      onProgress?.(0.08 + value * 0.92);
    });
    onProgress?.(1);

    return {
      mediaKind,
      platform: target,
      filename: file.name,
      measured: {
        integratedLufs: analysis.inputI,
        truePeakDbtp: analysis.inputTP,
        lra: analysis.inputLRA,
        threshold: analysis.inputThresh,
      },
      target: {
        integratedLufs: target.targetI,
        truePeakDbtp: target.targetTP,
        lra: target.targetLRA,
        toleranceLufs: target.tolerance,
      },
      adjustmentNeededLufs: Number(analysis.delta.toFixed(2)),
      isInRange: Math.abs(analysis.delta) <= target.tolerance,
      raw: analysis.raw,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    throw new Error(`解析中にエラー: ${message}`);
  } finally {
    await safeDeleteFile(ffmpeg, inputFileName);
  }
}

export async function normalizeMediaLoudnessInBrowser({
  file,
  target,
  onProgress,
  onStatus,
}: {
  file: File;
  target: LoudnessPlatform;
  onProgress?: ProgressCallback;
  onStatus?: StatusCallback;
}): Promise<LoudnessNormalizePayload> {
  if (!file) throw new Error("ファイルを選択してください。");
  if (!target) throw new Error("プラットフォーム設定が見つかりません。");

  const ffmpeg = await getFfmpeg(onStatus);
  const [, { fetchFile }] = await getFfmpegModules();
  const mediaKind = detectMediaKind({ filename: file.name, mimeType: file.type });
  const uniqueId = makeUniqueId();
  const inputFileName = `normalize-input-${uniqueId}.${getFileExtension(file.name, mediaKind === "audio" ? "mp3" : "mp4")}`;
  const outputBaseName = `${sanitizeBaseName(file.name)}-${target.key}-normalized-${uniqueId}`;
  let encodedOutputFileName = "";

  try {
    onStatus?.("ファイルを読み込んでいます...");
    await ffmpeg.writeFile(inputFileName, await fetchFile(file));

    onStatus?.("書き出し前の音量を解析しています...");
    onProgress?.(0.05);
    const before = await analyzeInput(ffmpeg, inputFileName, target, (value) => {
      onProgress?.(0.05 + value * 0.25);
    });

    onStatus?.("音量を最適化したファイルを生成しています...");
    const filter = buildNormalizeFilter(target, before);
    const encoded = await encodeNormalizedMedia(
      ffmpeg,
      inputFileName,
      outputBaseName,
      filter,
      {
        filename: file.name,
        mimeType: file.type,
        audioProfile: before.audioProfile,
      },
      (value) => {
        onProgress?.(0.3 + value * 0.55);
      },
    );
    encodedOutputFileName = encoded.outputFileName;

    onStatus?.("書き出し後の音量を確認しています...");
    const after = await analyzeInput(ffmpeg, encodedOutputFileName, target, (value) => {
      onProgress?.(0.85 + value * 0.15);
    });
    onProgress?.(1);

    const outputData = await ffmpeg.readFile(encodedOutputFileName);
    const outputBlob = new Blob([toBlobPart(outputData)], { type: encoded.mimeType });
    const downloadUrl = URL.createObjectURL(outputBlob);

    return {
      message: "正規化が完了しました。",
      mediaKind,
      platform: target,
      before: {
        integratedLufs: before.inputI,
        truePeakDbtp: before.inputTP,
        lra: before.inputLRA,
      },
      after: {
        integratedLufs: after.inputI,
        truePeakDbtp: after.inputTP,
        lra: after.inputLRA,
      },
      output: {
        filename: encodedOutputFileName,
        downloadUrl,
        mimeType: encoded.mimeType,
        sizeBytes: outputBlob.size,
      },
      note: encoded.note,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    throw new Error(`正規化中にエラー: ${message}`);
  } finally {
    await safeDeleteFile(ffmpeg, inputFileName);
    await safeDeleteFile(ffmpeg, encodedOutputFileName);
  }
}
