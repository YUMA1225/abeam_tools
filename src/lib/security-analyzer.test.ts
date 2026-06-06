import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSecurityHtml } from "./security-analyzer.ts";
import type { ProbeResult, SecurityCheck } from "./security-types.ts";

function analyze(overrides: Record<string, unknown> = {}) {
  return analyzeSecurityHtml({
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    html: '<!doctype html><html><head><title>Example</title><link rel="icon" href="/favicon.ico"></head><body></body></html>',
    headers: {
      "strict-transport-security": "max-age=31536000",
      "content-security-policy": "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
    probes: [],
    httpRedirect: {
      status: 301,
      location: "https://example.com/",
      finalUrl: "https://example.com/",
      redirectedToHttps: true,
    },
    dns: {
      spf: [],
      dmarc: [],
      mx: [],
      caa: [],
      ds: [],
      mtaSts: [],
      tlsRpt: [],
    },
    cors: {
      checked: true,
      allowOrigin: "",
      allowCredentials: "",
      vary: "",
    },
    httpMethods: {
      checked: true,
      status: 204,
      allow: "GET, HEAD, OPTIONS",
    },
    ...overrides,
  });
}

function findCheck(report: ReturnType<typeof analyze>, id: string): SecurityCheck {
  const check = report.categories.flatMap((category) => category.checks).find((item) => item.id === id);
  assert.ok(check, `check not found: ${id}`);
  return check;
}

function probe(id: string, bodySnippet: string, options: Partial<ProbeResult> = {}): ProbeResult {
  return {
    id,
    url: `https://example.com/${id}`,
    status: 200,
    ok: true,
    redirected: false,
    contentType: "text/html",
    headers: {},
    bodySnippet,
    ...options,
  };
}

test("frame-ancestors wildcard is not treated as clickjacking protection", () => {
  const report = analyze({
    headers: {
      "content-security-policy": "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors *",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });

  assert.equal(findCheck(report, "x-frame").status, "warn");
});

test("CSP without an effective script policy is reported as weak", () => {
  const report = analyze({
    headers: {
      "content-security-policy": "object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });

  const csp = findCheck(report, "csp");
  assert.equal(csp.status, "warn");
  assert.match(csp.detail, /script-src\/default-srcなし/);
});

test("ordinary HTTP hyperlinks are not mixed content, but HTTP resources are", () => {
  const linkReport = analyze({
    html: '<!doctype html><title>Example</title><a href="http://example.net/page">external link</a>',
  });
  assert.equal(findCheck(linkReport, "mixed-content").status, "pass");

  const imageReport = analyze({
    html: '<!doctype html><title>Example</title><img src="http://cdn.example.net/image.png">',
  });
  assert.equal(findCheck(imageReport, "mixed-content").status, "warn");
});

test("empty WordPress user arrays and installed setup pages are not failures", () => {
  const probes = [
    probe("wp-users", "[]", { contentType: "application/json" }),
    probe("wp-install", "<html><body>WordPress is already installed.</body></html>"),
  ];
  const report = analyze({
    html: '<!doctype html><title>Example</title><link rel="stylesheet" href="/wp-content/theme.css">',
    probes,
  });

  assert.equal(findCheck(report, "wp-users").status, "pass");
  assert.equal(findCheck(report, "wp-install").status, "pass");
});

test("domains without mail evidence do not receive SPF or DMARC warnings", () => {
  const report = analyze();
  assert.equal(findCheck(report, "spf").status, "info");
  assert.equal(findCheck(report, "spf").weight, 0);
  assert.equal(findCheck(report, "dmarc").status, "info");
  assert.equal(findCheck(report, "dmarc").weight, 0);
});

test("HSTS without includeSubDomains can still pass when max-age is sufficient", () => {
  const report = analyze();
  assert.equal(findCheck(report, "hsts").status, "pass");
});

test("WordPress XML-RPC 405 responses are detected from their public message", () => {
  const report = analyze({
    html: '<!doctype html><title>Example</title><link rel="stylesheet" href="/wp-content/theme.css">',
    probes: [
      probe("xmlrpc", "XML-RPC server accepts POST requests only.", {
        status: 405,
        ok: false,
        contentType: "text/plain",
      }),
    ],
  });

  assert.equal(findCheck(report, "xmlrpc").status, "warn");
});

test("OPTIONS metadata reports advertised dangerous methods without sending them", () => {
  const report = analyze({
    httpMethods: {
      checked: true,
      status: 204,
      allow: "GET, HEAD, OPTIONS, TRACE",
    },
  });
  assert.equal(findCheck(report, "http-methods").status, "fail");
});

test("forms without CSP form-action are reported from static HTML", () => {
  const report = analyze({
    html: '<!doctype html><title>Login</title><form method="post"><input type="password" name="password"></form>',
  });
  assert.equal(findCheck(report, "form-action-csp").status, "warn");
  assert.equal(findCheck(report, "form-csrf").status, "warn");
});

test("known sensitive configuration signatures are treated as exposed", () => {
  const report = analyze({
    probes: [
      probe("appsettings", '{"ConnectionStrings":{"DefaultConnection":"Server=db;Password=secret"}}', {
        contentType: "application/json",
      }),
    ],
  });
  assert.equal(findCheck(report, "sensitive-files").status, "fail");
});

test("high-risk public JavaScript token patterns are detected", () => {
  const report = analyze({
    html: '<!doctype html><title>Example</title><script>const token = "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ";</script>',
  });
  assert.equal(findCheck(report, "client-code-secrets").status, "fail");
});

test("report includes actual passive coverage counts", () => {
  const report = analyze({
    probes: [
      probe("env", "", { status: 404, ok: false }),
      probe("client-script-0", "console.log('ok')", { contentType: "application/javascript" }),
      probe("source-map-0", "", { status: 0, ok: false }),
    ],
  });

  assert.deepEqual(report.coverage, {
    publicPathsChecked: 1,
    unavailablePaths: 1,
    clientScriptsChecked: 1,
    sourceMapsChecked: 0,
    optionsChecked: true,
  });
});
