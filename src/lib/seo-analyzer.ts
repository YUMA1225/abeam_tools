import type {
  CheckStatus,
  HeadingCounts,
  HeadingItem,
  SeoCategory,
  SeoCategoryKey,
  SeoCheck,
  SeoReport,
} from "./seo-types";

type AnalyzeInput = {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  html: string;
  robotsTxt?: string;
};

type SchemaObject = Record<string, unknown>;

type JsonLdResult = {
  scripts: number;
  schemas: SchemaObject[];
  types: string[];
};

const CATEGORY_LABELS: Record<SeoCategoryKey, string> = {
  basic: "SEO基本",
  technical: "テクニカル",
  ogp: "OGP/SNS",
  structured: "構造化データ",
  meo: "MEO",
  aio: "AIO（AI最適化）",
};

export function analyzeHtml(input: AnalyzeInput): SeoReport {
  const { html, finalUrl } = input;
  const url = new URL(finalUrl);
  const text = getVisibleText(html);
  const title = getTitle(html);
  const description = getMeta(html, "name", "description");
  const canonical = getLink(html, "canonical");
  const robots = getMeta(html, "name", "robots");
  const viewport = getMeta(html, "name", "viewport");
  const charset = getCharset(html);
  const lang = getHtmlLang(html);
  const manifest = getLink(html, "manifest");
  const hreflangCount = getHreflangCount(html);
  const headings = getHeadings(html);
  const headingCounts = getHeadingCounts(headings);
  const h1 = headings.filter((heading) => heading.level === 1).map((heading) => heading.text);
  const images = getImages(html);
  const links = getLinks(html, finalUrl);
  const paragraphs = getParagraphCount(html);
  const jsonLd = getJsonLd(html);
  const types = jsonLd.types;
  const org = findSchema(jsonLd.schemas, ["Organization", "LocalBusiness", "Store", "Restaurant", "ProfessionalService"]);
  const person = findSchema(jsonLd.schemas, ["Person"]);
  const article = findSchema(jsonLd.schemas, ["Article", "BlogPosting", "TechArticle", "NewsArticle"]);
  const local = findSchema(jsonLd.schemas, ["LocalBusiness", "Store", "Restaurant", "ProfessionalService"]) ?? org;
  const faq = findSchema(jsonLd.schemas, ["FAQPage"]);
  const website = findSchema(jsonLd.schemas, ["WebSite"]);
  const product = findSchema(jsonLd.schemas, ["Product"]);
  const howTo = findSchema(jsonLd.schemas, ["HowTo"]);
  const breadcrumb = findSchema(jsonLd.schemas, ["BreadcrumbList"]);
  const hasSearchAction = jsonLd.schemas.some((schema) => containsType(schema.potentialAction, "SearchAction"));
  const orgName = stringValue(local?.name) || stringValue(org?.name);
  const author = getAuthor(person, article, html);
  const dates = getDates(article, html);
  const orgSameAs = getSameAs(org);
  const sameAs = orgSameAs.length > 0 ? orgSameAs : getSameAs(person);
  const faqCount = countFaq(faq);
  const hasHttps = url.protocol === "https:";

  const og = {
    title: getMeta(html, "property", "og:title"),
    description: getMeta(html, "property", "og:description"),
    image: getMeta(html, "property", "og:image"),
    url: getMeta(html, "property", "og:url"),
    type: getMeta(html, "property", "og:type"),
    siteName: getMeta(html, "property", "og:site_name"),
    locale: getMeta(html, "property", "og:locale"),
  };
  const twitter = {
    card: getMeta(html, "name", "twitter:card"),
    title: getMeta(html, "name", "twitter:title"),
    description: getMeta(html, "name", "twitter:description"),
    image: getMeta(html, "name", "twitter:image"),
    site: getMeta(html, "name", "twitter:site"),
  };

  const categories: SeoCategory[] = [
    category("basic", [
      lengthCheck("title", "タイトルタグ", title.length, 30, 60, title),
      lengthCheck("description", "メタディスクリプション", description.length, 70, 120, description),
      check("h1", "H1タグ", h1.length === 1 ? "pass" : h1.length === 0 ? "fail" : "warn", `H1タグ: ${h1.length}個（推奨: 1個）`, h1.join("\n"), h1.length === 0 ? "H1タグを1つ設定してください。" : "H1タグは1ページ1個に整理してください。", 3),
      check("heading-structure", "見出し構造（H2〜H6）", headings.length > h1.length ? "pass" : "warn", `見出し合計: ${Math.max(0, headings.length - h1.length)}個`, summarizeHeadings(headings), "H2以降の見出しで本文構造を整理してください。", 2),
      check("image-alt", "画像 alt属性", images.missingAlt === 0 ? "pass" : "warn", `${images.total}枚中 ${images.missingAlt}枚がalt未設定`, images.missingAltSources.join("\n"), "全画像にalt属性を設定するとSEOとアクセシビリティが向上します。", 2),
      check("lang", "HTML lang属性", lang ? "pass" : "fail", lang ? `lang="${lang}"` : "未設定", "htmlタグにlang属性を設定してください。", 2),
      check("links", "リンク構造", links.total > 0 ? "pass" : "warn", `内部リンク: ${links.internal}本 / 外部リンク: ${links.external}本`, "関連ページへの内部リンクと信頼できる外部リンクを整理してください。", 1),
    ]),
    category("technical", [
      check("https", "HTTPS", hasHttps ? "pass" : "fail", hasHttps ? "HTTPS対応済み" : "HTTPで配信されています", "本番ページはHTTPSで配信してください。", 3),
      check("canonical", "canonical タグ", canonical ? "pass" : "fail", canonical || "未設定", "canonicalタグを設定してください。", 2),
      check("robots", "robots metaタグ", robots ? (/noindex/i.test(robots) ? "fail" : "pass") : "info", robots || "未設定（デフォルト: index, follow）", robots ? "noindex設定がないか確認してください。" : "noindex設定はありません。", robots ? 2 : 0),
      check("viewport", "viewport metaタグ", viewport ? "pass" : "fail", viewport || "未設定", "viewport metaタグを設定してください。", 2),
      check("charset", "文字コード（charset）", charset ? "pass" : "fail", charset ? `charset="${charset}"` : "未設定", "charsetを明示してください。", 1),
      check("hreflang", "hreflang（多言語対応）", hreflangCount > 0 ? "pass" : "info", hreflangCount > 0 ? `${hreflangCount}件` : "未設定（多言語サイトでなければ不要）", "多言語サイトの場合はhreflangを設定してください。", hreflangCount > 0 ? 1 : 0),
      check("manifest", "PWA Manifest", manifest ? "pass" : "info", manifest || "未設定", "必要に応じてWeb App Manifestを設定してください。", manifest ? 1 : 0),
    ]),
    category("ogp", [
      check("og-preview", "OGPプレビュー（SNSシェア時イメージ）", og.title && og.description && og.image ? "pass" : "fail", "SNSでシェアされた際の見え方", [url.hostname.toUpperCase(), og.title, og.description].filter(Boolean).join("\n"), "og:title、og:description、og:imageを揃えてください。", 2),
      check("og-title", "og:title", og.title ? "pass" : "fail", og.title || "未設定", "", "og:titleを設定してください。", 2),
      check("og-description", "og:description", og.description ? "pass" : "fail", og.description ? truncate(og.description, 96) : "未設定", og.description, "og:descriptionを設定してください。", 2),
      check("og-image", "og:image", og.image ? "pass" : "fail", og.image || "未設定", "SNS共有用画像を設定してください。", 3),
      check("og-url", "og:url", og.url ? "pass" : "fail", og.url || "未設定", "og:urlを設定してください。", 1),
      check("og-type", "og:type", og.type ? "pass" : "fail", og.type || "未設定", "og:typeを設定してください。", 1),
      check("og-site-name", "og:site_name", og.siteName ? "pass" : "fail", og.siteName || "未設定", "サイト名を設定してください。", 1),
      check("og-locale", "og:locale", og.locale ? "pass" : "info", og.locale || "未設定", "日本語ページではja_JPなどを設定できます。", og.locale ? 1 : 0),
      check("twitter-card", "twitter:card", twitter.card ? "pass" : "fail", twitter.card || "未設定", "twitter:cardを設定してください。", 1),
      check("twitter-title", "twitter:title", twitter.title ? "pass" : "fail", twitter.title || "未設定", "twitter:titleを設定してください。", 1),
      check("twitter-description", "twitter:description", twitter.description ? "pass" : "fail", twitter.description || "未設定", "twitter:descriptionを設定してください。", 1),
      check("twitter-image", "twitter:image", twitter.image ? "pass" : "fail", twitter.image || "未設定", "twitter:imageを設定してください。", 1),
      check("twitter-site", "twitter:site", twitter.site ? "pass" : "info", twitter.site || "未設定", "twitter:siteが未設定です。X(Twitter)シェア時に影響します。", twitter.site ? 1 : 0),
    ]),
    category("structured", [
      check("jsonld-total", "JSON-LD 総数", jsonLd.schemas.length > 0 ? "pass" : "fail", `${jsonLd.scripts}件のスクリプト / ${jsonLd.schemas.length}スキーマ検出`, "JSON-LDで構造化データを設定してください。", 3),
      check("schema-types", "検出されたスキーマタイプ", "info", types.join(" / ") || "未設定", summarizeSchemas(jsonLd.schemas), "ページ内容に合うschema typeを設定してください。", 0),
      check("website-schema", "WebSite スキーマ", website ? "pass" : "info", website ? `WebSite: ${stringValue(website.name)}` : "未設定", "WebSiteスキーマを設定するとサイト名が検索結果に表示されます。", website ? 1 : 0),
      check("searchaction", "SearchAction（サイト内検索）", hasSearchAction ? "pass" : "info", hasSearchAction ? "設定済み" : "未設定", "SearchActionでGoogleにサイト内検索ボックスを表示できます。", hasSearchAction ? 1 : 0),
      check("breadcrumb", "BreadcrumbList スキーマ", breadcrumb ? "pass" : "info", breadcrumb ? `BreadcrumbList: ${stringValue(breadcrumb.name)}` : "未設定", "", "パンくずリストをスキーマ化すると検索結果に表示されます。", breadcrumb ? 1 : 0),
      check("faq", "FAQPage スキーマ", faq ? "pass" : "info", faq ? `FAQPage: ${faqCount > 0 ? `${faqCount}件` : ""}` : "未設定", "FAQがあるページではFAQPageを設定してください。", faq ? 1 : 0),
      check("article", "Article / BlogPosting", article ? "pass" : "info", article ? `${typeLabel(article)}: ${stringValue(article.headline) || stringValue(article.name)}` : "未設定", "記事ページではArticle / BlogPostingを設定してください。", article ? 2 : 0),
      check("product", "Product スキーマ", product ? "pass" : "info", product ? `Product: ${stringValue(product.name)}` : "未設定", "商品ページにはProductスキーマで価格・評価を構造化しましょう。", product ? 1 : 0),
    ]),
    category("meo", [
      check("localbusiness", "LocalBusiness 構造化データ", local ? "pass" : "warn", local ? `${typeLabel(local)}スキーマを検出` : "未設定（ローカルビジネスは設定推奨）", "", "LocalBusinessスキーマを設定するとGoogle マップでの表示が向上します。", 2),
      check("business-name", "ビジネス名（name）", orgName ? "pass" : "fail", orgName || "未設定", "ビジネス名をnameに設定してください。", 2),
      check("address", "住所（address）", local?.address ? "pass" : "fail", local?.address ? textValue(local?.address) : "未設定", "住所情報はMEOで非常に重要です。PostalAddressで詳細に記載してください。", 3),
      check("telephone", "電話番号（telephone）", local?.telephone ? "pass" : "warn", stringValue(local?.telephone) || "未設定", "電話番号を設定するとGoogle マップ表示が向上します。", 2),
      check("hours", "営業時間（openingHours）", local?.openingHours ? "pass" : "warn", textValue(local?.openingHours) || "未設定", "営業時間を設定するとGoogle マップに表示されます。", 1),
      check("geo", "GPS座標（geo）", local?.geo ? "pass" : "warn", local?.geo ? textValue(local?.geo) : "未設定", "GeoCoordinatesを設定するとGoogle マップのピン精度が向上します。", 1),
      check("hasmap", "Google Maps URL（hasMap）", local?.hasMap ? "pass" : "info", stringValue(local?.hasMap) || "未設定", "Google MapsのURLをhasMapに設定すると関連性が強化されます。", local?.hasMap ? 1 : 0),
      check("rating", "評価（aggregateRating）", local?.aggregateRating ? "pass" : "info", local?.aggregateRating ? textValue(local.aggregateRating) : "未設定", "評価スキーマを設定すると検索結果に★評価が表示されることがあります。", local?.aggregateRating ? 1 : 0),
    ]),
    category("aio", [
      check("content-structure", "コンテンツ構造の明確さ", headingCounts.h2 > 0 && paragraphs > 0 ? "pass" : "warn", `H2: ${headingCounts.h2}個 / H3: ${headingCounts.h3}個 / 段落: ${paragraphs}個 / 推定文字数: 約${text.length.toLocaleString("ja-JP")}字`, "AIが要約しやすいよう、見出しと段落で論点を整理してください。", 3),
      check("faq-aio", "FAQPage スキーマ（AI回答に重要）", faq ? "pass" : "warn", faq ? `${faqCount}件のFAQ` : "未設定", "FAQPageスキーマを設定するとAI回答に引用されやすくなります。", 2),
      check("howto", "HowTo スキーマ", howTo ? "pass" : "info", howTo ? `HowTo: ${stringValue(howTo.name)}` : "未設定（手順コンテンツは追加推奨）", "HowToスキーマを設定するとAI検索エンジンが手順を正確に引用しやすくなります。", howTo ? 1 : 0),
      check("author", "著者情報（Person / meta author）", author ? "pass" : "warn", author || "未設定", "著者情報を設定してください。", 2),
      check("dates", "公開日・更新日", dates ? "pass" : "warn", dates || "未設定", "公開日・更新日を明記してください。", 2),
      check("organization", "Organization スキーマ", org ? "pass" : "warn", org ? `Organization: ${stringValue(org.name)}` : "未設定", "運営組織の構造化データを設定してください。", 2),
      check("eeat", "E-E-A-T シグナル（About・会社情報）", hasAboutLink(html) ? "pass" : "warn", hasAboutLink(html) ? "About/会社情報へのリンクあり" : "About/会社情報へのリンクなし", "信頼性向上のため、会社概要・著者紹介・お問い合わせページへのリンクを配置しましょう。", 1),
      check("sameas", "sameAs（権威サイトとの紐付け）", sameAs.length > 0 ? "pass" : "warn", sameAs.length > 0 ? `設定済み: ${sameAs.join(", ")}` : "未設定", "公式SNSやプロフィールをsameAsで紐付けてください。", 1),
      check("definitions", "定義リスト・用語説明（dl, dfn）", hasDefinitions(html) ? "pass" : "info", `${countDefinitions(html)}個の定義要素を検出`, "専門用語はdl、dfn、FAQなどで説明するとAIが理解しやすくなります。", hasDefinitions(html) ? 1 : 0),
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
    snapshot: {
      title,
      description,
      canonical,
      h1,
      headings: headings.slice(0, 24),
      images,
      links,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      textLength: text.length,
      paragraphCount: paragraphs,
      headingCounts,
      jsonLdCount: jsonLd.scripts,
    },
    categories,
  };
}

function category(key: SeoCategoryKey, checks: SeoCheck[]): SeoCategory {
  const score = getScore(checks);
  const failed = checks.filter((item) => item.status === "fail").length;
  const warned = checks.filter((item) => item.status === "warn").length;

  return {
    key,
    label: CATEGORY_LABELS[key],
    score,
    summary:
      failed > 0
        ? `${failed}件の重要な改善項目があります。`
        : warned > 0
          ? `${warned}件の注意項目があります。`
          : "主要項目は良好です。",
    checks,
  };
}

function check(
  id: string,
  label: string,
  status: CheckStatus,
  detail: string,
  valueOrRecommendation: string,
  recommendationOrWeight: string | number,
  weightMaybe?: number,
): SeoCheck {
  const hasValue = typeof weightMaybe === "number";
  const value = hasValue ? valueOrRecommendation : "";
  const recommendation = hasValue ? String(recommendationOrWeight) : valueOrRecommendation;
  const weight = hasValue ? weightMaybe : Number(recommendationOrWeight);
  return { id, label, status, detail, value, recommendation, weight };
}

function lengthCheck(id: string, label: string, length: number, min: number, max: number, value: string): SeoCheck {
  if (length === 0) {
    return check(id, label, "fail", "未設定", "", `${label}を設定してください。`, 3);
  }
  if (length < min) {
    return check(id, label, "warn", `${length}文字（目安: ${min}〜${max}文字）`, value, "短すぎます。検索結果で内容が伝わりにくい可能性があります。", 3);
  }
  if (length > max) {
    const message = label.includes("ディスクリプション")
      ? "長すぎます。検索結果で切り詰められることがあります。"
      : "長すぎます。検索結果で切り詰められる可能性があります。";
    return check(id, label, "warn", `${length}文字（目安: ${min}〜${max}文字）`, value, message, 3);
  }
  return check(id, label, "pass", `${length}文字（目安: ${min}〜${max}文字）`, value, "", 3);
}

function getScore(checks: SeoCheck[]): number {
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

function getHreflangCount(html: string): number {
  return (html.match(/<link\b[^>]*hreflang=/gi) ?? []).length;
}

function getCharset(html: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const charsetTag = tags.find((tag) => Boolean(getAttr(tag, "charset")));
  return getAttr(charsetTag ?? "", "charset") || getMeta(html, "http-equiv", "content-type");
}

function getHtmlLang(html: string): string {
  return getAttr(html.match(/<html\b[^>]*>/i)?.[0] ?? "", "lang");
}

function getHeadings(html: string): HeadingItem[] {
  return Array.from(html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)).map((match) => ({
    level: Number(match[1]),
    text: decodeText(stripTags(match[2])).trim().replace(/\s+/g, " "),
  }));
}

function getHeadingCounts(headings: HeadingItem[]): HeadingCounts {
  return {
    h2: headings.filter((heading) => heading.level === 2).length,
    h3: headings.filter((heading) => heading.level === 3).length,
    h4: headings.filter((heading) => heading.level === 4).length,
    h5: headings.filter((heading) => heading.level === 5).length,
    h6: headings.filter((heading) => heading.level === 6).length,
  };
}

function summarizeHeadings(headings: HeadingItem[]): string {
  const lines = headings.slice(0, 20).map((heading) => `H${heading.level}: ${heading.text || "空の見出し"}`);
  const rest = headings.length - lines.length;
  return rest > 0 ? `${lines.join("\n")}\n...他${rest}個` : lines.join("\n");
}

function getImages(html: string) {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  const missing = tags.filter((tag) => !getAttr(tag, "alt").trim());
  return {
    total: tags.length,
    missingAlt: missing.length,
    missingAltSources: missing.map((tag) => getAttr(tag, "src") || getAttr(tag, "data-src") || "src未設定").slice(0, 12),
  };
}

function getLinks(html: string, finalUrl: string) {
  const tags = html.match(/<a\b[^>]*>/gi) ?? [];
  const base = new URL(finalUrl);
  let internal = 0;
  let external = 0;
  let nofollow = 0;

  for (const tag of tags) {
    const href = getAttr(tag, "href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    if (getAttr(tag, "rel").toLowerCase().includes("nofollow")) nofollow += 1;
    try {
      const parsed = new URL(href, base);
      if (parsed.hostname === base.hostname) internal += 1;
      else external += 1;
    } catch {
      internal += 1;
    }
  }

  return { total: internal + external, internal, external, nofollow };
}

function getJsonLd(html: string): JsonLdResult {
  const scripts = Array.from(html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi));
  const schemas: SchemaObject[] = [];

  for (const script of scripts) {
    try {
      collectSchemas(JSON.parse(decodeText(script[1]).trim()), schemas, new WeakSet<object>());
    } catch {
      // Invalid JSON-LD is reflected by fewer detected schemas.
    }
  }

  return { scripts: scripts.length, schemas, types: Array.from(new Set(schemas.flatMap((schema) => getTypes(schema)))) };
}

function summarizeSchemas(schemas: SchemaObject[]): string {
  return schemas
    .slice(0, 6)
    .map((schema) => {
      const entries = Object.entries(schema)
        .filter(([key]) => !["@context", "@graph"].includes(key))
        .slice(0, 8)
        .map(([key, value]) => `${key}\n${textValue(value)}`);
      return `🏷 ${typeLabel(schema)}\n${entries.join("\n")}`;
    })
    .join("\n\n");
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function collectSchemas(value: unknown, schemas: SchemaObject[], seen: WeakSet<object>) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSchemas(item, schemas, seen));
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (value["@type"]) schemas.push(value);
  Object.values(value).forEach((item) => collectSchemas(item, schemas, seen));
}

function findSchema(schemas: SchemaObject[], targets: string[]): SchemaObject | undefined {
  return schemas.find((schema) => targets.some((target) => getTypes(schema).includes(target)));
}

function getTypes(schema: SchemaObject): string[] {
  const type = schema["@type"];
  if (typeof type === "string") return type.split(",").map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(type)) return type.filter((item): item is string => typeof item === "string");
  return [];
}

