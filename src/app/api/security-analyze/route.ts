import { NextResponse } from "next/server";
import { getDomain } from "tldts";
import { analyzeSecurityHtml } from "../../../lib/security-analyzer";
import { isNonPublicIp } from "../../../lib/network-safety";
import type { ProbeResult, SecurityAnalyzeResponse } from "../../../lib/security-types";

const REQUEST_TIMEOUT_MS = 12000;
const PROBE_TIMEOUT_MS = 4500;
const MAX_HTML_BYTES = 2_000_000;
const MAX_PROBE_BYTES = 96_000;
const MAX_SCRIPT_BYTES = 240_000;
const MAX_REDIRECTS = 5;
const MAX_PROBE_REQUESTS = 52;
const MAX_PROBE_CONCURRENCY = 3;
const MAX_CLIENT_SCRIPTS = 8;
const MAX_SOURCE_MAPS = 5;
const PROBE_DELAY_MS = 150;
const MAX_API_BODY_BYTES = 16_384;
const MAX_URL_LENGTH = 2_048;
const TARGET_COOLDOWN_MS = 20_000;
const MAX_TRACKED_TARGETS = 500;
const SCANNER_USER_AGENT = "AbeamSecurityChecker/2.2 (read-only; +https://abeam.tech/)";
const recentTargetScans = new Map<string, number>();

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_API_BODY_BYTES) {
      return json({ ok: false, error: "リクエストが大きすぎます。" }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(await readLimitedRequestText(request, MAX_API_BODY_BYTES));
    } catch {
      return json({ ok: false, error: "リクエスト形式が不正です。" }, 400);
    }
    const rawUrl = typeof body === "object" && body && "url" in body ? String(body.url) : "";
    const targetUrl = normalizeUrl(rawUrl);

    if (!targetUrl) {
      return json({ ok: false, error: "URLを入力してください。" }, 400);
    }

    if (isBlockedHost(targetUrl.hostname)) {
      return json({ ok: false, error: "localhostやプライベートネットワークのURLは診断できません。" }, 400);
    }
    if (!reserveTargetScan(targetUrl.hostname)) {
      return json({ ok: false, error: "同じホストへの連続診断を抑制しています。20秒ほど待ってから再度お試しください。" }, 429);
    }

    const response = await fetchPublicPage(targetUrl, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": SCANNER_USER_AGENT,
      },
    });

    const contentType = response.headers.get("content-type") ?? "";
    const html = await readLimitedText(response, MAX_HTML_BYTES);

    if (!/html|xml|text/i.test(contentType) && !html.trim().startsWith("<")) {
      return json({ ok: false, error: "HTMLページとして取得できませんでした。" }, 415);
    }

    const finalUrl = response.url || targetUrl.toString();
    const [robotsTxt, probes, httpRedirect, dns, cors, httpMethods] = await Promise.all([
      fetchRobots(finalUrl),
      fetchSecurityProbes(finalUrl, html),
      fetchHttpRedirect(targetUrl),
      fetchDnsSummary(new URL(finalUrl).hostname),
      fetchCorsPolicy(finalUrl),
      fetchHttpMethods(finalUrl),
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
      setCookies: getSetCookies(response.headers),
      cors,
      httpMethods,
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
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (hasDisallowedPort(url)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

async function readLimitedRequestText(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received <= maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Request body too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concatChunks(chunks, received));
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  return isNonPublicIp(host);
}

function reserveTargetScan(hostname: string): boolean {
  const now = Date.now();
  const key = hostname.toLowerCase();
  const previous = recentTargetScans.get(key) ?? 0;
  if (now - previous < TARGET_COOLDOWN_MS) return false;

  recentTargetScans.set(key, now);
  if (recentTargetScans.size > MAX_TRACKED_TARGETS) {
    for (const [host, timestamp] of recentTargetScans) {
      if (now - timestamp >= TARGET_COOLDOWN_MS) recentTargetScans.delete(host);
      if (recentTargetScans.size <= MAX_TRACKED_TARGETS) break;
    }
  }
  return true;
}

async function fetchPublicPage(targetUrl: URL, init: RequestInit): Promise<Response> {
  let currentUrl = new URL(targetUrl);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicUrl(currentUrl);
    const response = await fetch(currentUrl, { ...init, method: "GET", redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects === MAX_REDIRECTS) throw new Error("Too many redirects");

    await response.body?.cancel();
    currentUrl = new URL(location, currentUrl);
  }

  throw new Error("Too many redirects");
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || hasDisallowedPort(url) || isBlockedHost(url.hostname)) {
    throw new Error("Blocked URL");
  }

  const addresses = await resolveHostAddresses(url.hostname);
  if (addresses.length === 0) throw new Error("Unable to verify public address");
  if (addresses.some(isNonPublicIp)) throw new Error("Blocked private address");
}

function hasDisallowedPort(url: URL): boolean {
  return (url.protocol === "https:" && Boolean(url.port) && url.port !== "443")
    || (url.protocol === "http:" && Boolean(url.port) && url.port !== "80");
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) return [hostname];

  try {
    const url = new URL("https://dns.google/resolve");
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", "A");
    const ipv6Url = new URL(url);
    ipv6Url.searchParams.set("type", "AAAA");

    const [ipv4, ipv6] = await Promise.all([
      fetchDnsAnswers(url),
      fetchDnsAnswers(ipv6Url),
    ]);
    return [...ipv4, ...ipv6];
  } catch {
    return [];
  }
}

