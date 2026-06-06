import type {
  CheckStatus,
  ProbeResult,
  SecurityCategory,
  SecurityCategoryKey,
  SecurityCheck,
  SecurityReport,
} from "./security-types";

type AnalyzeInput = {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  html: string;
  headers: Record<string, string>;
  robotsTxt?: string;
  probes?: ProbeResult[];
  httpRedirect?: {
    status: number;
    location: string;
    finalUrl: string;
    redirectedToHttps: boolean;
  } | null;
  dns?: {
    spf: string[];
    dmarc: string[];
    mx: string[];
  };
  optionsMethods?: string;
};

const CATEGORY_LABELS: Record<SecurityCategoryKey, string> = {
  ssl: "SSL・HTTPS",
  browser: "ブラウザ保護設定",
  cms: "WordPress・CMS設定",
  server: "サーバー公開情報",
  formDomain: "フォーム・ドメイン信頼性",
};

const SENSITIVE_PROBES = new Set(["env", "git-head", "debug-log", "wp-config"]);

export function analyzeSecurityHtml(input: AnalyzeInput): SecurityReport {
  const { html, finalUrl, headers } = input;
  const url = new URL(finalUrl);
  const requestedUrl = new URL(input.requestedUrl);
  const probes = input.probes ?? [];
  const wordpress = detectWordPress(html, probes);
  const forms = getForms(html, finalUrl);
  const dns = input.dns ?? { spf: [], dmarc: [], mx: [] };
  const robotsTxt = input.robotsTxt ?? "";
  const title = getTitle(html);
  const canonical = getLink(html, "canonical");

  const serverHeader = header(headers, "server");
  const poweredBy = header(headers, "x-powered-by");
  const hsts = header(headers, "strict-transport-security");
  const csp = header(headers, "content-security-policy");
  const xFrame = header(headers, "x-frame-options");
  const xContent = header(headers, "x-content-type-options");
  const referrer = header(headers, "referrer-policy");
  const permissions = header(headers, "permissions-policy");
  const coop = header(headers, "cross-origin-opener-policy");
  const corp = header(headers, "cross-origin-resource-policy");
  const cacheControl = header(headers, "cache-control");

  const wpLogin = probeById(probes, "wp-login");
  const wpXmlRpc = probeById(probes, "xmlrpc");
  const wpUsers = probeById(probes, "wp-users");
  const wpUploads = probeById(probes, "wp-uploads");
  const wpReadme = probeById(probes, "readme");
  const wpInstall = probeById(probes, "wp-install");
  const exposedSensitive = probes.filter((probe) => SENSITIVE_PROBES.has(probe.id) && isExposedProbe(probe));
  const directoryListings = probes.filter((probe) => isDirectoryListing(probe));
  const adminPages = probes.filter((probe) => ["admin", "login"].includes(probe.id) && isProbablyAccessibleHtml(probe));
  const mixedContent = getMixedContent(html);

  const categories: SecurityCategory[] = [
    category("ssl", [
      check("https", "HTTPS表示", url.protocol === "https:" ? "pass" : "fail", url.protocol === "https:" ? "HTTPSで表示されています" : "HTTPで表示されています", "公開サイトはHTTPSで配信してください。", 5),
      check(
        "http-redirect",
        "HTTPからHTTPSへの転送",
        input.httpRedirect?.redirectedToHttps ? "pass" : url.protocol === "https:" ? "warn" : "fail",
        input.httpRedirect ? `${input.httpRedirect.status} ${input.httpRedirect.location || input.httpRedirect.finalUrl || "Locationなし"}` : "HTTP側の確認ができませんでした",
        "http:// でアクセスされた場合も https:// に転送されるよう設定してください。",
        4,
      ),
      check("status", "ページ取得ステータス", input.statusCode >= 200 && input.statusCode < 400 ? "pass" : "fail", `HTTP ${input.statusCode}`, "正常なステータスでトップページを返すよう確認してください。", 2),
      check("www", "wwwあり/なしの統一", isHostUnified(requestedUrl, url) ? "pass" : "warn", `${requestedUrl.hostname} -> ${url.hostname}`, "wwwあり/なしのどちらかに統一すると重複URLを避けられます。", 2),
      check("mixed-content", "mixed content", mixedContent.length === 0 ? "pass" : "warn", mixedContent.length === 0 ? "HTTP読み込みは検出されませんでした" : `${mixedContent.length}件のHTTP読み込み候補`, mixedContent.join("\n"), "HTTPSページ内の http:// 読み込みを https:// に変更してください。", 3),
    ]),
    category("browser", [
      headerCheck("hsts", "HSTS", hsts, "Strict-Transport-Securityを設定するとHTTPS利用をブラウザに強制できます。", 4),
      headerCheck("x-frame", "クリックジャッキング対策", xFrame, "X-Frame-Options または CSP frame-ancestors を設定してください。", csp.includes("frame-ancestors") ? 0 : 3, csp.includes("frame-ancestors")),
      headerCheck("csp", "CSP", csp, "Content-Security-Policyを設定するとXSS等の影響を抑えられます。", 3),
      check("x-content-type", "MIMEタイプ保護", /nosniff/i.test(xContent) ? "pass" : "warn", xContent || "未設定", "X-Content-Type-Options: nosniff を設定してください。", 2),
      headerCheck("referrer", "Referrer-Policy", referrer, "Referrer-Policyで外部送信される参照元情報を制御してください。", 2),
      headerCheck("permissions", "Permissions-Policy", permissions, "カメラ・マイク・位置情報などの利用可否を明示してください。", 2),
      headerCheck("coop", "Cross-Origin-Opener-Policy", coop, "必要に応じてCross-Origin-Opener-Policyを設定してください。", 1),
      headerCheck("corp", "Cross-Origin-Resource-Policy", corp, "必要に応じてCross-Origin-Resource-Policyを設定してください。", 1),
      headerCheck("cache", "Cache-Control", cacheControl, "フォームや会員ページでは個人情報がキャッシュされないよう制御してください。", 1),
    ]),
    category(
      "cms",
      wordpress.detected
        ? [
            check("wp-detected", "WordPress利用判定", "warn", wordpress.detail, "WordPress固有の公開設定を確認します。", 0),
            check("wp-login", "/wp-login.php露出", isProbablyAccessibleHtml(wpLogin) ? "warn" : "pass", probeDetail(wpLogin, "ログイン画面は確認されませんでした"), "デフォルトログインURLの露出を抑えるか、追加認証・WAF・IP制限を検討してください。", 3),
            check("xmlrpc", "XML-RPC", isProbablyAccessible(wpXmlRpc) ? "warn" : "pass", probeDetail(wpXmlRpc, "XML-RPCは有効に見えません"), "XML-RPCを利用していない場合は無効化してください。", 3),
            check("wp-version", "WordPressバージョン露出", getWordPressVersion(html) ? "warn" : "pass", getWordPressVersion(html) || "バージョン露出は検出されませんでした", "HTMLやRSSからWordPressバージョンが見えないようにしてください。", 2),
            check("wp-users", "REST APIユーザー露出", isProbablyAccessible(wpUsers) && /"slug"|"name"|\[/.test(wpUsers?.bodySnippet ?? "") ? "fail" : "pass", probeDetail(wpUsers, "ユーザー一覧は確認されませんでした"), "REST APIでユーザー一覧が公開されないよう制御してください。", 3),
            check("wp-uploads", "uploads一覧表示", isDirectoryListing(wpUploads) ? "fail" : "pass", probeDetail(wpUploads, "uploadsの一覧表示は確認されませんでした"), "uploadsディレクトリの一覧表示を無効化してください。", 3),
            check("readme", "readme.html露出", isProbablyAccessibleHtml(wpReadme) ? "warn" : "pass", probeDetail(wpReadme, "readme.htmlは確認されませんでした"), "不要なreadme.htmlは公開しないようにしてください。", 1),
            check("wp-install", "install.php露出", isProbablyAccessibleHtml(wpInstall) ? "fail" : "pass", probeDetail(wpInstall, "install.phpは公開されていません"), "インストール画面が見える場合は直ちに閉じてください。", 3),
          ]
        : [
            check("wp-not-detected", "WordPress利用判定", "pass", "WordPressは検出されませんでした。WordPress固有の公開リスクは確認対象外のため、減点なしとしています。", "対象外項目は採点上100点扱いです。", 5),
            check("cms-risk", "WordPress固有リスク", "pass", "対象外（満点扱い）", "WordPressを導入した場合はログイン画面・XML-RPC・バージョン露出を確認してください。", 5),
          ],
    ),
    category("server", [
      check("server-header", "Serverヘッダー露出", serverHeader && hasVersionLikeSignal(serverHeader) ? "warn" : "pass", serverHeader || "未設定または非公開", "製品名やバージョンが出る場合は最小限にしてください。", 2),
      check("powered-by", "X-Powered-By露出", poweredBy ? "warn" : "pass", poweredBy || "未設定", "X-Powered-Byは削除を推奨します。", 2),
      check("options", "不要なHTTPメソッド", allowedMethods(input.optionsMethods), input.optionsMethods || "Allowヘッダーは未取得（危険メソッドは確認されませんでした）", "不要なメソッドが有効でないかサーバー側で確認してください。", 2),
      check("directory-listing", "ディレクトリ一覧", directoryListings.length > 0 ? "fail" : "pass", directoryListings.length > 0 ? directoryListings.map((item) => `${item.url} (${item.status})`).join("\n") : "代表URLで一覧表示は確認されませんでした", "ディレクトリ一覧表示を無効化してください。", 3),
      check("sensitive-files", ".env / .git / 設定ファイル露出", exposedSensitive.length > 0 ? "fail" : "pass", exposedSensitive.length > 0 ? exposedSensitive.map((item) => `${item.url} (${item.status})`).join("\n") : "代表的な機密ファイル露出は確認されませんでした", "機密ファイルが公開されている場合は直ちに非公開化してください。", 5),
      check("admin-pages", "管理系URL露出", adminPages.length > 0 ? "warn" : "pass", adminPages.length > 0 ? adminPages.map((item) => `${item.url} (${item.status})`).join("\n") : "代表URLでは管理画面の露出は確認されませんでした", "管理画面には追加認証、IP制限、WAFを検討してください。", 2),
      check("robots", "robots.txtの情報量", hasSensitiveRobots(robotsTxt) ? "warn" : "pass", robotsTxt ? summarizeRobots(robotsTxt) : "robots.txtは未取得または未設定", "robots.txtに管理画面や重要パスを書きすぎないよう注意してください。", 1),
    ]),
    category("formDomain", [
      check("forms", "問い合わせフォーム", forms.total > 0 ? "pass" : "info", forms.total > 0 ? `${forms.total}件のフォームを検出` : "フォームは検出されませんでした（対象外・減点なし）", "個人情報を扱うフォームがある場合は送信先と保護設定を確認してください。", forms.total > 0 ? 2 : 0),
      check("form-action", "フォーム送信先HTTPS", forms.insecureActions === 0 ? "pass" : "fail", forms.total > 0 ? `${forms.insecureActions}件のHTTP送信先` : "対象外（満点扱い）", "フォームのactionはHTTPSにしてください。", forms.total > 0 ? 4 : 0),
      check("privacy", "プライバシーポリシー導線", forms.total === 0 || hasPrivacyLink(html) ? "pass" : "warn", hasPrivacyLink(html) ? "プライバシーポリシーへのリンクを検出" : "フォーム周辺の導線は未確認", "個人情報入力フォームの近くにプライバシーポリシー導線を置いてください。", forms.total > 0 ? 2 : 0),
      check("spam", "スパム対策", forms.total === 0 || hasSpamProtection(html) ? "pass" : "warn", hasSpamProtection(html) ? "reCAPTCHA等の候補を検出" : forms.total > 0 ? "スパム対策の候補は未検出" : "対象外（満点扱い）", "reCAPTCHA、Turnstile、honeypot等のスパム対策を検討してください。", forms.total > 0 ? 2 : 0),
      check("spf", "SPF設定", dns.spf.length > 0 ? "pass" : "warn", dns.spf.join("\n") || "SPFレコードは確認できませんでした", "メール送信に使うドメインではSPFを設定してください。", 2),
      check("dmarc", "DMARC設定", dns.dmarc.length > 0 ? "pass" : "warn", dns.dmarc.join("\n") || "DMARCレコードは確認できませんでした", "なりすましメール対策としてDMARCを設定してください。", 2),
      check("mx", "MXレコード", dns.mx.length > 0 ? "pass" : "info", dns.mx.join("\n") || "MXレコードは確認できませんでした", "メールを利用するドメインではMXとメール認証を合わせて確認してください。", dns.mx.length > 0 ? 1 : 0),
      check("canonical", "canonical設定", canonical ? "pass" : "info", canonical || "未設定", "canonicalは信頼性とURL正規化の補助になります。", canonical ? 1 : 0),
      check("site-identity", "favicon/サイト名", title || hasFavicon(html) ? "pass" : "warn", [title ? `title: ${title}` : "", hasFavicon(html) ? "favicon候補あり" : ""].filter(Boolean).join(" / ") || "サイト名・favicon候補なし", "サイト名とfaviconは利用者の信頼性判断に影響します。", 1),
    ]),
  ];

  const score = getScore(categories.flatMap((item) => item.checks));

  return {
    url: input.requestedUrl,
    finalUrl,
    checkedAt: new Date().toISOString(),
    statusCode: input.statusCode,
    contentType: input.contentType,
    score,
    grade: getGrade(score),
    categories,
  };
}

function category(key: SecurityCategoryKey, checks: SecurityCheck[]): SecurityCategory {
  const score = getScore(checks);
  const failed = checks.filter((item) => item.status === "fail").length;
  const warned = checks.filter((item) => item.status === "warn").length;

  return {
    key,
    label: CATEGORY_LABELS[key],
    score,
    summary: failed > 0 ? `${failed}件の重要な改善項目があります。` : warned > 0 ? `${warned}件の注意項目があります。` : "主要項目は良好です。",
    checks,
  };
}

function check(id: string, label: string, status: CheckStatus, detail: string, valueOrRecommendation: string, recommendationOrWeight: string | number, weightMaybe?: number): SecurityCheck {
  const hasValue = typeof weightMaybe === "number";
  const value = hasValue ? valueOrRecommendation : "";
  const recommendation = hasValue ? String(recommendationOrWeight) : valueOrRecommendation;
  const weight = hasValue ? weightMaybe : Number(recommendationOrWeight);
  return { id, label, status, detail, value, recommendation, weight };
}

function headerCheck(id: string, label: string, value: string, recommendation: string, weight = 2, passWhen = false): SecurityCheck {
  if (passWhen) return check(id, label, "pass", value || "代替設定を検出", "", weight);
  return check(id, label, value ? "pass" : "warn", value || "未設定", recommendation, weight);
}

function getScore(checks: SecurityCheck[]): number {
  const scoredChecks = checks.filter((item) => item.weight > 0);
  const total = scoredChecks.reduce((sum, item) => sum + item.weight, 0);
  if (total === 0) return 100;
  const current = scoredChecks.reduce((sum, item) => {
    if (item.status === "pass" || item.status === "info") return sum + item.weight;
    if (item.status === "warn") return sum + item.weight * 0.5;
    return sum;
  }, 0);
  return Math.round((current / total) * 100);
}

function getGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "E";
}