function containsType(value: unknown, target: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsType(item, target));
  if (!isRecord(value)) return false;
  return getTypes(value).includes(target);
}

function typeLabel(schema: SchemaObject): string {
  return getTypes(schema).join(",") || "Schema";
}

function getAuthor(person: SchemaObject | undefined, article: SchemaObject | undefined, html: string): string {
  const metaAuthor = getMeta(html, "name", "author");
  if (person) return `Person: ${stringValue(person.name) || metaAuthor}`;
  if (article?.author) return `author: ${textValue(article.author)}`;
  return metaAuthor;
}

function getDates(article: SchemaObject | undefined, html: string): string {
  const published = stringValue(article?.datePublished) || getMeta(html, "property", "article:published_time");
  const modified = stringValue(article?.dateModified) || getMeta(html, "property", "article:modified_time");
  if (!published && !modified) return "";
  return `公開: ${published || "未設定"} / 更新: ${modified || "未設定"}`;
}

function getSameAs(schema: SchemaObject | undefined): string[] {
  if (!schema) return [];
  const sameAs = schema.sameAs;
  if (Array.isArray(sameAs)) return sameAs.map((item) => String(item));
  return sameAs ? [String(sameAs)] : [];
}

function countFaq(faq: SchemaObject | undefined): number {
  if (!faq || !Array.isArray(faq.mainEntity)) return 0;
  return faq.mainEntity.length;
}

