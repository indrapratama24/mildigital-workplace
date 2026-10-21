// Shared rules for rich content (Company 101, regulations, announcements): which URLs are safe,
// which sites can be embedded, plain-text extraction and the legacy-Markdown bridge.
// Pure TypeScript — used by the editor, the server sanitizer and the renderer.

export interface JSONNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JSONNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

/** Rich content is stored as TipTap JSON; older content is lightweight Markdown text. */
export function isDocJson(body: string | null | undefined): boolean {
  return !!body && body.trimStart().startsWith('{"type":"doc"');
}

export function parseDoc(body: string): JSONNode | null {
  if (!isDocJson(body)) return null;
  try {
    const d = JSON.parse(body) as JSONNode;
    return d?.type === "doc" ? d : null;
  } catch {
    return null;
  }
}

/** http(s) and mailto links, plus app-relative paths. */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length > 2000) return false;
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

/** Images: uploaded files served by the app, or https images. */
export function isSafeImageSrc(src: unknown): src is string {
  if (typeof src !== "string" || src.length > 2000) return false;
  if (/^\/api\/files\/[a-z0-9]+(\?inline=1)?$/i.test(src)) return true;
  try {
    return new URL(src).protocol === "https:";
  } catch {
    return false;
  }
}

export const EMBED_PROVIDERS = ["YouTube", "Vimeo", "Loom", "Google Docs", "Google Slides", "Google Sheets", "Google Drive", "Google Forms", "Google Maps", "Figma", "Canva"] as const;

/**
 * Converts a pasted URL into an embeddable iframe source for allow-listed providers.
 * Anything else returns null and is shown as a link card instead.
 */
export function toEmbed(raw: unknown): { provider: string; src: string; height: number } | null {
  if (typeof raw !== "string") return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "");
  const id = (re: RegExp) => re.exec(u.pathname)?.[1];
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v") ?? id(/^\/(?:embed|shorts|live)\/([\w-]{6,20})/);
    return v && /^[\w-]{6,20}$/.test(v) ? { provider: "YouTube", src: `https://www.youtube-nocookie.com/embed/${v}`, height: 360 } : null;
  }
  if (host === "youtu.be") {
    const v = id(/^\/([\w-]{6,20})/);
    return v ? { provider: "YouTube", src: `https://www.youtube-nocookie.com/embed/${v}`, height: 360 } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = id(/(\d{6,12})/);
    return v ? { provider: "Vimeo", src: `https://player.vimeo.com/video/${v}`, height: 360 } : null;
  }
  if (host === "loom.com") {
    const v = id(/^\/(?:share|embed)\/([a-f0-9]{16,64})/);
    return v ? { provider: "Loom", src: `https://www.loom.com/embed/${v}`, height: 360 } : null;
  }
  if (host === "docs.google.com") {
    const kind = id(/^\/(document|presentation|spreadsheets|forms)\//);
    const doc = id(/\/d\/(?:e\/)?([\w-]{20,120})/);
    if (!kind || !doc) return null;
    const published = u.pathname.includes("/d/e/");
    const base = `https://docs.google.com/${kind}/d/${published ? "e/" : ""}${doc}`;
    if (kind === "presentation") return { provider: "Google Slides", src: `${base}/${published ? "embed" : "preview"}`, height: 420 };
    if (kind === "spreadsheets") return { provider: "Google Sheets", src: `${base}/${published ? "pubhtml?widget=true" : "preview"}`, height: 480 };
    if (kind === "forms") return { provider: "Google Forms", src: `${base}/viewform?embedded=true`, height: 640 };
    return { provider: "Google Docs", src: `${base}/preview`, height: 560 };
  }
  if (host === "drive.google.com") {
    const f = id(/\/file\/d\/([\w-]{20,120})/);
    return f ? { provider: "Google Drive", src: `https://drive.google.com/file/d/${f}/preview`, height: 520 } : null;
  }
  if ((host === "google.com" || host === "maps.google.com") && u.pathname.startsWith("/maps/embed")) {
    return { provider: "Google Maps", src: `https://www.google.com${u.pathname}${u.search}`, height: 360 };
  }
  if (host === "figma.com" && /^\/(file|design|proto|board)\//.test(u.pathname)) {
    return { provider: "Figma", src: `https://www.figma.com/embed?embed_host=mil-workplace&url=${encodeURIComponent(u.toString())}`, height: 450 };
  }
  if (host === "canva.com" && /^\/design\/[\w-]+\/[\w-]+\/view/.test(u.pathname)) {
    return { provider: "Canva", src: `https://www.canva.com${u.pathname.replace(/\/view.*$/, "/view")}?embed`, height: 450 };
  }
  return null;
}

/** Plain text for excerpts, previews and search. */
export function docToText(body: string, max = 600): string {
  const doc = parseDoc(body);
  if (!doc) return body.replace(/[#*_[\]()>`-]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const parts: string[] = [];
  const walk = (n: JSONNode) => {
    if (n.text) parts.push(n.text);
    if (n.type === "mention") parts.push(`@${String(n.attrs?.label ?? "")}`);
    if (n.type === "bookmark") parts.push(String(n.attrs?.title || n.attrs?.url || ""));
    if (n.type === "fileBlock") parts.push(String(n.attrs?.name ?? ""));
    n.content?.forEach(walk);
    if (["paragraph", "heading", "listItem", "taskItem", "tableCell", "tableHeader"].includes(n.type)) parts.push(" ");
  };
  walk(doc);
  return parts.join("").replace(/\s+/g, " ").trim().slice(0, max);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Converts legacy Markdown (headings, lists, bold/italic, links) to HTML so the editor can open it. */
export function markdownToHtml(md: string): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_m, label: string, href: string) => `<a href="${href}">${label}</a>`);
  const out: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li><p>${inline(i)}</p></li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (ul || ol) {
      if (para.length) {
        out.push(`<p>${inline(para.join(" "))}</p>`);
        para = [];
      }
      const tag = ul ? "ul" : "ol";
      if (list && (list as { tag: string }).tag !== tag) flush();
      list ??= { tag, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else {
      if (list) flush();
      para.push(line.trim());
    }
  }
  flush();
  return out.join("");
}
