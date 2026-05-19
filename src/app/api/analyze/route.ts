import { NextResponse } from "next/server";
import { analyzeHtml } from "../../../lib/seo-analyzer";
import type { AnalyzeResponse } from "../../../lib/seo-types";

const REQUEST_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 2_000_000;

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
        "user-agent": "SEOCheckerBot/1.0 (+https://localhost)",
      },
    });

    const contentType = response.headers.get("content-type") ?? "";
    const html = await readLimitedText(response);

    if (!/html|xml|text/i.test(contentType) && !html.trim().startsWith("<")) {
      return json({ ok: false, error: "HTMLページとして取得できませんでした。" }, 415);
    }

    const finalUrl = response.url || targetUrl.toString();
    const robotsTxt = await fetchRobots(finalUrl);
    const report = analyzeHtml({
      requestedUrl: targetUrl.toString(),
      finalUrl,
      statusCode: response.status,
      contentType,
      html,
      robotsTxt,
    });

    return json({ ok: true, report });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "ページ取得がタイムアウトしました。"
      : "ページを取得できませんでした。URLを確認してください。";
    return json({ ok: false, error: message }, 500);
  }
}

function json(payload: AnalyzeResponse, status = 200) {
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

async function readLimitedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (received < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
    }
  }

  return new TextDecoder().decode(concatChunks(chunks, Math.min(received, MAX_HTML_BYTES)));
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
      signal: AbortSignal.timeout(4000),
      headers: { "user-agent": "SEOCheckerBot/1.0 (+https://localhost)" },
    });
    if (!response.ok) return "";
    return (await response.text()).slice(0, 50_000);
  } catch {
    return "";
  }
}