async function fetchDnsAnswers(url: URL): Promise<string[]> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    headers: { accept: "application/dns-json" },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { Answer?: Array<{ type?: number; data?: string }> };
  return (payload.Answer ?? [])
    .filter((answer) => answer.type === 1 || answer.type === 28)
    .map((answer) => answer.data ?? "")
    .filter(Boolean);
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

  if (received >= maxBytes) await reader.cancel().catch(() => undefined);
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
    await assertPublicUrl(robotsUrl);
    const response = await fetch(robotsUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": SCANNER_USER_AGENT },
    });
    if (!response.ok) return "";
    return await readLimitedText(response, 50_000);
  } catch {
    return "";
  }
}

async function fetchHttpRedirect(targetUrl: URL): Promise<AnalyzeRedirect | null> {
  if (targetUrl.protocol !== "https:") return null;

  try {
    const httpUrl = new URL(targetUrl.toString());
    httpUrl.protocol = "http:";
    await assertPublicUrl(httpUrl);
    let response = await fetch(httpUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": SCANNER_USER_AGENT },
    });
    if (response.status === 405 || response.status === 501) {
      await response.body?.cancel().catch(() => undefined);
      response = await fetch(httpUrl, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: { "user-agent": SCANNER_USER_AGENT },
      });
    }
    const location = response.headers.get("location") ?? "";
    const resolved = location ? new URL(location, httpUrl).toString() : response.url;
    const result = {
      status: response.status,
      location,
      finalUrl: resolved,
      redirectedToHttps: response.status >= 300 && response.status < 400 && resolved.startsWith("https://"),
    };
    await response.body?.cancel().catch(() => undefined);
    return result;
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