function header(headers: Record<string, string>, name: string): string {
  return headers[name.toLowerCase()] ?? "";
}

function probeById(probes: ProbeResult[], id: string): ProbeResult | undefined {
  return probes.find((probe) => probe.id === id);
}

function probeDetail(probe: ProbeResult | undefined, fallback: string): string {
  if (!probe) return fallback;
  return `${probe.status} ${probe.url}`;
}

function isHostUnified(requestedUrl: URL, finalUrl: URL): boolean {
  return requestedUrl.hostname.replace(/^www\./, "") === finalUrl.hostname.replace(/^www\./, "");
}

function getMixedContent(html: string): string[] {
  const urls = Array.from(html.matchAll(/\b(?:src|href|action)=["'](http:\/\/[^"']+)["']/gi)).map((match) => decodeText(match[1]));
  return Array.from(new Set(urls)).slice(0, 12);
}

function detectWordPress(html: string, probes: ProbeResult[]) {
  const signals: string[] = [];
  if (/wp-content|wp-includes|wp-json/i.test(html)) signals.push("HTML内にwp-content/wp-json等を検出");
  const generator = getMeta(html, "name", "generator");
  if (/wordpress/i.test(generator)) signals.push(`generator: ${generator}`);
  if (isProbablyAccessible(probeById(probes, "wp-json"))) signals.push("/wp-json/ が応答");
  if (isProbablyAccessibleHtml(probeById(probes, "wp-login"))) signals.push("/wp-login.php が応答");
  return { detected: signals.length > 0, detail: signals.join(" / ") || "WordPressシグナルなし" };
}