function getParagraphCount(html: string): number {
  return (html.match(/<p\b[^>]*>/gi) ?? []).length;
}

function hasAboutLink(html: string): boolean {
  const signals = [
    "about",
    "company",
    "corporate",
    "profile",
    "contact",
    "inquiry",
    "info",
    "会社概要",
    "会社情報",
    "企業情報",
    "会社案内",
    "運営会社",
    "運営者",
    "運営者情報",
    "著者",
    "著者情報",
    "プロフィール",
    "お問い合わせ",
    "お問合せ",
    "お問い合せ",
    "問合せ",
    "問い合わせ",
    "ご相談",
  ];
  const pattern = new RegExp(signals.map(escapeRegExp).join("|"), "i");
  const links = Array.from(html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi));
  return links.some((match) => {
    const tag = match[0];
    const href = decodeText(getAttr(tag, "href")).trim();
    const text = decodeText(stripTags(match[1])).trim().replace(/\s+/g, "");
    return pattern.test(`${href} ${text}`);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countDefinitions(html: string): number {
  return (html.match(/<(dl|dfn)\b/gi) ?? []).length;
}

function hasDefinitions(html: string): boolean {
  return countDefinitions(html) > 0;
}

function getVisibleText(html: string): string {
  return decodeText(
    stripTags(
      html
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " "),
    ),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function getAttr(tag: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => textValue(item)).filter(Boolean).join(", ");
  if (isRecord(value)) return stringValue(value.name) || Object.entries(value).map(([key, item]) => `${key}: ${textValue(item)}`).join(", ");
  return "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isRecord(value: unknown): value is SchemaObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
