// Server-side guard for rich content: only known nodes/marks with validated attributes are stored,
// so rendered HTML can never contain scripts, unknown iframes or unsafe links.
import { generateHTML } from "@tiptap/html";
import { contentExtensions, CALLOUT_TONES } from "@/lib/content/extensions";
import { isDocJson, isSafeHref, isSafeImageSrc, parseDoc, toEmbed, type JSONNode } from "@/lib/content/format";
import { invalid } from "./errors";

const MAX_LENGTH = 400_000;
const COLOR = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9]{6,40}$/i;
const align = (v: unknown) => (["left", "center", "right", "justify"].includes(String(v)) ? String(v) : null);
const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const cellAttrs = (a: Record<string, unknown>) => ({
  colspan: Math.min(10, Math.max(1, Number(a.colspan) || 1)),
  rowspan: Math.min(50, Math.max(1, Number(a.rowspan) || 1)),
  colwidth: null,
});

type AttrRule = (a: Record<string, unknown>) => Record<string, unknown> | null;
const none: AttrRule = () => ({});

const NODES: Record<string, AttrRule> = {
  doc: none,
  text: none,
  paragraph: (a) => ({ textAlign: align(a.textAlign) }),
  heading: (a) => ({ level: [1, 2, 3].includes(Number(a.level)) ? Number(a.level) : 2, textAlign: align(a.textAlign) }),
  bulletList: none,
  orderedList: (a) => ({ start: Math.max(1, Number(a.start) || 1) }),
  listItem: none,
  taskList: none,
  taskItem: (a) => ({ checked: a.checked === true }),
  blockquote: none,
  codeBlock: (a) => ({ language: /^[a-z0-9+#-]{1,20}$/i.test(String(a.language)) ? String(a.language) : null }),
  horizontalRule: none,
  hardBreak: none,
  image: (a) => (isSafeImageSrc(a.src) ? { src: a.src, alt: str(a.alt, 200) || null, title: str(a.title, 200) || null } : null),
  table: none,
  tableRow: none,
  tableHeader: cellAttrs,
  tableCell: cellAttrs,
  callout: (a) => ({ tone: String(a.tone) in CALLOUT_TONES ? String(a.tone) : "info" }),
  embed: (a) => (toEmbed(a.url) ? { url: str(a.url, 2000) } : null),
  bookmark: (a) => (isSafeHref(a.url) ? { url: a.url, title: str(a.title, 200) } : null),
  fileBlock: (a) => (ID.test(String(a.fileId)) ? { fileId: a.fileId, name: str(a.name, 160) || "File", size: Math.max(0, Number(a.size) || 0) } : null),
  mention: (a) => (ID.test(String(a.id)) ? { id: a.id, label: str(a.label, 120) } : null),
  dateChip: (a) => (/^\d{4}-\d{2}-\d{2}$/.test(String(a.date)) ? { date: a.date } : null),
  columns: none,
  column: none,
};

const MARKS: Record<string, AttrRule> = {
  bold: none,
  italic: none,
  underline: none,
  strike: none,
  code: none,
  link: (a) => (isSafeHref(a.href) ? { href: a.href, target: "_blank", rel: "noopener noreferrer" } : null),
  highlight: (a) => ({ color: COLOR.test(String(a.color)) ? a.color : null }),
  textStyle: (a) => ({ color: COLOR.test(String(a.color)) ? a.color : null }),
};

function clean(n: JSONNode): JSONNode | null {
  const rule = NODES[n.type];
  if (!rule) return null;
  const attrs = rule(n.attrs ?? {});
  if (!attrs) return null;
  const out: JSONNode = { type: n.type };
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (n.type === "text") {
    if (typeof n.text !== "string" || !n.text) return null;
    out.text = n.text.slice(0, 20000);
  }
  if (n.marks?.length) {
    const marks = n.marks.flatMap((m) => {
      const r = MARKS[m.type]?.(m.attrs ?? {});
      return r ? [{ type: m.type, ...(Object.keys(r).length ? { attrs: r } : {}) }] : [];
    });
    if (marks.length) out.marks = marks;
  }
  if (Array.isArray(n.content)) out.content = n.content.map(clean).filter((x): x is JSONNode => !!x);
  return out;
}

/** Validates and normalises a content body (rich JSON or legacy Markdown) before it is stored. */
export function sanitizeContent(body: string): string {
  if (body.length > MAX_LENGTH) throw invalid("The content is too long.");
  if (!isDocJson(body)) return body;
  const doc = parseDoc(body);
  if (!doc) throw invalid("The content could not be read. Please try again.");
  const cleaned = clean(doc) ?? { type: "doc", content: [] };
  // Validate against the real schema (e.g. table/column structure).
  try {
    generateHTML(cleaned as never, contentExtensions());
  } catch {
    throw invalid("The content has an invalid structure.");
  }
  return JSON.stringify(cleaned);
}

/** True when a body has no visible content. */
export function isEmptyContent(body: string) {
  const doc = parseDoc(body);
  if (!doc) return !body.trim();
  const visible = (n: JSONNode): boolean => !!n.text?.trim() || ["image", "embed", "bookmark", "fileBlock", "table", "horizontalRule", "mention", "dateChip"].includes(n.type) || !!n.content?.some(visible);
  return !visible(doc);
}

/** HTML for stored rich content (already sanitised on save; sanitised again defensively). */
export function renderContentHtml(body: string): string {
  const doc = parseDoc(sanitizeContent(body));
  return doc ? generateHTML(doc as never, contentExtensions()) : "";
}
