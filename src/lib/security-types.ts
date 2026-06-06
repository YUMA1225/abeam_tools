export type CheckStatus = "pass" | "warn" | "fail" | "info";

export type SecurityCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  value?: string;
  recommendation: string;
  weight: number;
};

export type SecurityCategoryKey = "ssl" | "browser" | "cms" | "server" | "client" | "formDomain";

export type ProbeResult = {
  id: string;
  url: string;
  status: number;
  ok: boolean;
  redirected: boolean;
  contentType: string;
  headers: Record<string, string>;
  bodySnippet: string;
};

export type SecurityCategory = {
  key: SecurityCategoryKey;
  label: string;
  score: number;
  summary: string;
  checks: SecurityCheck[];
};

export type SecurityReport = {
  url: string;
  finalUrl: string;
  checkedAt: string;
  statusCode: number;
  contentType: string;
  score: number;
  grade: string;
  coverage: {
    publicPathsChecked: number;
    unavailablePaths: number;
    clientScriptsChecked: number;
    sourceMapsChecked: number;
    optionsChecked: boolean;
  };
  categories: SecurityCategory[];
};

export type SecurityAnalyzeResponse =
  | {
      ok: true;
      report: SecurityReport;
    }
  | {
      ok: false;
      error: string;
    };
