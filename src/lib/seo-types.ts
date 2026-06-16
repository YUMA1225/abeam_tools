export type CheckStatus = "pass" | "warn" | "fail" | "info";

export type SeoCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  value?: string;
  recommendation: string;
  weight: number;
};

export type SeoCategoryKey =
  | "basic"
  | "ogp"
  | "structured"
  | "technical"
  | "meo"
  | "aio";

export type SeoCategory = {
  key: SeoCategoryKey;
  label: string;
  score: number;
  summary: string;
  checks: SeoCheck[];
};

export type HeadingItem = {
  level: number;
  text: string;
};

export type LinkSummary = {
  total: number;
  internal: number;
  external: number;
  nofollow: number;
};

export type HeadingCounts = {
  h2: number;
  h3: number;
  h4: number;
  h5: number;
  h6: number;
};

export type ImageSummary = {
  total: number;
  missingAlt: number;
  missingAltSources: string[];
};

export type PageSnapshot = {
  title: string;
  description: string;
  canonical: string;
  h1: string[];
  headings: HeadingItem[];
  images: ImageSummary;
  links: LinkSummary;
  wordCount: number;
  textLength: number;
  paragraphCount: number;
  headingCounts: HeadingCounts;
  jsonLdCount: number;
};

export type SeoReport = {
  url: string;
  finalUrl: string;
  checkedAt: string;
  statusCode: number;
  contentType: string;
  score: number;
  grade: string;
  snapshot: PageSnapshot;
  categories: SeoCategory[];
};

export type AnalyzeResponse =
  | {
      ok: true;
      report: SeoReport;
    }
  | {
      ok: false;
      error: string;
    };
