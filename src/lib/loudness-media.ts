export type MediaKind = "audio" | "video";

export type AudioProfile = {
  codec: string | null;
  sampleRate: number | null;
  bitrateKbps: number | null;
  channelCount: number | null;
};

export type AudioOutputPlan = {
  extension: string;
  mimeType: string;
  ffmpegArgs: string[];
  note: string;
};

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi"]);

function inferChannelCount(descriptor: string) {
  const normalized = descriptor.toLowerCase();
  const channelLayouts: Array<[string, number]> = [
    ["mono", 1],
    ["stereo", 2],
    ["2.1", 3],
    ["3.0", 3],
    ["3.1", 4],
    ["quad", 4],
    ["4.0", 4],
    ["4.1", 5],
    ["5.0", 5],
    ["5.1", 6],
    ["6.1", 7],
    ["7.1", 8],
  ];

  for (const [label, count] of channelLayouts) {
    if (normalized.includes(label)) return count;
  }

  const channelMatch = normalized.match(/,\s*(\d+)\s*channels?\b/);
  return channelMatch ? Number(channelMatch[1]) : null;
}

function appendCommonAudioArgs(args: string[], audioProfile: AudioProfile | null) {
  const nextArgs = [...args];

  if (audioProfile?.sampleRate) nextArgs.push("-ar", String(audioProfile.sampleRate));
  if (audioProfile?.channelCount) nextArgs.push("-ac", String(audioProfile.channelCount));

  return nextArgs;
}

export function getFileExtension(filename: string, fallback = "") {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= -1 || dotIndex === filename.length - 1) return fallback.toLowerCase();
  return filename.slice(dotIndex + 1).toLowerCase();
}

export function detectMediaKind({ filename = "", mimeType = "" }: { filename?: string; mimeType?: string } = {}): MediaKind {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";

  const extension = getFileExtension(filename);
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";

  return "video";
}

export function getMediaLabel(kind: MediaKind) {
  return kind === "audio" ? "音声" : "動画";
}

export function parseAudioProfileFromLog(logText: string): AudioProfile | null {
  const matches = [...logText.matchAll(/Stream #\d+:\d+(?:\[[^\]]+\])?(?:\([^)]+\))?: Audio: ([^\n]+)/g)];
  const descriptor = matches[0]?.[1];

  if (!descriptor) return null;

  const codec = descriptor.match(/^([^\s,(]+)/)?.[1]?.toLowerCase() || null;
  const sampleRate = descriptor.match(/,\s*(\d+)\s*Hz\b/)?.[1];
  const bitrateKbps = descriptor.match(/,\s*(\d+)\s*kb\/s\b/)?.[1];

  return {
    codec,
    sampleRate: sampleRate ? Number(sampleRate) : null,
    bitrateKbps: bitrateKbps ? Number(bitrateKbps) : null,
    channelCount: inferChannelCount(descriptor),
  };
}

export function buildAudioOutputPlan({
  filename = "",
  mimeType = "",
  audioProfile = null,
}: {
  filename?: string;
  mimeType?: string;
  audioProfile?: AudioProfile | null;
} = {}): AudioOutputPlan | null {
  const extension = getFileExtension(filename);
  const normalizedMimeType = mimeType.toLowerCase();

  if (
    extension === "wav" ||
    normalizedMimeType === "audio/wav" ||
    normalizedMimeType === "audio/x-wav" ||
    normalizedMimeType === "audio/wave" ||
    normalizedMimeType === "audio/x-pn-wav"
  ) {
    const codec = audioProfile?.codec?.startsWith("pcm_") ? audioProfile.codec : "pcm_s16le";
    return {
      extension: "wav",
      mimeType: "audio/wav",
      ffmpegArgs: appendCommonAudioArgs(["-vn", "-c:a", codec], audioProfile),
      note: "",
    };
  }

  if (
    extension === "mp3" ||
    normalizedMimeType === "audio/mpeg" ||
    normalizedMimeType === "audio/mp3" ||
    normalizedMimeType === "audio/x-mp3"
  ) {
    const args = ["-vn", "-c:a", "libmp3lame"];
    if (audioProfile?.bitrateKbps) args.push("-b:a", `${audioProfile.bitrateKbps}k`);

    return {
      extension: "mp3",
      mimeType: "audio/mpeg",
      ffmpegArgs: appendCommonAudioArgs(args, audioProfile),
      note: "",
    };
  }

  return null;
}
