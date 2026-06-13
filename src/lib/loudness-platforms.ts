export type LoudnessPlatform = {
  key: string;
  label: string;
  targetI: number;
  targetTP: number;
  targetLRA: number;
  tolerance: number;
};

export const LOUDNESS_PLATFORM_TARGETS = {
  youtube: { label: "YouTube", targetI: -14, targetTP: -1.0, targetLRA: 11, tolerance: 1.0 },
  tiktok: { label: "TikTok", targetI: -14, targetTP: -1.0, targetLRA: 11, tolerance: 1.0 },
  instagram: { label: "Instagram Reels", targetI: -14, targetTP: -1.0, targetLRA: 11, tolerance: 1.0 },
  x: { label: "X (Twitter)", targetI: -16, targetTP: -1.0, targetLRA: 11, tolerance: 1.0 },
  podcast: { label: "Podcast / Voice", targetI: -16, targetTP: -1.0, targetLRA: 7, tolerance: 1.0 },
} satisfies Record<string, Omit<LoudnessPlatform, "key">>;

export function listLoudnessPlatforms(): LoudnessPlatform[] {
  return Object.entries(LOUDNESS_PLATFORM_TARGETS).map(([key, value]) => ({ key, ...value }));
}

export function getLoudnessPlatformTarget(key: string): LoudnessPlatform | null {
  const target = LOUDNESS_PLATFORM_TARGETS[key as keyof typeof LOUDNESS_PLATFORM_TARGETS];
  return target ? { key, ...target } : null;
}