async function fetchSecurityProbes(finalUrl: string, html: string): Promise<ProbeResult[]> {
  const base = new URL(finalUrl);
  await assertPublicUrl(base);
  const notFoundPath = `/.security-checker-not-found-${crypto.randomUUID()}`;
  const fixedPaths = [
    ["not-found-baseline", notFoundPath],
    ["security-txt-well-known", "/.well-known/security.txt"],
    ["security-txt-root", "/security.txt"],
    ["wp-json", "/wp-json/"],
    ["wp-login", "/wp-login.php"],
    ["xmlrpc", "/xmlrpc.php"],
    ["wp-users", "/wp-json/wp/v2/users"],
    ["wp-uploads", "/wp-content/uploads/"],
    ["ds-store", "/.DS_Store"],
    ["wp-install", "/wp-admin/install.php"],
    ["debug-log", "/wp-content/debug.log"],
    ["wp-config", "/wp-config.php"],
    ["env", "/.env"],
    ["env-local", "/.env.local"],
    ["env-production", "/.env.production"],
    ["git-head", "/.git/HEAD"],
    ["git-config", "/.git/config"],
    ["git-index", "/.git/index"],
    ["svn-entries", "/.svn/entries"],
    ["backup-zip", "/backup.zip"],
    ["database-sql", "/database.sql"],
    ["dump-sql", "/dump.sql"],
    ["phpinfo", "/phpinfo.php"],
    ["server-status", "/server-status"],
    ["actuator-env", "/actuator/env"],
    ["actuator-configprops", "/actuator/configprops"],
    ["debug-vars", "/debug/vars"],
    ["env-backup", "/.env.bak"],
    ["npmrc", "/.npmrc"],
    ["htpasswd", "/.htpasswd"],
    ["docker-compose", "/docker-compose.yml"],
    ["appsettings", "/appsettings.json"],
    ["web-config-backup", "/web.config.bak"],
    ["config-php-backup", "/config.php.bak"],
    ["credentials-json", "/credentials.json"],
    ["wp-config-backup", "/wp-config.php.bak"],
    ["backup-tar", "/backup.tar.gz"],
    ["api-docs-openapi", "/openapi.json"],
    ["api-docs-swagger", "/swagger.json"],
  ] as const;
  const clientScriptTargets = getClientScriptUrls(html, base).map((url, index) => [`client-script-${index}`, url] as const);
  const fixedRequestBudget = MAX_PROBE_REQUESTS - MAX_SOURCE_MAPS - MAX_CLIENT_SCRIPTS;
  const initialTargets = [
    ...fixedPaths.slice(0, fixedRequestBudget).map(([id, path]) => [id, new URL(path, base).toString()] as const),
    ...clientScriptTargets,
  ];

  const initialResults = await mapWithConcurrency(initialTargets, MAX_PROBE_CONCURRENCY, ([id, url]) => probeUrl(id, url));
  const sourceMapTargets = getSourceMapUrls(initialResults, base).map((url, index) => [`source-map-${index}`, url] as const);
  const remainingBudget = Math.max(0, MAX_PROBE_REQUESTS - initialTargets.length);
  const sourceMapResults = await mapWithConcurrency(
    sourceMapTargets.slice(0, remainingBudget),
    MAX_PROBE_CONCURRENCY,
    ([id, url]) => probeUrl(id, url),
  );

  return [...initialResults, ...sourceMapResults];
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
      if (nextIndex < items.length) await delay(PROBE_DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function getClientScriptUrls(html: string, base: URL): string[] {
  const tags = html.match(/<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi) ?? [];
  const urls: string[] = [];

  for (const tag of tags) {
    const src = getHtmlAttr(tag, "src");
    if (!src) continue;
    try {
      const scriptUrl = new URL(src, base);
      if (scriptUrl.origin !== base.origin || !/\.m?js$/i.test(scriptUrl.pathname)) continue;
      urls.push(scriptUrl.toString());
    } catch {
      // Invalid script URLs are ignored.
    }
  }

  return Array.from(new Set(urls))
    .sort((left, right) => clientScriptPriority(right) - clientScriptPriority(left))
    .slice(0, MAX_CLIENT_SCRIPTS);
}

function getSourceMapUrls(probes: ProbeResult[], base: URL): string[] {
  const urls: string[] = [];
  for (const probe of probes.filter((item) => item.id.startsWith("client-script-"))) {
    try {
      const scriptUrl = new URL(probe.url);
      const guessed = new URL(scriptUrl);
      guessed.pathname = `${guessed.pathname}.map`;
      guessed.search = "";
      guessed.hash = "";
      urls.push(guessed.toString());

      const sourceMappingUrl = Array.from(probe.bodySnippet.matchAll(/[#@]\s*sourceMappingURL\s*=\s*([^\s*]+)/g)).at(-1)?.[1];
      if (sourceMappingUrl && !sourceMappingUrl.startsWith("data:")) {
        const declared = new URL(sourceMappingUrl, scriptUrl);
        if (declared.origin === base.origin) urls.push(declared.toString());
      }
    } catch {
      // Invalid source map URLs are ignored.
    }
  }
  return Array.from(new Set(urls)).slice(0, MAX_SOURCE_MAPS);
}

function getHtmlAttr(tag: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

async function probeUrl(id: string, url: string): Promise<ProbeResult> {
  try {
    const maxBytes = id.startsWith("client-script-") || id.startsWith("source-map-") ? MAX_SCRIPT_BYTES : MAX_PROBE_BYTES;
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        accept: "text/html,text/plain,application/json,*/*;q=0.8",
        range: `bytes=0-${maxBytes - 1}`,
        "user-agent": SCANNER_USER_AGENT,
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const shouldRead = response.status >= 200
      && response.status < 500
      && !(response.status >= 300 && response.status < 400)
      && /html|text|json|xml|javascript/i.test(contentType);
    const shouldReadBinary = ["git-index", "ds-store"].includes(id) && response.status >= 200 && response.status < 300;
    const bodySnippet = shouldRead || shouldReadBinary ? await readLimitedText(response, maxBytes) : "";
    if (!shouldRead && !shouldReadBinary) await response.body?.cancel().catch(() => undefined);
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
    return {
      id,
      url,
      status: 0,
      ok: false,
      redirected: false,
      contentType: "",
      headers: {},
      bodySnippet: "",
    };
  }
}

async function fetchCorsPolicy(finalUrl: string): Promise<{ checked: boolean; allowOrigin: string; allowCredentials: string; vary: string }> {
  try {
    const response = await fetchPublicPage(new URL(finalUrl), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        accept: "text/html,application/xhtml+xml",
        origin: "https://security-checker.invalid",
        "user-agent": SCANNER_USER_AGENT,
      },
    });
    const result = {
      checked: true,
      allowOrigin: response.headers.get("access-control-allow-origin") ?? "",
      allowCredentials: response.headers.get("access-control-allow-credentials") ?? "",
      vary: response.headers.get("vary") ?? "",
    };
    await response.body?.cancel().catch(() => undefined);
    return result;
  } catch {
    return { checked: false, allowOrigin: "", allowCredentials: "", vary: "" };
  }
}

async function fetchHttpMethods(finalUrl: string): Promise<{ checked: boolean; status: number; allow: string }> {
  try {
    const url = new URL(finalUrl);
    await assertPublicUrl(url);
    const response = await fetch(url, {
      method: "OPTIONS",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        accept: "*/*",
        origin: "https://security-checker.invalid",
        "access-control-request-method": "GET",
        "user-agent": SCANNER_USER_AGENT,
      },
    });
    const result = {
      checked: true,
      status: response.status,
      allow: response.headers.get("allow") ?? response.headers.get("access-control-allow-methods") ?? "",
    };
    await response.body?.cancel().catch(() => undefined);
    return result;
  } catch {
    return { checked: false, status: 0, allow: "" };
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function getSetCookies(headers: Headers): string[] {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extendedHeaders.getSetCookie === "function") {
    return extendedHeaders.getSetCookie();
  }
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/) : [];
}

async function fetchDnsSummary(hostname: string): Promise<{ spf: string[]; dmarc: string[]; mx: string[]; caa: string[]; ds: string[]; mtaSts: string[]; tlsRpt: string[] }> {
  const domain = getRegistrableDomain(hostname);
  const [txt, dmarc, mx, caa, ds, mtaSts, tlsRpt] = await Promise.all([
    resolveDns(domain, "TXT"),
    resolveDns(`_dmarc.${domain}`, "TXT"),
    resolveDns(domain, "MX"),
    resolveDns(domain, "CAA"),
    resolveDns(domain, "DS"),
    resolveDns(`_mta-sts.${domain}`, "TXT"),
    resolveDns(`_smtp._tls.${domain}`, "TXT"),
  ]);

  return {
    spf: txt.filter((record) => /v=spf1/i.test(record)),
    dmarc: dmarc.filter((record) => /v=dmarc1/i.test(record)),
    mx,
    caa,
    ds,
    mtaSts: mtaSts.filter((record) => /v=stsv1/i.test(record)),
    tlsRpt: tlsRpt.filter((record) => /v=tlsrptv1/i.test(record)),
  };
}

async function resolveDns(name: string, type: "TXT" | "MX" | "CAA" | "DS"): Promise<string[]> {
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
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname.toLowerCase();
}

function clientScriptPriority(value: string): number {
  const pathname = new URL(value).pathname.toLowerCase();
  let score = 0;
  if (/(?:^|[-/.])(?:app|main|page|index|client)(?:[-/.]|$)/.test(pathname)) score += 5;
  if (/chunks?|bundle/.test(pathname)) score += 2;
  if (/webpack|runtime|polyfill|framework/.test(pathname)) score -= 4;
  return score;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
