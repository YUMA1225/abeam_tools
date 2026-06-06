import { NextResponse } from "next/server";
import { analyzeSecurityHtml } from "../../../lib/security-analyzer";
import type { ProbeResult, SecurityAnalyzeResponse } from "../../../lib/security-types";

const REQUEST_TIMEOUT_MS = 12000;
const PROBE_TIMEOUT_MS = 4500;
const MAX_HTML_BYTES = 2_000_000;
const MAX_PROBE_BYTES = 80_000;

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const rawUrl = typeof body === "object" && body && "url" in body ? String(body.url) : "";
    const targetUrl = normalizeUrl(rawUrl);

    if (!targetUrl) {
      return json({ ok: false, error: "URLを入力してください。" }, 400);
    }

    if (isBlockedHost(targetUrl.hostname)) {
      return json({ ok: false, error: "localhostやプライベートネットワークのURLは診断できません。" }, 400);
    }

    const response = await fetch(targetUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "SecurityCheckerBot/1.0 (+https://localhost)",
      },
    });

    const contentType = response.headers.get("content-type") ?? "";
    const html = await readLimitedText(response, MAX_HTML_BYTES);

    if (!/html|xml|text/i.test(contentType) && !html.trim().startsWith("<")) {
      return json({ ok: false, error: "HTMLページとして取得できませんでした。" }, 415);
    }

    const finalUrl = response.url || targetUrl.toString();
    const [robotsTxt, probes, httpRedirect, dns, optionsMethods] = await Promise.all([
      fetchRobots(finalUrl),
      fetchSecurityProbes(finalUrl),
      fetchHttpRedirect(targetUrl),
      fetchDnsSummary(new URL(finalUrl).hostname),
      fetchOptionsMethods(finalUrl),
    ]);

    const report = analyzeSecurityHtml({
      requestedUrl: targetUrl.toString(),
      finalUrl,
      statusCode: response.status,
      contentType,
      html,
      headers: headersToObject(response.headers),
      robotsTxt,
      probes,
      httpRedirect,
      dns,
      optionsMethods,
    });

    return json({ ok: true, report });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "ページ取得がタイムアウトしました。"
      : "ページを取得できませんでした。URLを確認してください。";
    return json({ ok: false, error: message }, 500);
  }
}

function json(payload: SecurityAnalyzeResponse, status = 200) {
  return NextResponse.json(payload, { status });
}

function normalizeUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, maxBytes);

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
    }
  }

  return new TextDecoder().decode(concatChunks(chunks, Math.min(received, maxBytes)));
}

function concatChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.slice(0, Math.max(0, size - offset));
    merged.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= size) break;
  }
  return merged;
}

async function fetchRobots(finalUrl: string): Promise<string> {
  try {
    const url = new URL(finalUrl);
    if (isBlockedHost(url.hostname)) return "";
    const robotsUrl = new URL("/robots.txt", url.origin);
    const response = await fetch(robotsUrl, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": "SecurityCheckerBot/1.0 (+https://localhost)" },
    });
    if (!response.ok) return "";
    return (await response.text()).slice(0, 50_000);
  } catch {
    return "";
  }
}

async function fetchHttpRedirect(targetUrl: URL): Promise<AnalyzeRedirect | null> {
  if (targetUrl.protocol !== "https:") return null;

  try {
    const httpUrl = new URL(targetUrl.toString());
    httpUrl.protocol = "http:";
    const response = await fetch(httpUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": "SecurityCheckerBot/1.0 (+https://localhost)" },
    });
    const location = response.headers.get("location") ?? "";
    const resolved = location ? new URL(location, httpUrl).toString() : response.url;
    return {
      status: response.status,
      location,
      finalUrl: resolved,
      redirectedToHttps: response.status >= 300 && response.status < 400 && resolved.startsWith("https://"),
    };
  } catch {
    return null;
  }
}

type AnalyzeRedirect = {
  status: number;
  location: string;
  finalUrl: string;
  redirectedToHttps: boolean;
};

async function fetchSecurityProbes(finalUrl: string): Promise<ProbeResult[]> {
  const base = new URL(finalUrl);
  const paths = [
    ["wp-json", "/wp-json/"],
    ["wp-login", "/wp-login.php"],
    ["wp-admin", "/wp-admin/"],
    ["xmlrpc", "/xmlrpc.php"],
    ["wp-users", "/wp-json/wp/v2/users"],
    ["wp-uploads", "/wp-content/uploads/"],
    ["readme", "/readme.html"],
    ["wp-install", "/wp-admin/install.php"],
    ["debug-log", "/wp-content/debug.log"],
    ["wp-config", "/wp-config.php"],
    ["wp-plugins", "/wp-content/plugins/"],
    ["env", "/.env"],
    ["git-head", "/.git/HEAD"],
    ["images", "/images/"],
    ["uploads", "/uploads/"],
    ["admin", "/admin/"],
    ["login", "/login/"],
    ["backup-zip", "/backup.zip"],
  ] as const;

  const results = await Promise.all(paths.map(([id, path]) => probeUrl(id, new URL(path, base).toString())));
  return results.filter((result): result is ProbeResult => Boolean(result));
}

async function probeUrl(id: string, url: string): Promise<ProbeResult | null> {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        accept: "text/html,text/plain,application/json,*/*;q=0.8",
        "user-agent": "SecurityCheckerBot/1.0 (+https://localhost)",
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const shouldRead = response.status >= 200 && response.status < 400 && /html|text|json|xml|javascript/i.test(contentType);
    const bodySnippet = shouldRead ? await readLimitedText(response, MAX_PROBE_BYTES) : "";
    return {
      id,
      url,
      status: response.status,
      ok: response.ok,
      redirected: response.status >= 300 && response.status < 400,
      contentType,
      headers: headersToObject(response.headers),
      bodySnippet,
    };
  } catch {
    return null;
  }
}

async function fetchOptionsMethods(finalUrl: string): Promise<string> {
  try {
    const response = await fetch(finalUrl, {
      method: "OPTIONS",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": "SecurityCheckerBot/1.0 (+https://localhost)" },
    });
    return response.headers.get("allow") ?? response.headers.get("access-control-allow-methods") ?? "";
  } catch {
    return "";
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

async function fetchDnsSummary(hostname: string): Promise<{ spf: string[]; dmarc: string[]; mx: string[] }> {
  const domain = getRegistrableDomain(hostname);
  const [txt, dmarc, mx] = await Promise.all([
    resolveDns(domain, "TXT"),
    resolveDns(`_dmarc.${domain}`, "TXT"),
    resolveDns(domain, "MX"),
  ]);

  return {
    spf: txt.filter((record) => /v=spf1/i.test(record)),
    dmarc: dmarc.filter((record) => /v=dmarc1/i.test(record)),
    mx,
  };
}

async function resolveDns(name: string, type: "TXT" | "MX"): Promise<string[]> {
  try {
    const url = new URL("https://dns.google/resolve");
    url.searchParams.set("name", name);
    url.searchParams.set("type", type);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { accept: "application/dns-json" },
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { Answer?: Array<{ data?: string }> };
    return (payload.Answer ?? []).map((answer) => answer.data ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

function getRegistrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  const lastThree = parts.slice(-3).join(".");
  if (/^(co|ne|or|ac|go|lg|ed)\.jp$/.test(lastTwo)) return lastThree;
  return lastTwo;
}
