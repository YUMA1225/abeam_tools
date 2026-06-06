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
    caa?: string[];
    ds?: string[];
    mtaSts?: string[];
    tlsRpt?: string[];
  };
  setCookies?: string[];
  cors?: {
    checked: boolean;
    allowOrigin: string;
    allowCredentials: string;
    vary: string;
  };
  httpMethods?: {
    checked: boolean;
    status: number;
    allow: string;
  };
};

const CATEGORY_LABELS: Record<SecurityCategoryKey, string> = {
  ssl: "HTTPS・通信",
  browser: "ブラウザ保護設定",
  cms: "WordPress・CMS設定",
  server: "サーバー公開情報",
  client: "クライアントコード",
  formDomain: "フォーム・ドメイン信頼性",
};

const SENSITIVE_PROBES = new Set([
  "env",
  "env-local",
  "env-production",
  "git-head",
  "git-config",
  "git-index",
  "svn-entries",
  "debug-log",
  "wp-config",
  "backup-zip",
  "database-sql",
  "dump-sql",
  "phpinfo",
  "server-status",
  "actuator-env",
  "actuator-configprops",
  "debug-vars",
  "env-backup",
  "npmrc",
  "htpasswd",
  "docker-compose",
  "appsettings",
  "web-config-backup",
  "credentials-json",
  "ds-store",
  "wp-config-backup",
  "backup-tar",
  "config-php-backup",
]);

const PROBE_LABELS: Record<string, string> = {
  env: ".env",
  "env-local": ".env.local",
  "env-production": ".env.production",
  "git-head": ".git/HEAD",
  "git-config": ".git/config",
  "git-index": ".git/index",
  "svn-entries": ".svn/entries",
  "debug-log": "WordPress debug.log",
  "wp-config": "wp-config.php",
  "backup-zip": "backup.zip",
  "database-sql": "database.sql",
  "dump-sql": "dump.sql",
  phpinfo: "phpinfo.php",
  "server-status": "server-status",
  "actuator-env": "Spring Boot actuator/env",
  "actuator-configprops": "Spring Boot actuator/configprops",
  "debug-vars": "Go debug/vars",
  "env-backup": ".env.bak",
  npmrc: ".npmrc",
  htpasswd: ".htpasswd",
  "docker-compose": "docker-compose.yml",
  appsettings: "appsettings.json",
  "web-config-backup": "web.config.bak",
  "credentials-json": "credentials.json",
  "ds-store": ".DS_Store",
  "wp-config-backup": "wp-config.php.bak",
  "backup-tar": "backup.tar.gz",
  "config-php-backup": "config.php.bak",
};