function getWordPressVersion(html: string): string {
  const generator = getMeta(html, "name", "generator");
  if (/wordpress/i.test(generator)) return generator;
  const match = html.match(/wp-(?:includes|content)\/[^"']+\?ver=([0-9][^"']*)/i);
  return match ? `ver=${match[1]}` : "";
}

function isProbablyAccessible(probe: ProbeResult | undefined): boolean {
  return Boolean(probe && probe.status >= 200 && probe.status < 400);
}

function isProbablyAccessibleHtml(probe: ProbeResult | undefined): boolean {
  return Boolean(isProbablyAccessible(probe) && /html|text/i.test(probe?.contentType ?? ""));
}

function isExposedProbe(probe: ProbeResult): boolean {
  if (!isProbablyAccessible(probe)) return false;
  if (probe.id === "env") return /APP_KEY|DB_PASSWORD|DATABASE_URL|SECRET|TOKEN|AWS_/i.test(probe.bodySnippet);
  if (probe.id === "git-head") return /^ref: refs\/heads\//i.test(probe.bodySnippet.trim());
  if (probe.id === "debug-log") return /PHP|WordPress|stack trace|fatal error/i.test(probe.bodySnippet);
  if (probe.id === "wp-config") return /DB_NAME|DB_PASSWORD|ABSPATH/i.test(probe.bodySnippet);
  return false;
}

function isDirectoryListing(probe: ProbeResult | undefined): boolean {
  if (!probe || !isProbablyAccessible(probe)) return false;
  return /Index of|Directory Listing|Parent Directory/i.test(probe.bodySnippet);
}

function hasVersionLikeSignal(value: string): boolean {
  return /\/\d|\d+\.\d+|php|apache|nginx|express|openresty/i.test(value);
}

function allowedMethods(methods = ""): CheckStatus {
  return /trace|track/i.test(methods) ? "fail" : "pass";
}

function hasSensitiveRobots(robotsTxt: string): boolean {
  return /wp-admin|admin|login|private|backup|\.env|\.git|config/i.test(robotsTxt);
}

function summarizeRobots(robotsTxt: string): string {
  const lines = robotsTxt.split(/\r?\n/).filter((line) => line.trim()).slice(0, 8);
  return lines.join("\n") || "robots.txtは空です";
}

function getForms(html: string, finalUrl: string) {
  const tags = html.match(/<form\b[^>]*>/gi) ?? [];
  const base = new URL(finalUrl);
  let insecureActions = 0;

  for (const tag of tags) {
    const action = getAttr(tag, "action");
    if (!action) continue;
    try {
      const parsed = new URL(action, base);
      if (parsed.protocol === "http:") insecureActions += 1;
    } catch {
      // Invalid action values are not treated as external HTTP sends.
    }
  }

  return { total: tags.length, insecureActions };
}

function hasPrivacyLink(html: string): boolean {
  return /privacy|プライバシー|個人情報|個人情報保護/i.test(html);
}

function hasSpamProtection(html: string): boolean {
  return /recaptcha|grecaptcha|turnstile|hcaptcha|honeypot|captcha/i.test(html);
}

function hasFavicon(html: string): boolean {
  return /<link\b[^>]*rel=["'][^"']*(?:icon|shortcut icon)/i.test(html);
}

function getTitle(html: string): string {
  return decodeText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
}

function getMeta(html: string, attrName: string, attrValue: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const tag = tags.find((item) => getAttr(item, attrName).toLowerCase() === attrValue.toLowerCase());
  return decodeText(getAttr(tag ?? "", "content")).trim();
}

function getLink(html: string, rel: string): string {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  const tag = tags.find((item) => getAttr(item, "rel").toLowerCase().split(/\s+/).includes(rel.toLowerCase()));
  return decodeText(getAttr(tag ?? "", "href")).trim();
}

function getAttr(tag: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function decodeText(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}
