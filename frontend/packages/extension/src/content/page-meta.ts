// Page-metadata extractor.
//
// Gives the backend prompt a compact, *declared* picture of the page the
// user is working on — site name, what kind of page it is, a one-line
// description, article author / section / date, and the main heading — so
// replies, rewrites, summaries, and explanations are grounded in the right
// context (a support ticket reads differently from a forum thread or a
// news article).
//
// Privacy stance: this reads only metadata the page *declares about
// itself* — Open Graph / Twitter card / standard <meta> tags, JSON-LD
// structured data, <html lang>, and the page's <h1>. It never scrapes
// arbitrary body text; the user's selection (or a site adapter's targeted
// thread/post extraction) supplies the actual content. Everything is
// trimmed, whitespace-collapsed, and capped so the bag stays small and
// the backend's per-value 500-char cap is never the thing that truncates.

// Per-value cap mirrors the backend's `MetaValue` constraint (500). We cap
// a little under so a value is never silently chopped server-side.
const MAX_META_VALUE = 480;

type MetaBag = Record<string, string>;

/** First non-empty `content` among the given meta selectors. */
function metaContent(selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
    const el = document.querySelector<HTMLMetaElement>(selector);
    const content = el?.content?.trim();
    if (content) return content;
  }
  return undefined;
}

/** Normalise + cap a candidate value; returns undefined when empty. */
function clean(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.slice(0, MAX_META_VALUE);
}

/** Pull a handful of useful fields out of the first valid JSON-LD block.
 *  Best-effort: malformed JSON, arrays, and @graph wrappers are tolerated
 *  and simply yield nothing rather than throwing. */
function fromJsonLd(): { author?: string; section?: string; published?: string; type?: string } {
  const out: { author?: string; section?: string; published?: string; type?: string } = {};
  const blocks = document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]');
  for (const block of Array.from(blocks).slice(0, 5)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block.textContent ?? "");
    } catch {
      continue;
    }
    // Unwrap common shapes: a bare object, an array, or an @graph list.
    const candidates: unknown[] = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed["@graph"])
        ? (parsed["@graph"] as unknown[])
        : [parsed];
    for (const node of candidates) {
      if (!isRecord(node)) continue;
      const type = asString(node["@type"]);
      const author = authorName(node["author"]);
      const section = asString(node["articleSection"]);
      const published = asString(node["datePublished"]);
      if (!out.type && type) out.type = type;
      if (!out.author && author) out.author = author;
      if (!out.section && section) out.section = section;
      if (!out.published && published) out.published = published;
    }
    if (out.author || out.section || out.published) break;
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** JSON-LD `author` may be a string, an object with `name`, or an array. */
function authorName(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return authorName(v[0]);
  if (isRecord(v)) return asString(v["name"]);
  return undefined;
}

/**
 * Build the page-metadata bag. Keys are intentionally human-readable —
 * the backend renders them verbatim as `key: value` lines inside the
 * untrusted-context block, so they double as labels for the model.
 *
 * Returns an empty object when the page declares nothing useful; callers
 * should spread it only when non-empty.
 */
export function extractPageMeta(): MetaBag {
  const jsonLd = fromJsonLd();
  const bag: MetaBag = {};

  const set = (key: string, value: string | undefined): void => {
    const cleaned = clean(value);
    if (cleaned && !(key in bag)) bag[key] = cleaned;
  };

  set(
    "siteName",
    metaContent(['meta[property="og:site_name"]', 'meta[name="application-name"]']) ??
      window.location.hostname,
  );
  set("pageType", metaContent(['meta[property="og:type"]']) ?? jsonLd.type);
  set(
    "description",
    metaContent([
      'meta[property="og:description"]',
      'meta[name="description"]',
      'meta[name="twitter:description"]',
    ]),
  );
  set(
    "author",
    metaContent(['meta[name="author"]', 'meta[property="article:author"]']) ?? jsonLd.author,
  );
  set("section", metaContent(['meta[property="article:section"]']) ?? jsonLd.section);
  set("published", metaContent(['meta[property="article:published_time"]']) ?? jsonLd.published);
  set("pageLanguage", document.documentElement.getAttribute("lang") ?? undefined);
  // The main heading is often more specific than <title> (which carries
  // site boilerplate). Only added when it differs from the title.
  const heading = clean(document.querySelector("h1")?.innerText);
  const title = clean(document.title);
  if (heading && heading !== title) set("heading", heading);

  return bag;
}