export function analyzeSecurityHtml(input: AnalyzeInput): SecurityReport {
  const { html, finalUrl, headers } = input;
  const url = new URL(finalUrl);
  const requestedUrl = new URL(input.requestedUrl);
  const probes = input.probes ?? [];
  const homeFingerprint: ResponseFingerprint = {
    status: input.statusCode,
    contentType: input.contentType,
    bodySnippet: html.slice(0, 80_000),
  };
  const notFoundProbe = probeById(probes, "not-found-baseline");
  const wordpress = detectWordPress(html, probes, homeFingerprint, notFoundProbe);
  const forms = getForms(html, finalUrl);
  const dns = input.dns ?? { spf: [], dmarc: [], mx: [], caa: [], ds: [], mtaSts: [], tlsRpt: [] };
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
  const cspReportOnly = header(headers, "content-security-policy-report-only");

  const wpLogin = probeById(probes, "wp-login");
  const wpXmlRpc = probeById(probes, "xmlrpc");
  const wpUsers = probeById(probes, "wp-users");
  const wpUploads = probeById(probes, "wp-uploads");
  const wpInstall = probeById(probes, "wp-install");
  const sensitiveAssessment = assessSensitiveProbes(
    probes.filter((probe) => SENSITIVE_PROBES.has(probe.id)),
    homeFingerprint,
    notFoundProbe,
  );
  const directoryListings = probes.filter((probe) => isDirectoryListing(probe));
  const mixedContent = getMixedContent(html);
  const hstsAssessment = assessHsts(hsts, url.protocol === "https:");
  const cspAssessment = assessCsp(csp, cspReportOnly);
  const cspFormAssessment = assessCspFormAction(csp, forms);
  const cookieAssessment = assessCookies(input.setCookies ?? [], url.protocol === "https:");
  const corsAssessment = assessCors(input.cors);
  const methodAssessment = assessHttpMethods(input.httpMethods);
  const sourceMapAssessment = assessSourceMaps(probes, homeFingerprint, notFoundProbe);
  const clientCodeAssessment = assessClientCode(probes, html, url.protocol === "https:");
  const htmlLeakageAssessment = assessHtmlLeakage(html);
  const apiDocsAssessment = assessApiDocs(probes, homeFingerprint, notFoundProbe);
  const securityTxtAssessment = assessSecurityTxt(probes, homeFingerprint, notFoundProbe, url.protocol === "https:");
  const externalScripts = getExternalScripts(html, finalUrl);
  const spfAssessment = assessSpf(dns.spf);
  const dmarcAssessment = assessDmarc(dns.dmarc);
  const xFrameAssessment = assessFrameProtection(xFrame, csp);
  const referrerAssessment = assessReferrerPolicy(referrer);
  const cacheAssessment = assessCacheControl(cacheControl, forms.sensitiveInputs > 0);
  const mailEnabled = hasMailExchange(dns.mx);
  const sensitiveStatus: CheckStatus = sensitiveAssessment.exposed.length > 0
    ? "fail"
    : sensitiveAssessment.inconclusive.length > 0
      ? "warn"
      : sensitiveAssessment.unavailable.length > 0
        ? "warn"
        : "pass";
  const sensitiveWeight = sensitiveAssessment.unavailable.length > 0
    && sensitiveAssessment.exposed.length === 0
    && sensitiveAssessment.inconclusive.length === 0
    ? 2
    : 5;
  const sensitiveDetail = sensitiveAssessment.exposed.length > 0
    ? `${sensitiveAssessment.exposed.length}件で機密ファイル固有の内容を検出しました`
    : sensitiveAssessment.inconclusive.length > 0
      ? `${sensitiveAssessment.inconclusive.length}件がHTTP 200でしたが、内容を断定できませんでした`
      : sensitiveAssessment.unavailable.length > 0
        ? `${sensitiveAssessment.unavailable.length}件はタイムアウト等で確認できませんでした`
        : sensitiveAssessment.fallback.length > 0
          ? `HTTP 200の${sensitiveAssessment.fallback.length}件はトップページまたは共通フォールバックと判定しました`
          : "代表的な機密ファイル露出は確認されませんでした";

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
      check("hsts", "HSTS", hstsAssessment.status, hstsAssessment.detail, hsts, "max-ageを1年以上にし、全サブドメインをHTTPS化できる場合はincludeSubDomainsも設定してください。", 4),
      check("x-frame", "クリックジャッキング対策", xFrameAssessment.status, xFrameAssessment.detail, xFrame || getCspDirective(csp, "frame-ancestors"), "X-Frame-Options: DENY/SAMEORIGIN または CSP frame-ancestorsを設定してください。", 3),
      check("csp", "CSPの有効性", cspAssessment.status, cspAssessment.detail, csp || cspReportOnly, "強制適用のCSPを設定し、script-srcのunsafe-evalや広すぎるワイルドカードを避けてください。", 4),
      check("x-content-type", "MIMEタイプ保護", /nosniff/i.test(xContent) ? "pass" : "warn", xContent || "未設定", "X-Content-Type-Options: nosniff を設定してください。", 2),
      check("referrer", "Referrer-Policy", referrerAssessment.status, referrerAssessment.detail, referrer, "strict-origin-when-cross-origin、same-origin、no-referrer等を設定してください。", 2),
      optionalHeaderCheck("permissions", "Permissions-Policy", permissions, "カメラ・マイク・位置情報を利用するサイトでは許可範囲を明示してください。"),
      optionalHeaderCheck("coop", "Cross-Origin-Opener-Policy", coop, "クロスオリジン分離が必要なサイトでは設定を検討してください。"),
      optionalHeaderCheck("corp", "Cross-Origin-Resource-Policy", corp, "リソースの他サイト利用を制限する場合は設定を検討してください。"),
      optionalHeaderCheck("coep", "Cross-Origin-Embedder-Policy", header(headers, "cross-origin-embedder-policy"), "クロスオリジン分離が必要なサイトでは設定を検討してください。"),
      check("cache", "Cache-Control", cacheAssessment.status, cacheAssessment.detail, cacheControl, "ログイン・個人情報入力ページではno-storeまたはprivateを設定してください。", cacheAssessment.weight),
      check("cookie-attributes", "Cookieの保護属性", cookieAssessment.status, cookieAssessment.detail, cookieAssessment.value, "CookieにはSecureとSameSiteを設定し、セッションCookieにはHttpOnlyも設定してください。", cookieAssessment.weight),
      check("cors", "トップページのCORS設定", corsAssessment.status, corsAssessment.detail, corsAssessment.value, "認証情報を許可する場合は、信頼するOriginだけを厳密に許可しVary: Originを設定してください。APIごとの設定は別途確認してください。", corsAssessment.weight),
      legacySecurityHeaderCheck(headers),
    ]),
    category(
      "cms",
      wordpress.detected
        ? [
            check("wp-detected", "WordPress利用判定", "info", wordpress.detail, "WordPress固有の公開設定を確認します。", 0),
            check("wp-login", "/wp-login.php公開状況", isDistinctAccessibleHtml(wpLogin, homeFingerprint, notFoundProbe) ? "info" : "pass", probeDetail(wpLogin, "ログイン画面は確認されませんでした"), "公開自体は脆弱性ではありません。多要素認証、試行回数制限、WAF等を併用してください。", 0),
            check("xmlrpc", "XML-RPC", isWordPressXmlRpcEnabled(wpXmlRpc, homeFingerprint, notFoundProbe) ? "warn" : "pass", probeDetail(wpXmlRpc, "XML-RPCは有効に見えません"), "XML-RPCを利用していない場合は無効化してください。", 3),
            check("wp-version", "WordPressバージョン露出", getWordPressVersion(html) ? "info" : "pass", getWordPressVersion(html) || "バージョン露出は検出されませんでした", "バージョン非表示より、WordPress本体・テーマ・プラグインを継続更新することを優先してください。", 0),
            check("wp-users", "REST APIユーザー露出", hasExposedWordPressUsers(wpUsers, homeFingerprint, notFoundProbe) ? "fail" : "pass", probeDetail(wpUsers, "ユーザー一覧は確認されませんでした"), "REST APIでユーザー一覧が公開されないよう制御してください。", 3),
            check("wp-uploads", "uploads一覧表示", isDirectoryListing(wpUploads) ? "fail" : "pass", probeDetail(wpUploads, "uploadsの一覧表示は確認されませんでした"), "uploadsディレクトリの一覧表示を無効化してください。", 3),
            check("wp-install", "install.php露出", isWordPressInstallExposed(wpInstall, homeFingerprint, notFoundProbe) ? "fail" : "pass", probeDetail(wpInstall, "未完了のインストール画面は確認されませんでした"), "未完了のインストール画面が見える場合は直ちに閉じてください。", 3),
          ]
        : [
            check("wp-not-detected", "WordPress利用判定", "pass", "WordPressは検出されませんでした。WordPress固有の公開リスクは確認対象外のため、減点なしとしています。", "対象外項目は採点上100点扱いです。", 5),
            check("cms-risk", "WordPress固有リスク", "pass", "対象外（満点扱い）", "WordPressを導入した場合はログイン画面・XML-RPC・バージョン露出を確認してください。", 5),
          ],
    ),
    category("server", [
      check("server-header", "Serverヘッダー露出", serverHeader && hasVersionLikeSignal(serverHeader) ? "warn" : "pass", serverHeader || "未設定または非公開", "製品名やバージョンが出る場合は最小限にしてください。", 2),
      check("powered-by", "X-Powered-By露出", poweredBy ? "warn" : "pass", poweredBy || "未設定", "X-Powered-Byは削除を推奨します。", 2),
      check("http-methods", "公開HTTPメソッド", methodAssessment.status, methodAssessment.detail, methodAssessment.value, "不要なTRACE・CONNECT・WebDAV系メソッドは無効化し、状態変更メソッドは必要なエンドポイントだけに限定してください。", methodAssessment.weight),
      check("directory-listing", "ディレクトリ一覧", directoryListings.length > 0 ? "fail" : "pass", directoryListings.length > 0 ? directoryListings.map((item) => `${item.url} (${item.status})`).join("\n") : "代表URLで一覧表示は確認されませんでした", "ディレクトリ一覧表示を無効化してください。", 3),
      check(
        "sensitive-files",
        ".env / .git / バックアップ露出",
        sensitiveStatus,
        sensitiveDetail,
        sensitiveAssessment.detail,
        "実ファイルが公開されている場合は直ちに非公開化し、認証情報や秘密鍵をローテーションしてください。",
        sensitiveWeight,
      ),
      check("api-docs", "公開API仕様", apiDocsAssessment.status, apiDocsAssessment.detail, apiDocsAssessment.value, "公開自体は脆弱性ではありません。非公開APIや管理操作、内部情報を含めていないか確認してください。", apiDocsAssessment.weight),
      check("security-txt", "security.txt", securityTxtAssessment.status, securityTxtAssessment.detail, securityTxtAssessment.value, "RFC 9116に沿って/.well-known/security.txtへContactと有効なExpiresを掲載してください。", securityTxtAssessment.weight),
      check("robots", "robots.txtの公開情報", hasSensitiveRobots(robotsTxt) ? "info" : "pass", robotsTxt ? summarizeRobots(robotsTxt) : "robots.txtは未取得または未設定", "robots.txtはアクセス制御ではありません。記載したURLは公開情報として扱ってください。", 0),
    ]),
    category("client", [
      check(
        "subresource-integrity",
        "外部スクリプトの改ざん対策",
        externalScripts.missingIntegrity.length === 0 ? "pass" : "info",
        externalScripts.total === 0
          ? "外部オリジンのscriptは検出されませんでした"
          : externalScripts.missingIntegrity.length === 0
            ? `${externalScripts.total}件すべてにintegrity属性があります`
            : `${externalScripts.total}件中${externalScripts.missingIntegrity.length}件にintegrity属性がありません`,
        externalScripts.missingIntegrity.join("\n"),
        "固定バージョンの外部スクリプトにはSubresource Integrityを設定してください。動的配信スクリプトでは提供元の仕様も確認してください。",
        0,
      ),
      check("source-maps", "ソースマップ公開", sourceMapAssessment.status, sourceMapAssessment.detail, sourceMapAssessment.value, "本番で不要なソースマップは非公開にし、公開する場合も秘密情報を含めないでください。", sourceMapAssessment.weight),
      check("client-code-secrets", "JavaScript内の秘密情報", clientCodeAssessment.secretStatus, clientCodeAssessment.secretDetail, clientCodeAssessment.secretValue, "公開JavaScriptに秘密鍵、認証情報、無制限APIキーを埋め込まないでください。", clientCodeAssessment.scriptCount > 0 ? 5 : 0),
      check("client-code-risk", "JavaScriptの危険API候補", clientCodeAssessment.apiStatus, clientCodeAssessment.apiDetail, clientCodeAssessment.apiValue, "eval・document.write・innerHTML等に外部入力を渡していないかコードレビューしてください。", clientCodeAssessment.scriptCount > 0 ? 1 : 0),
      check("client-storage", "ブラウザ保存領域の機密データ候補", clientCodeAssessment.storageStatus, clientCodeAssessment.storageDetail, clientCodeAssessment.storageValue, "認証トークンや個人情報をlocalStorageへ保存せず、HttpOnly Cookie等を検討してください。", clientCodeAssessment.scriptCount > 0 ? 2 : 0),
      check("client-insecure-endpoints", "JavaScript内の内部・平文通信先", clientCodeAssessment.endpointStatus, clientCodeAssessment.endpointDetail, clientCodeAssessment.endpointValue, "内部ホスト名やhttp/ws通信先を本番JavaScriptへ含めないでください。", clientCodeAssessment.scriptCount > 0 ? 3 : 0),
      check("html-leakage", "HTMLコメント・エラー情報露出", htmlLeakageAssessment.status, htmlLeakageAssessment.detail, htmlLeakageAssessment.value, "本番HTMLからデバッグコメント、スタックトレース、内部ファイルパスを除去してください。", 2),
    ]),
    category("formDomain", [
      check("forms", "問い合わせフォーム", forms.total > 0 ? "pass" : "info", forms.total > 0 ? `${forms.total}件のフォームを検出` : "フォームは検出されませんでした（対象外・減点なし）", "個人情報を扱うフォームがある場合は送信先と保護設定を確認してください。", forms.total > 0 ? 2 : 0),
      check("form-action", "フォーム送信先HTTPS", forms.insecureActions === 0 ? "pass" : "fail", forms.total > 0 ? `${forms.insecureActions}件のHTTP送信先` : "対象外（満点扱い）", "フォームのactionはHTTPSにしてください。", forms.total > 0 ? 4 : 0),
      check("form-external-action", "フォームの外部送信先", forms.externalActions.length === 0 ? "pass" : "warn", forms.total > 0 ? `${forms.externalActions.length}件の別オリジン送信先` : "対象外（満点扱い）", forms.externalActions.join("\n"), "外部フォームサービスを利用する場合は送信先の正当性、契約、データ保管場所を確認してください。", forms.total > 0 ? 2 : 0),
      check("form-action-csp", "CSP form-action", cspFormAssessment.status, cspFormAssessment.detail, cspFormAssessment.value, "フォームがある場合はCSP form-actionで送信先を許可済みオリジンに限定してください。", cspFormAssessment.weight),
      check("form-get-sensitive", "機密情報のGET送信", forms.getSensitiveForms === 0 ? "pass" : "fail", forms.total > 0 ? `${forms.getSensitiveForms}件の機密入力フォームがGET送信です` : "対象外（満点扱い）", "パスワード等をGETで送信するとURL・履歴・ログへ残ります。POSTへ変更してください。", forms.total > 0 ? 4 : 0),
      check("form-csrf", "機密POSTフォームのCSRF対策候補", forms.sensitivePostForms === 0 || forms.sensitivePostWithoutCsrfHint === 0 ? "pass" : "warn", forms.sensitivePostForms > 0 ? `${forms.sensitivePostForms}件中${forms.sensitivePostWithoutCsrfHint}件でCSRFトークン候補を確認できませんでした` : "対象外（機密POSTフォームなし）", "SameSite Cookieやフレームワーク側対策もあるため、サーバー実装と合わせて確認してください。", forms.sensitivePostForms > 0 ? 2 : 0),
      check("privacy", "プライバシーポリシー導線", forms.total === 0 || hasPrivacyLink(html) ? "pass" : "warn", hasPrivacyLink(html) ? "プライバシーポリシーへのリンクを検出" : "フォーム周辺の導線は未確認", "個人情報入力フォームの近くにプライバシーポリシー導線を置いてください。", forms.total > 0 ? 2 : 0),
      check("spam", "スパム対策", forms.total === 0 || hasSpamProtection(html) ? "pass" : "warn", hasSpamProtection(html) ? "reCAPTCHA等の候補を検出" : forms.total > 0 ? "スパム対策の候補は未検出" : "対象外（満点扱い）", "reCAPTCHA、Turnstile、honeypot等のスパム対策を検討してください。", forms.total > 0 ? 2 : 0),
      check("spf", "SPF設定強度", mailEnabled || dns.spf.length > 0 ? spfAssessment.status : "info", mailEnabled || dns.spf.length > 0 ? spfAssessment.detail : "メール受信を示すMXがないため参考情報です", dns.spf.join("\n"), "メールを送信するドメインではSPFを1レコードに統合し、+allを避けて送信元を限定してください。", mailEnabled || dns.spf.length > 0 ? 2 : 0),
      check("dmarc", "DMARC設定強度", mailEnabled || dns.dmarc.length > 0 ? dmarcAssessment.status : "info", mailEnabled || dns.dmarc.length > 0 ? dmarcAssessment.detail : "メール受信を示すMXがないため参考情報です", dns.dmarc.join("\n"), "メールを送信するドメインではDMARCを設定し、監視後にp=quarantineまたはp=rejectへ移行してください。", mailEnabled || dns.dmarc.length > 0 ? 2 : 0),
      check("mx", "MXレコード", mailEnabled ? "pass" : "info", dns.mx.join("\n") || "MXレコードは確認できませんでした", "メールを利用するドメインではMXとメール認証を合わせて確認してください。", mailEnabled ? 1 : 0),
      check("caa", "CAAレコード", (dns.caa?.length ?? 0) > 0 ? "pass" : "info", dns.caa?.join("\n") || "CAAレコードは確認できませんでした", "CAAで証明書を発行できる認証局を限定できます。", (dns.caa?.length ?? 0) > 0 ? 1 : 0),
      check("dnssec", "DNSSEC", (dns.ds?.length ?? 0) > 0 ? "pass" : "info", (dns.ds?.length ?? 0) > 0 ? "親ゾーンにDSレコードを確認しました" : "DSレコードは確認できませんでした", "重要ドメインではDNSSEC導入を検討してください。", (dns.ds?.length ?? 0) > 0 ? 1 : 0),
      check("mail-transport", "メール配送TLSポリシー", (dns.mtaSts?.length ?? 0) > 0 && (dns.tlsRpt?.length ?? 0) > 0 ? "pass" : "info", `MTA-STS: ${(dns.mtaSts?.length ?? 0) > 0 ? "あり" : "なし"} / TLS-RPT: ${(dns.tlsRpt?.length ?? 0) > 0 ? "あり" : "なし"}`, "メールを運用するドメインではMTA-STSとTLS-RPTを検討してください。", mailEnabled && ((dns.mtaSts?.length ?? 0) > 0 || (dns.tlsRpt?.length ?? 0) > 0) ? 1 : 0),
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
    coverage: {
      publicPathsChecked: probes.filter((probe) => !probe.id.startsWith("client-script-") && !probe.id.startsWith("source-map-")).length,
      unavailablePaths: probes.filter((probe) => probe.status === 0).length,
      clientScriptsChecked: probes.filter((probe) => probe.id.startsWith("client-script-") && probe.status !== 0).length,
      sourceMapsChecked: probes.filter((probe) => probe.id.startsWith("source-map-") && probe.status !== 0).length,
      optionsChecked: input.httpMethods?.checked ?? false,
    },
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

function optionalHeaderCheck(id: string, label: string, value: string, recommendation: string): SecurityCheck {
  return check(id, label, value ? "pass" : "info", value || "未設定（サイトの用途により任意）", recommendation, 0);
}

function legacySecurityHeaderCheck(headers: Record<string, string>): SecurityCheck {
  const hpkp = header(headers, "public-key-pins");
  const xssProtection = header(headers, "x-xss-protection");
  const expectCt = header(headers, "expect-ct");
  const findings = [
    hpkp ? `Public-Key-Pins: ${hpkp}` : "",
    xssProtection && !/^0(?:\s*;|$)/.test(xssProtection) ? `X-XSS-Protection: ${xssProtection}` : "",
    expectCt ? `Expect-CT: ${expectCt}` : "",
  ].filter(Boolean);
  const risky = Boolean(hpkp || (xssProtection && !/^0(?:\s*;|$)/.test(xssProtection)));
  return check(
    "legacy-security-headers",
    "旧式セキュリティヘッダー",
    risky ? "warn" : findings.length > 0 ? "info" : "pass",
    findings.length > 0 ? `${findings.length}件の旧式ヘッダーを確認しました` : "危険または廃止済みの旧式ヘッダーは確認されませんでした",
    findings.join("\n"),
    "Public-Key-PinsとExpect-CTは廃止済みです。X-XSS-Protectionは0にするか削除し、CSPを利用してください。",
    risky ? 1 : 0,
  );
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

function getCspDirective(csp: string, name: string): string {
  return csp.split(";").map((directive) => directive.trim()).find((directive) => directive.toLowerCase().startsWith(`${name.toLowerCase()} `)) ?? "";
}

function assessFrameProtection(xFrame: string, csp: string): { status: CheckStatus; detail: string } {
  const frameAncestors = getCspDirective(csp, "frame-ancestors");
  if (frameAncestors) {
    const sources = frameAncestors.split(/\s+/).slice(1).map((value) => value.toLowerCase());
    if (sources.length === 0 || sources.includes("*") || sources.some((value) => /^[a-z][a-z0-9+.-]*:$/.test(value))) {
      return { status: "warn", detail: `埋め込み元の制限が広い設定です: ${frameAncestors}` };
    }
    return { status: "pass", detail: `CSP ${frameAncestors}` };
  }
  if (/^\s*(?:deny|sameorigin)\s*$/i.test(xFrame)) return { status: "pass", detail: `X-Frame-Options: ${xFrame}` };
  if (/allow-from/i.test(xFrame)) return { status: "warn", detail: "廃止されたALLOW-FROMを使用しています" };
  return { status: "warn", detail: xFrame ? `認識できない値: ${xFrame}` : "未設定" };
}

function assessReferrerPolicy(value: string): { status: CheckStatus; detail: string } {
  if (!value) return { status: "warn", detail: "未設定" };
  const policies = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const effective = policies.at(-1) ?? "";
  if (["unsafe-url", "no-referrer-when-downgrade"].includes(effective)) {
    return { status: "warn", detail: `参照元情報を広く送信する設定です: ${effective}` };
  }
  if (["no-referrer", "same-origin", "strict-origin", "strict-origin-when-cross-origin", "origin"].includes(effective)) {
    return { status: "pass", detail: `有効なポリシー: ${effective}` };
  }
  return { status: "warn", detail: `設定値を確認してください: ${effective || value}` };
}

function assessCacheControl(value: string, hasSensitiveForm: boolean): { status: CheckStatus; detail: string; weight: number } {
  if (!hasSensitiveForm) {
    return value
      ? { status: "pass", detail: value, weight: 1 }
      : { status: "info", detail: "未設定（公開ページでは用途により許容）", weight: 0 };
  }
  if (/\b(?:no-store|private)\b/i.test(value)) {
    return { status: "pass", detail: `機密入力ページ向けの制御を確認: ${value}`, weight: 2 };
  }
  return {
    status: "warn",
    detail: value ? `機密入力フォームがありますがno-store/privateがありません: ${value}` : "機密入力フォームがありますが未設定です",
    weight: 2,
  };
}

function assessHsts(value: string, isHttps: boolean): { status: CheckStatus; detail: string } {
  if (!isHttps) return { status: "fail", detail: "HTTP配信のためHSTSは有効になりません" };
  if (!value) return { status: "warn", detail: "未設定" };

  const maxAge = Number(value.match(/(?:^|;)\s*max-age\s*=\s*(\d+)/i)?.[1] ?? Number.NaN);
  if (!Number.isFinite(maxAge) || maxAge === 0) {
    return { status: "fail", detail: "max-ageが無効または0です" };
  }

  const issues: string[] = [];
  if (maxAge < 31_536_000) issues.push(`max-age=${maxAge}（1年未満）`);
  const includesSubdomains = /(?:^|;)\s*includeSubDomains(?:;|$)/i.test(value);

  return issues.length > 0
    ? { status: "warn", detail: issues.join(" / ") }
    : { status: "pass", detail: `max-age=${maxAge}${includesSubdomains ? " / includeSubDomainsあり" : " / includeSubDomainsなし（任意）"}` };
}

function assessCsp(enforced: string, reportOnly: string): { status: CheckStatus; detail: string } {
  if (!enforced) {
    return reportOnly
      ? { status: "warn", detail: "Report-Onlyのみで、ブラウザによる強制適用はされていません" }
      : { status: "warn", detail: "未設定" };
  }

  const issues: string[] = [];
  const scriptDirective = getCspDirective(enforced, "script-src") || getCspDirective(enforced, "default-src");
  if (!scriptDirective) issues.push("script-src/default-srcなし");
  if (/\s\*(?:\s|$)/.test(scriptDirective)) issues.push("script/default-srcに*");
  if (/'unsafe-eval'/i.test(scriptDirective)) issues.push("script-srcにunsafe-eval");
  if (
    /'unsafe-inline'/i.test(scriptDirective)
    && !/(?:'nonce-[^']+'|'sha(?:256|384|512)-[^']+'|'strict-dynamic')/i.test(scriptDirective)
  ) {
    issues.push("script-srcにunsafe-inline");
  }
  if (!/(?:^|;)\s*object-src\b/i.test(enforced)) issues.push("object-srcなし");
  if (!/(?:^|;)\s*base-uri\b/i.test(enforced)) issues.push("base-uriなし");
  if (/(?:^|\s)(?:http:|data:)(?:\s|$)/i.test(scriptDirective)) issues.push("script-srcにhttp:/data:");

  return issues.length > 0
    ? { status: "warn", detail: `強制適用されていますが弱い設定があります: ${issues.join(" / ")}` }
    : { status: "pass", detail: "強制適用のCSPを確認しました" };
}

function assessCspFormAction(csp: string, forms: ReturnType<typeof getForms>): { status: CheckStatus; detail: string; value: string; weight: number } {
  if (forms.total === 0) {
    return { status: "info", detail: "フォームがないため対象外です", value: "", weight: 0 };
  }
  const directive = getCspDirective(csp, "form-action");
  if (!directive) {
    return { status: "warn", detail: "フォームがありますがCSP form-actionは未設定です", value: "", weight: 1 };
  }

  const sources = directive.split(/\s+/).slice(1).map((value) => value.toLowerCase());
  const broad = sources.includes("*") || sources.some((value) => /^(?:http:|data:)$/.test(value));
  if (broad) {
    return { status: "warn", detail: "フォーム送信先の許可範囲が広い設定です", value: directive, weight: 1 };
  }
  if (sources.includes("'none'")) {
    return { status: "info", detail: "form-action 'none'によりブラウザのフォーム送信は拒否されます", value: directive, weight: 0 };
  }
  return { status: "pass", detail: "CSPでフォーム送信先を限定しています", value: directive, weight: 1 };
}

function assessCookies(cookies: string[], isHttps: boolean): { status: CheckStatus; detail: string; value: string; weight: number } {
  if (cookies.length === 0) {
    return { status: "info", detail: "トップページの応答ではSet-Cookieを検出しませんでした", value: "", weight: 0 };
  }

  const issues: string[] = [];
  let hasFailure = false;

  for (const cookie of cookies) {
    const name = cookie.match(/^\s*([^=;\s]+)\s*=/)?.[1] ?? "(名前不明)";
    const secure = /;\s*secure(?:;|$)/i.test(cookie);
    const httpOnly = /;\s*httponly(?:;|$)/i.test(cookie);
    const sameSite = cookie.match(/;\s*samesite\s*=\s*(strict|lax|none)/i)?.[1]?.toLowerCase() ?? "";
    const path = cookie.match(/;\s*path\s*=\s*([^;]+)/i)?.[1]?.trim() ?? "";
    const hasDomain = /;\s*domain\s*=/i.test(cookie);
    const partitioned = /;\s*partitioned(?:;|$)/i.test(cookie);
    const cookieIssues: string[] = [];

    if (isHttps && !secure) cookieIssues.push("Secureなし");
    if (!sameSite) cookieIssues.push("SameSiteなし");
    if (sameSite === "none" && !secure) {
      cookieIssues.push("SameSite=NoneにSecureなし");
      hasFailure = true;
    }
    if (/(?:session|sess|auth|token|jwt|sid|login)/i.test(name) && !httpOnly) cookieIssues.push("HttpOnlyなし");
    if (name.startsWith("__Secure-") && !secure) cookieIssues.push("__Secure-接頭辞なのにSecureなし");
    if (name.startsWith("__Host-") && (!secure || path !== "/" || hasDomain)) cookieIssues.push("__Host-接頭辞の要件違反");
    if (partitioned && !secure) cookieIssues.push("PartitionedにSecureなし");

    if (cookieIssues.length > 0) issues.push(`${name}: ${Array.from(new Set(cookieIssues)).join("、")}`);
  }

  if (issues.length === 0) {
    return { status: "pass", detail: `${cookies.length}件のCookieで主要な保護属性を確認しました`, value: "", weight: 3 };
  }

  return {
    status: hasFailure ? "fail" : "warn",
    detail: `${issues.length}件のCookieに改善点があります`,
    value: issues.join("\n"),
    weight: 3,
  };
}

function assessCors(cors: AnalyzeInput["cors"]): { status: CheckStatus; detail: string; value: string; weight: number } {
  if (!cors?.checked) {
    return { status: "info", detail: "CORS確認用リクエストを完了できませんでした", value: "", weight: 0 };
  }
  if (!cors?.allowOrigin) {
    return { status: "pass", detail: "任意Originへの許可は検出されませんでした", value: "", weight: 3 };
  }

  const allowOrigin = cors.allowOrigin.trim();
  const credentials = /^true$/i.test(cors.allowCredentials.trim());
  const reflected = allowOrigin === "https://security-checker.invalid";
  const variesByOrigin = cors.vary.split(",").some((value) => value.trim().toLowerCase() === "origin");
  const issues: string[] = [];

  if (allowOrigin === "*") issues.push("Access-Control-Allow-Origin: *");
  if (reflected) issues.push("任意のOriginを反射");
  if (reflected && !variesByOrigin) issues.push("Vary: Originなし");
  if (credentials) issues.push("credentials許可");

  if (reflected && credentials) {
    return {
      status: "fail",
      detail: "任意Originを認証情報付きで許可しています",
      value: issues.join(" / "),
      weight: 4,
    };
  }

  if (allowOrigin === "*" || reflected) {
    return {
      status: "warn",
      detail: "広いCORS許可を検出しました。公開データだけの応答か確認が必要です",
      value: issues.join(" / "),
      weight: 3,
    };
  }

  return {
    status: "pass",
    detail: `検査用Originは許可されず、固定Originのみが返されました: ${allowOrigin}`,
    value: credentials ? "固定Originへのcredentials許可あり" : "",
    weight: 3,
  };
}

function assessHttpMethods(methods: AnalyzeInput["httpMethods"]): { status: CheckStatus; detail: string; value: string; weight: number } {
  if (!methods?.checked) {
    return { status: "info", detail: "OPTIONSによる許可メソッド確認を完了できませんでした", value: "", weight: 0 };
  }
  if (!methods.allow.trim()) {
    return { status: "info", detail: `OPTIONSはHTTP ${methods.status}でしたがAllowヘッダーはありません`, value: "", weight: 0 };
  }

  const allowed = Array.from(new Set(methods.allow.toUpperCase().split(/[\s,]+/).filter(Boolean)));
  const critical = allowed.filter((method) => ["TRACE", "TRACK", "CONNECT"].includes(method));
  const webDav = allowed.filter((method) => ["PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK"].includes(method));
  const stateChanging = allowed.filter((method) => ["POST", "PUT", "PATCH", "DELETE"].includes(method));
  const value = allowed.join(", ");

  if (critical.length > 0) {
    return { status: "fail", detail: `危険性の高いメソッドがAllowで明示されています: ${critical.join(", ")}`, value, weight: 3 };
  }
  if (webDav.length > 0) {
    return { status: "warn", detail: `WebDAV系メソッドがAllowで明示されています: ${webDav.join(", ")}`, value, weight: 2 };
  }
  if (stateChanging.length > 0) {
    return { status: "info", detail: `状態変更メソッドがAllowで明示されています: ${stateChanging.join(", ")}`, value, weight: 0 };
  }
  return { status: "pass", detail: `Allowで確認したメソッド: ${value}`, value, weight: 2 };
}

function assessSourceMaps(probes: ProbeResult[], home: ResponseFingerprint, notFound?: ProbeResult): { status: CheckStatus; detail: string; value: string; weight: number } {
  const sourceMaps = probes.filter((probe) => probe.id.startsWith("source-map-"));
  const checkedSourceMaps = sourceMaps.filter((probe) => probe.status !== 0);
  const exposed = sourceMaps.filter((probe) =>
    isDistinctAccessible(probe, home, notFound)
    && /"version"\s*:\s*3\b/.test(probe.bodySnippet)
    && /"sources"\s*:/.test(probe.bodySnippet),
  );
  if (exposed.length === 0) {
    return checkedSourceMaps.length > 0
      ? { status: "pass", detail: "検査したJavaScriptでは公開ソースマップを確認しませんでした", value: "", weight: 2 }
      : { status: "info", detail: "検査対象の同一オリジンJavaScriptは確認できませんでした", value: "", weight: 0 };
  }

  const containsSources = exposed.filter((probe) => /"sourcesContent"\s*:\s*\[(?!\s*null)/.test(probe.bodySnippet));
  const containsSecret = exposed.filter((probe) => hasSecretLikeText(probe.bodySnippet));
  return {
    status: containsSecret.length > 0 ? "fail" : "warn",
    detail: containsSecret.length > 0
      ? `${exposed.length}件のソースマップを公開し、秘密情報らしき文字列も検出しました`
      : `${exposed.length}件のソースマップを公開しています${containsSources.length > 0 ? `（${containsSources.length}件は元ソースを内包）` : ""}`,
    value: exposed.map((probe) => new URL(probe.url).pathname).join("\n"),
    weight: 2,
  };
}

function assessClientCode(probes: ProbeResult[], html: string, isHttps: boolean) {
  const scripts = probes.filter((probe) => probe.id.startsWith("client-script-") && isProbablyAccessible(probe));
  const inlineScripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    .filter((match) => !/\bsrc\s*=/i.test(match[1]) && !/(?:application|text)\/(?:ld\+json|json)/i.test(getAttr(match[1], "type")))
    .map((match) => match[2])
    .filter((value) => value.trim())
    .slice(0, 8);
  const scriptCount = scripts.length + inlineScripts.length;
  const code = [...scripts.map((probe) => probe.bodySnippet), ...inlineScripts].join("\n").slice(0, 500_000);
  if (scriptCount === 0) {
    return {
      scriptCount: 0,
      secretStatus: "info" as CheckStatus,
      secretDetail: "解析対象の同一オリジンJavaScriptを取得できませんでした",
      secretValue: "",
      apiStatus: "info" as CheckStatus,
      apiDetail: "対象外",
      apiValue: "",
      storageStatus: "info" as CheckStatus,
      storageDetail: "対象外",
      storageValue: "",
      endpointStatus: "info" as CheckStatus,
      endpointDetail: "対象外",
      endpointValue: "",
    };
  }

  const highRiskSecrets = [
    ["秘密鍵", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
    ["AWSアクセスキー", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
    ["GitHubアクセストークン", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/],
    ["Slackトークン", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
    ["Stripe秘密鍵", /\bsk_live_[A-Za-z0-9]{16,}\b/],
  ] as const;
  const reviewSecrets = [
    ["認証情報の直書き候補", /(?:password|client[_-]?secret|secret[_-]?key)\s*[:=]\s*["'][^"'$\s]{8,}["']/i],
    ["APIキー候補", /(?:api[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'$\s]{12,}["']/i],
    ["JWT候補", /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/],
    ["Google APIキー候補", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ] as const;
  const foundHighRisk = highRiskSecrets.filter(([, pattern]) => pattern.test(code)).map(([label]) => label);
  const foundReview = reviewSecrets.filter(([, pattern]) => pattern.test(code)).map(([label]) => label);

  const apiSignals = [
    ["eval", /\beval\s*\(/g],
    ["Functionコンストラクタ", /\bnew\s+Function\s*\(/g],
    ["document.write", /\bdocument\.write(?:ln)?\s*\(/g],
    ["innerHTML/outerHTML", /\.(?:innerHTML|outerHTML)\s*=/g],
    ["insertAdjacentHTML", /\.insertAdjacentHTML\s*\(/g],
    ["postMessageの*指定", /\.postMessage\s*\([^)]*,\s*["']\*["']\s*\)/g],
    ["文字列setTimeout/setInterval", /\bset(?:Timeout|Interval)\s*\(\s*["'`]/g],
  ].map(([label, pattern]) => ({ label: String(label), count: (code.match(pattern as RegExp) ?? []).length })).filter((item) => item.count > 0);

  const storageSignals = [
    ["localStorage", /localStorage.{0,120}(?:token|auth|jwt|password|secret)|(?:token|auth|jwt|password|secret).{0,120}localStorage/gi],
    ["sessionStorage", /sessionStorage.{0,120}(?:token|auth|jwt|password|secret)|(?:token|auth|jwt|password|secret).{0,120}sessionStorage/gi],
  ].map(([label, pattern]) => ({ label: String(label), count: (code.match(pattern as RegExp) ?? []).length })).filter((item) => item.count > 0);

  const endpointUrls = Array.from(code.matchAll(/\b(?:https?|wss?):\/\/[^\s"'`<>\\)]+/gi)).map((match) => match[0]);
  const documentationHosts = new Set(["www.w3.org", "w3.org", "json-schema.org", "example.com", "www.example.com"]);
  const insecureEndpoints = isHttps
    ? endpointUrls.filter((value) => {
        try {
          const parsed = new URL(value);
          return /^(?:http|ws):$/i.test(parsed.protocol) && !documentationHosts.has(parsed.hostname.toLowerCase());
        } catch {
          return false;
        }
      })
    : [];
  const internalEndpoints = endpointUrls.filter((value) => {
    try {
      const hostname = new URL(value).hostname.toLowerCase();
      return hostname === "localhost"
        || hostname.endsWith(".local")
        || hostname.endsWith(".internal")
        || /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname);
    } catch {
      return false;
    }
  });
  const endpointFindings = [
    ...insecureEndpoints.map((value) => `平文通信: ${redactUrl(value)}`),
    ...internalEndpoints.map((value) => `内部通信先: ${redactUrl(value)}`),
  ];

  return {
    scriptCount,
    secretStatus: foundHighRisk.length > 0 ? "fail" as CheckStatus : foundReview.length > 0 ? "warn" as CheckStatus : "pass" as CheckStatus,
    secretDetail: foundHighRisk.length > 0
      ? `${scriptCount}件のJavaScriptから高リスクな秘密情報候補を検出しました`
      : foundReview.length > 0
        ? `${scriptCount}件のJavaScriptから公開可否の確認が必要なキー候補を検出しました`
        : `${scriptCount}件のJavaScriptで代表的な秘密情報パターンは検出されませんでした`,
    secretValue: [...foundHighRisk, ...foundReview].join("\n"),
    apiStatus: apiSignals.length > 0 ? "warn" as CheckStatus : "pass" as CheckStatus,
    apiDetail: apiSignals.length > 0 ? `${apiSignals.length}種類の危険API候補を検出しました（脆弱性確定ではありません）` : "代表的な危険API候補は検出されませんでした",
    apiValue: apiSignals.map((item) => `${item.label}: ${item.count}箇所`).join("\n"),
    storageStatus: storageSignals.length > 0 ? "warn" as CheckStatus : "pass" as CheckStatus,
    storageDetail: storageSignals.length > 0 ? "機密データ名とブラウザ保存領域が近接するコードを検出しました" : "機密データのブラウザ保存候補は検出されませんでした",
    storageValue: storageSignals.map((item) => `${item.label}: ${item.count}箇所`).join("\n"),
    endpointStatus: endpointFindings.length > 0 ? "warn" as CheckStatus : "pass" as CheckStatus,
    endpointDetail: endpointFindings.length > 0 ? `${endpointFindings.length}件の内部・平文通信先候補を検出しました` : "内部・平文通信先候補は検出されませんでした",
    endpointValue: Array.from(new Set(endpointFindings)).slice(0, 10).join("\n"),
  };
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname.slice(0, 120)}`;
  } catch {
    return value.slice(0, 160);
  }
}

function assessHtmlLeakage(html: string): { status: CheckStatus; detail: string; value: string } {
  const findings: string[] = [];
  const comments = Array.from(html.matchAll(/<!--([\s\S]*?)-->/g)).map((match) => match[1]);
  if (comments.some((comment) => /(?:password|secret|api[_-]?key|token|private key)/i.test(comment))) findings.push("コメント内に秘密情報を示す語句");
  if (comments.some((comment) => /(?:todo|fixme|debug|staging|internal|localhost)/i.test(comment))) findings.push("コメント内に開発・内部環境を示す語句");
  if (/at\s+[\w.$<>]+\s+\([^)]+:\d+:\d+\)|Traceback \(most recent call last\)|Stack trace:/i.test(html)) findings.push("スタックトレース候補");
  if (/(?:\/home\/|\/var\/www\/|\/usr\/src\/|[A-Z]:\\(?:Users|inetpub)\\)[^\s"'<>]{3,}/i.test(html)) findings.push("サーバー内部ファイルパス候補");
  if (/SQLSTATE\[[A-Z0-9]+\]|mysqli?_(?:connect|query)|PDOException|SequelizeDatabaseError/i.test(html)) findings.push("データベースエラー候補");

  return findings.length > 0
    ? { status: "warn", detail: `${findings.length}種類の情報露出候補を検出しました`, value: findings.join("\n") }
    : { status: "pass", detail: "代表的なコメント・エラー情報露出は検出されませんでした", value: "" };
}

function assessApiDocs(probes: ProbeResult[], home: ResponseFingerprint, notFound?: ProbeResult): { status: CheckStatus; detail: string; value: string; weight: number } {
  const candidates = probes.filter((probe) => probe.id.startsWith("api-docs-"));
  const exposed = probes.filter((probe) =>
    probe.id.startsWith("api-docs-")
    && isDistinctAccessible(probe, home, notFound)
    && /"(?:openapi|swagger)"\s*:\s*"[^"]+"/i.test(probe.bodySnippet)
    && /"paths"\s*:\s*\{/i.test(probe.bodySnippet),
  );
  if (candidates.every((probe) => probe.status === 0)) {
    return { status: "info", detail: "API仕様URLの確認を完了できませんでした", value: "", weight: 0 };
  }
  return exposed.length > 0
    ? { status: "info", detail: `${exposed.length}件のAPI仕様を公開しています`, value: exposed.map((probe) => new URL(probe.url).pathname).join("\n"), weight: 0 }
    : { status: "pass", detail: "代表URLでは公開API仕様を確認しませんでした", value: "", weight: 0 };
}

function assessSecurityTxt(probes: ProbeResult[], home: ResponseFingerprint, notFound: ProbeResult | undefined, isHttps: boolean): { status: CheckStatus; detail: string; value: string; weight: number } {
  const wellKnown = probeById(probes, "security-txt-well-known");
  const legacy = probeById(probes, "security-txt-root");
  if (wellKnown?.status === 0 && legacy?.status === 0) {
    return { status: "info", detail: "security.txtの確認を完了できませんでした", value: "", weight: 0 };
  }
  const validProbe = [wellKnown, legacy].find((probe) =>
    isDistinctAccessible(probe, home, notFound)
    && /^Contact\s*:/im.test(probe?.bodySnippet ?? ""),
  );
  if (!validProbe) {
    return { status: "info", detail: "security.txtは確認できませんでした", value: "", weight: 0 };
  }

  const issues: string[] = [];
  if (!isHttps) issues.push("HTTPSではありません");
  if (validProbe.id !== "security-txt-well-known") issues.push("/.well-known/security.txtではありません");
  const contacts = Array.from(validProbe.bodySnippet.matchAll(/^Contact\s*:\s*(.+)$/gim)).map((match) => match[1].trim());
  if (contacts.some((contact) => !/^(?:mailto:|https:\/\/)/i.test(contact))) issues.push("Contactがmailto:またはHTTPSではありません");
  const expires = validProbe.bodySnippet.match(/^Expires\s*:\s*(.+)$/im)?.[1]?.trim() ?? "";
  if (!expires) {
    issues.push("Expiresなし");
  } else {
    const expiry = Date.parse(expires);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) issues.push("Expiresが無効または期限切れ");
    if (Number.isFinite(expiry) && expiry > Date.now() + 366 * 24 * 60 * 60 * 1000) issues.push("Expiresが1年以上先です");
  }

  return issues.length > 0
    ? { status: "warn", detail: `security.txtを検出しましたが改善点があります: ${issues.join(" / ")}`, value: new URL(validProbe.url).pathname, weight: 1 }
    : { status: "pass", detail: "RFC 9116形式のContactと有効なExpiresを確認しました", value: new URL(validProbe.url).pathname, weight: 1 };
}

function assessSpf(records: string[]): { status: CheckStatus; detail: string } {
  if (records.length === 0) return { status: "warn", detail: "SPFレコードは確認できませんでした" };
  if (records.length > 1) return { status: "fail", detail: `${records.length}件のSPFレコードがあります（SPF PermErrorの原因）` };

  const tokens = records[0].replace(/"/g, "").split(/\s+/).map((token) => token.toLowerCase());
  if (tokens.includes("all") || tokens.includes("+all")) return { status: "fail", detail: "すべての送信元を許可する+all相当を検出しました" };
  if (tokens.includes("?all")) return { status: "warn", detail: "末尾が?allで、送信元制限が弱い設定です" };
  if (tokens.includes("~all")) return { status: "warn", detail: "末尾が~all（SoftFail）です" };
  return { status: "pass", detail: "送信元を限定するSPFを確認しました" };
}

function assessDmarc(records: string[]): { status: CheckStatus; detail: string } {
  if (records.length === 0) return { status: "warn", detail: "DMARCレコードは確認できませんでした" };
  if (records.length > 1) return { status: "fail", detail: `${records.length}件のDMARCレコードがあります（無効になる可能性）` };

  const policy = records[0].match(/(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\b/i)?.[1]?.toLowerCase();
  if (!policy) return { status: "fail", detail: "有効なpポリシーを確認できませんでした" };
  if (policy === "none") return { status: "warn", detail: "p=none（監視のみ）です" };
  const pct = Number(records[0].match(/(?:^|;)\s*pct\s*=\s*(\d{1,3})\b/i)?.[1] ?? "100");
  if (pct < 100) return { status: "warn", detail: `p=${policy}ですがpct=${pct}で一部メールだけが対象です` };
  return { status: "pass", detail: `p=${policy}でなりすましメールを制御しています` };
}

function hasMailExchange(records: string[]): boolean {
  return records.some((record) => !/^\s*0\s+\.\s*$/.test(record.replaceAll('"', "")));
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
  const resourceTags = html.match(/<(?:script|img|iframe|audio|video|source|embed|input)\b[^>]*>/gi) ?? [];
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  const urls = [
    ...resourceTags.map((tag) => getAttr(tag, "src")),
    ...linkTags.map((tag) => getAttr(tag, "href")),
    ...Array.from(html.matchAll(/url\(\s*["']?(http:\/\/[^"')\s]+)["']?\s*\)/gi)).map((match) => match[1]),
  ]
    .map(decodeText)
    .filter((value) => /^http:\/\//i.test(value));
  return Array.from(new Set(urls)).slice(0, 12);
}

function detectWordPress(html: string, probes: ProbeResult[], home: ResponseFingerprint, notFound?: ProbeResult) {
  const signals: string[] = [];
  if (/wp-content|wp-includes|wp-json/i.test(html)) signals.push("HTML内にwp-content/wp-json等を検出");
  const generator = getMeta(html, "name", "generator");
  if (/wordpress/i.test(generator)) signals.push(`generator: ${generator}`);
  if (isDistinctAccessible(probeById(probes, "wp-json"), home, notFound)) signals.push("/wp-json/ が固有応答");
  if (isDistinctAccessibleHtml(probeById(probes, "wp-login"), home, notFound)) signals.push("/wp-login.php が固有応答");
  return { detected: signals.length > 0, detail: signals.join(" / ") || "WordPressシグナルなし" };
}

function getWordPressVersion(html: string): string {
  const generator = getMeta(html, "name", "generator");
  if (/wordpress/i.test(generator)) return generator;
  const match = html.match(/wp-(?:includes|content)\/[^"']+\?ver=([0-9][^"']*)/i);
  return match ? `ver=${match[1]}` : "";
}

function isWordPressXmlRpcEnabled(probe: ProbeResult | undefined, home: ResponseFingerprint, notFound?: ProbeResult): boolean {
  if (!probe || ![200, 405].includes(probe.status)) return false;
  if (isDistinctAccessible(probe, home, notFound)) return true;
  return /XML-RPC server accepts POST requests only|xmlrpc\.php/i.test(probe.bodySnippet);
}

function hasExposedWordPressUsers(probe: ProbeResult | undefined, home: ResponseFingerprint, notFound?: ProbeResult): boolean {
  if (!isDistinctAccessible(probe, home, notFound) || !probe?.bodySnippet) return false;
  try {
    const value = JSON.parse(probe.bodySnippet) as unknown;
    return Array.isArray(value)
      && value.some((item) => typeof item === "object" && item !== null && ("slug" in item || "name" in item || "id" in item));
  } catch {
    return /"(?:slug|name|id)"\s*:/.test(probe.bodySnippet);
  }
}

function isWordPressInstallExposed(probe: ProbeResult | undefined, home: ResponseFingerprint, notFound?: ProbeResult): boolean {
  if (!isDistinctAccessibleHtml(probe, home, notFound) || !probe?.bodySnippet) return false;
  if (/already installed|すでにインストールされています/i.test(probe.bodySnippet)) return false;
  return /(?:install|インストール).{0,80}(?:wordpress|site title|サイトのタイトル)|name=["']weblog_title["']/i.test(probe.bodySnippet);
}

function isProbablyAccessible(probe: ProbeResult | undefined): boolean {
  return Boolean(probe && probe.status >= 200 && probe.status < 300);
}

function isProbablyAccessibleHtml(probe: ProbeResult | undefined): boolean {
  return Boolean(isProbablyAccessible(probe) && /html|text/i.test(probe?.contentType ?? ""));
}

type ResponseFingerprint = {
  status: number;
  contentType: string;
  bodySnippet: string;
};

function isDistinctAccessible(probe: ProbeResult | undefined, home: ResponseFingerprint, notFound?: ProbeResult): boolean {
  return Boolean(
    isProbablyAccessible(probe)
    && probe
    && !matchesGenericResponse(probe, home)
    && (!notFound || !matchesGenericResponse(probe, notFound)),
  );
}

function isDistinctAccessibleHtml(probe: ProbeResult | undefined, home: ResponseFingerprint, notFound?: ProbeResult): boolean {
  return isProbablyAccessibleHtml(probe) && isDistinctAccessible(probe, home, notFound);
}

function assessSensitiveProbes(probes: ProbeResult[], home: ResponseFingerprint, notFound?: ProbeResult) {
  const exposed: ProbeResult[] = [];
  const fallback: ProbeResult[] = [];
  const inconclusive: ProbeResult[] = [];
  const unavailable = probes.filter((probe) => probe.status === 0);

  for (const probe of probes) {
    if (probe.status === 0) continue;
    if (!isProbablyAccessible(probe)) continue;
    if (matchesGenericResponse(probe, home) || (notFound && matchesGenericResponse(probe, notFound))) {
      fallback.push(probe);
    } else if (hasSensitiveSignature(probe)) {
      exposed.push(probe);
    } else {
      inconclusive.push(probe);
    }
  }

  const lines = [
    ...exposed.map((probe) => `[露出] ${probeLabel(probe)} (${probe.status}, ${probe.contentType || "Content-Type不明"})`),
    ...inconclusive.map((probe) => `[要確認] ${probeLabel(probe)} (${probe.status}, 固有内容を確認できず)`),
    ...unavailable.map((probe) => `[確認不能] ${probeLabel(probe)} (タイムアウトまたは接続失敗)`),
    ...fallback.map((probe) => `[除外] ${probeLabel(probe)} (${probe.status}, トップ/存在しないパスと類似)`),
  ];

  return {
    exposed,
    fallback,
    inconclusive,
    unavailable,
    detail: lines.join("\n") || "検査した代表パスはいずれも未公開でした",
  };
}

function hasSensitiveSignature(probe: ProbeResult): boolean {
  const body = probe.bodySnippet;
  if (probe.id.startsWith("env")) {
    return /(?:^|\n)\s*(?:APP_KEY|DB_(?:HOST|NAME|USER(?:NAME)?|PASSWORD)|DATABASE_URL|SECRET(?:_KEY)?|API_KEY|ACCESS_TOKEN|AWS_ACCESS_KEY_ID)\s*=/im.test(body)
      || ((body.match(/(?:^|\n)\s*[A-Z][A-Z0-9_]{2,}\s*=\s*[^\r\n]+/gm) ?? []).length >= 2);
  }
  if (probe.id === "git-head") return /^ref:\s*refs\/heads\//i.test(body.trim()) || /^[a-f0-9]{40}$/i.test(body.trim());
  if (probe.id === "git-config") return /\[core\][\s\S]*repositoryformatversion|\[remote\s+"origin"\]/i.test(body);
  if (probe.id === "git-index") return body.startsWith("DIRC");
  if (probe.id === "svn-entries") return /^(?:8|9|10|12)\s*[\r\n]+[\s\S]{0,300}\bdir\b/i.test(body);
  if (probe.id === "debug-log") return /PHP (?:warning|notice|fatal)|WordPress database error|stack trace|uncaught exception/i.test(body);
  if (probe.id === "wp-config" || probe.id === "wp-config-backup" || probe.id === "config-php-backup") return /DB_NAME|DB_PASSWORD|AUTH_KEY|ABSPATH|mysqli?_connect|PDO\s*\(/i.test(body);
  if (probe.id === "database-sql" || probe.id === "dump-sql") return /--\s*(?:MySQL|PostgreSQL|SQL) dump|CREATE\s+TABLE|INSERT\s+INTO|COPY\s+\S+\s+FROM\s+stdin/i.test(body);
  if (probe.id === "phpinfo") return /<title>phpinfo\(\)|PHP Version|PHP Credits/i.test(body);
  if (probe.id === "server-status") return /Apache Server Status|Server Version:|Server MPM:/i.test(body);
  if (probe.id === "actuator-env") return /"propertySources"\s*:|"activeProfiles"\s*:/i.test(body);
  if (probe.id === "actuator-configprops") return /"contexts"\s*:[\s\S]*"beans"\s*:/i.test(body);
  if (probe.id === "debug-vars") return /"cmdline"\s*:|"memstats"\s*:|"goroutines"\s*:/i.test(body);
  if (probe.id === "npmrc") return /(?:^|\n)\s*(?:\/\/[^:\r\n]+:)?_authToken\s*=|(?:^|\n)\s*_auth\s*=/im.test(body);
  if (probe.id === "htpasswd") return /(?:^|\n)[^:\r\n]+:\$(?:apr1|2[aby]|5|6)\$/im.test(body);
  if (probe.id === "docker-compose") return /(?:^|\n)\s*services\s*:\s*(?:\n|$)[\s\S]*(?:image|build|environment)\s*:/im.test(body);
  if (probe.id === "appsettings") return /"ConnectionStrings"\s*:|"DefaultConnection"\s*:|"(?:Password|ClientSecret|ApiKey)"\s*:/i.test(body);
  if (probe.id === "web-config-backup") return /<configuration\b[\s\S]*(?:<connectionStrings\b|<system\.web\b|machineKey)/i.test(body);
  if (probe.id === "credentials-json") return /"private_key"\s*:|"client_secret"\s*:|"aws_access_key_id"\s*:/i.test(body);
  if (probe.id === "ds-store") return /Bud1/.test(body);
  if (probe.id === "backup-zip" || probe.id === "backup-tar") {
    return /(?:zip|x-zip|gzip|x-gzip|x-tar|octet-stream)/i.test(probe.contentType)
      || /attachment[^;\r\n]*filename\s*=\s*"?[^"]+\.(?:zip|tar|tar\.gz|tgz)/i.test(probe.headers["content-disposition"] ?? "");
  }
  return false;
}

function hasSecretLikeText(value: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:AKIA|ASIA)[0-9A-Z]{16}|(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk_live_[A-Za-z0-9]{16,}|(?:api[_-]?key|secret[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'][^"']{8,}/i.test(value);
}

function probeLabel(probe: ProbeResult): string {
  return `${PROBE_LABELS[probe.id] ?? probe.id}: ${new URL(probe.url).pathname}`;
}

function matchesGenericResponse(candidate: ResponseFingerprint, baseline: ResponseFingerprint): boolean {
  if (!candidate.bodySnippet || !baseline.bodySnippet) return false;
  if (!similarContentType(candidate.contentType, baseline.contentType)) return false;

  const left = normalizeResponseBody(candidate.bodySnippet);
  const right = normalizeResponseBody(baseline.bodySnippet);
  if (!left || !right) return false;
  if (left === right) return true;

  const lengthRatio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  if (lengthRatio < 0.9) return false;

  return tokenSimilarity(left, right) >= 0.95;
}

function similarContentType(left: string, right: string): boolean {
  const normalize = (value: string) => value.split(";", 1)[0].trim().toLowerCase();
  return normalize(left) === normalize(right);
}

function normalizeResponseBody(value: string): string {
  return decodeText(value)
    .replace(/https?:\/\/[^\s"'<>]+/gi, " ")
    .replace(/[a-f0-9]{24,}/gi, " ")
    .replace(/\b\d{10,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 80_000);
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(left.split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length >= 3));
  const rightTokens = new Set(right.split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length >= 3));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function isDirectoryListing(probe: ProbeResult | undefined): boolean {
  if (!probe || !isProbablyAccessible(probe)) return false;
  return /Index of|Directory Listing|Parent Directory/i.test(probe.bodySnippet);
}

function hasVersionLikeSignal(value: string): boolean {
  return /\/\d|\d+\.\d+|php|apache|nginx|express|openresty/i.test(value);
}

function hasSensitiveRobots(robotsTxt: string): boolean {
  return /wp-admin|admin|login|private|backup|\.env|\.git|config/i.test(robotsTxt);
}

function summarizeRobots(robotsTxt: string): string {
  const lines = robotsTxt.split(/\r?\n/).filter((line) => line.trim()).slice(0, 8);
  return lines.join("\n") || "robots.txtは空です";
}

function getForms(html: string, finalUrl: string) {
  const blocks = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) ?? [];
  const tags = blocks.length > 0 ? blocks : (html.match(/<form\b[^>]*>/gi) ?? []);
  const base = new URL(finalUrl);
  let insecureActions = 0;
  let sensitiveInputs = 0;
  let getSensitiveForms = 0;
  let sensitivePostForms = 0;
  let sensitivePostWithoutCsrfHint = 0;
  const externalActions: string[] = [];

  for (const block of tags) {
    const openingTag = block.match(/^<form\b[^>]*>/i)?.[0] ?? block;
    const action = getAttr(openingTag, "action");
    const method = (getAttr(openingTag, "method") || "get").toLowerCase();
    const hasSensitiveInput = /<input\b[^>]*(?:type\s*=\s*["']?password|name\s*=\s*["']?(?:password|passwd|passcode|credit_card|card_number|cvv|ssn)\b)/i.test(block);
    const hasCsrfHint = /<input\b[^>]*(?:name|id)\s*=\s*["'][^"']*(?:csrf|xsrf|authenticity|request[_-]?token|nonce)[^"']*["']/i.test(block);

    if (hasSensitiveInput) sensitiveInputs += 1;
    if (method === "get" && hasSensitiveInput) getSensitiveForms += 1;
    if (method === "post") {
      if (hasSensitiveInput) {
        sensitivePostForms += 1;
        if (!hasCsrfHint) sensitivePostWithoutCsrfHint += 1;
      }
    }

    if (!action) continue;
    try {
      const parsed = new URL(action, base);
      if (parsed.protocol === "http:") insecureActions += 1;
      if (["http:", "https:"].includes(parsed.protocol) && parsed.origin !== base.origin) {
        externalActions.push(parsed.toString());
      }
    } catch {
      // Invalid action values are not treated as external HTTP sends.
    }
  }

  return {
    total: tags.length,
    insecureActions,
    sensitiveInputs,
    getSensitiveForms,
    sensitivePostForms,
    sensitivePostWithoutCsrfHint,
    externalActions: Array.from(new Set(externalActions)).slice(0, 8),
  };
}

function getExternalScripts(html: string, finalUrl: string): { total: number; missingIntegrity: string[] } {
  const base = new URL(finalUrl);
  const tags = html.match(/<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi) ?? [];
  const external: Array<{ url: string; integrity: string }> = [];

  for (const tag of tags) {
    const src = getAttr(tag, "src");
    if (!src) continue;
    try {
      const parsed = new URL(src, base);
      if (["http:", "https:"].includes(parsed.protocol) && parsed.origin !== base.origin) {
        external.push({ url: parsed.toString(), integrity: getAttr(tag, "integrity") });
      }
    } catch {
      // Invalid script URLs are ignored here.
    }
  }

  const unique = Array.from(new Map(external.map((script) => [script.url, script])).values());
  return {
    total: unique.length,
    missingIntegrity: unique.filter((script) => !script.integrity).map((script) => script.url).slice(0, 8),
  };
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
