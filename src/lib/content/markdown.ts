// WORKPLACE Markdown → editor content (TipTap JSON). Lets people write a page anywhere — Notes, a doc,
// an AI chat — and paste it into any WORKPLACE editor fully formatted. The rules are documented for
// writers at /help/writing; the server sanitizer still checks everything on save.
import { isSafeHref, isSafeImageSrc, toEmbed, type JSONNode } from "./format";

type Mark = NonNullable<JSONNode["marks"]>[number];
type Person = { id: string; name: string };
interface Ctx {
  people: Person[];
}

const CALLOUTS: Record<string, string> = { INFO: "info", TIP: "info", NOTE: "note", SUCCESS: "success", DONE: "success", WARNING: "warning", CAUTION: "warning", IMPORTANT: "danger", DANGER: "danger" };

const RE = {
  fence: /^\s*```\s*([\w+#-]*)\s*$/,
  heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/,
  quote: /^\s*>\s?/,
  callout: /^\[!([A-Za-z]+)\]\s*(.*)$/,
  item: /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/,
  task: /^\[([ xX])\]\s+(.*)$/,
  tableRow: /^\s*\|.*\|\s*$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
  image: /^\s*!\[([^\]]*)\]\(\s*(\S+?)(?:\s+"([^"]*)")?\s*\)\s*$/,
  url: /^\s*<?(https?:\/\/[^\s<>]+?)>?\s*$/,
  columnsOpen: /^\s*:::\s*columns\s*$/i,
  columnsNext: /^\s*:::\s*(?:next|column)\s*$/i,
  blockEnd: /^\s*:::\s*$/,
};

const indentOf = (line: string) => line.match(/^\s*/)![0].replace(/\t/g, "  ").length;
const isBlank = (line: string) => !line.trim();

/** Lines that start a new block (and so end a running paragraph). */
function startsBlock(line: string, next?: string) {
  return (
    RE.fence.test(line) ||
    RE.heading.test(line) ||
    RE.hr.test(line) ||
    RE.quote.test(line) ||
    RE.item.test(line) ||
    RE.image.test(line) ||
    RE.url.test(line) ||
    RE.columnsOpen.test(line) ||
    RE.columnsNext.test(line) ||
    RE.blockEnd.test(line) ||
    (RE.tableRow.test(line) && !!next && RE.tableSep.test(next))
  );
}

// ───────────── Inline ─────────────

const INLINE: { re: RegExp; make: (m: RegExpExecArray, ctx: Ctx) => JSONNode[] }[] = [
  { re: /`([^`]+)`/, make: (m) => [{ type: "text", text: m[1], marks: [{ type: "code" }] }] },
  { re: /@date\((\d{4}-\d{2}-\d{2})\)/, make: (m) => (isRealDate(m[1]) ? [{ type: "dateChip", attrs: { date: m[1] } }] : [{ type: "text", text: m[0] }]) },
  {
    re: /@\[([^\]]{2,120})\]/,
    make: (m, ctx) => {
      const p = findPerson(ctx.people, m[1]);
      return p ? [{ type: "mention", attrs: { id: p.id, label: p.name } }] : [{ type: "text", text: `@${m[1]}` }];
    },
  },
  {
    re: /\[([^\]]+)\]\(\s*([^)\s]+)\s*\)/,
    make: (m, ctx) => (isSafeHref(m[2]) ? withMark(inline(m[1], ctx), { type: "link", attrs: { href: m[2] } }) : inline(m[1], ctx)),
  },
  { re: /\*\*(.+?)\*\*|__(.+?)__/, make: (m, ctx) => withMark(inline(m[1] ?? m[2], ctx), { type: "bold" }) },
  { re: /~~(.+?)~~/, make: (m, ctx) => withMark(inline(m[1], ctx), { type: "strike" }) },
  { re: /==(.+?)==/, make: (m, ctx) => withMark(inline(m[1], ctx), { type: "highlight" }) },
  { re: /\+\+(.+?)\+\+/, make: (m, ctx) => withMark(inline(m[1], ctx), { type: "underline" }) },
  { re: /\*(?!\s)([^*]+?)\*|(?<![\w])_(?!\s)([^_]+?)_(?![\w])/, make: (m, ctx) => withMark(inline(m[1] ?? m[2], ctx), { type: "italic" }) },
  {
    re: /https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]/,
    make: (m) => [{ type: "text", text: m[0], marks: [{ type: "link", attrs: { href: m[0] } }] }],
  },
];

function isRealDate(d: string) {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

function findPerson(people: Person[], name: string) {
  const n = name.trim().toLowerCase();
  return people.find((p) => p.name.toLowerCase() === n) ?? (n.length >= 3 ? people.filter((p) => p.name.toLowerCase().startsWith(n)) : []).find((_, __, all) => all.length === 1);
}

function withMark(nodes: JSONNode[], mark: Mark): JSONNode[] {
  return nodes.map((n) => {
    if (n.type !== "text" || n.marks?.some((m) => m.type === "code" || m.type === mark.type)) return n;
    return { ...n, marks: [...(n.marks ?? []), mark] };
  });
}

/** Inline Markdown → text nodes with marks, dates and mentions. */
export function inline(text: string, ctx: Ctx = { people: [] }): JSONNode[] {
  const out: JSONNode[] = [];
  let rest = text;
  while (rest) {
    let best: { i: number; m: RegExpExecArray; make: (typeof INLINE)[number]["make"] } | null = null;
    for (const r of INLINE) {
      const m = r.re.exec(rest);
      if (m && (!best || m.index < best.i)) best = { i: m.index, m, make: r.make };
    }
    if (!best) {
      out.push({ type: "text", text: rest });
      break;
    }
    if (best.i > 0) out.push({ type: "text", text: rest.slice(0, best.i) });
    out.push(...best.make(best.m, ctx));
    rest = rest.slice(best.i + best.m[0].length);
  }
  // merge neighbouring plain text so the editor gets tidy nodes
  return out.reduce<JSONNode[]>((acc, n) => {
    const last = acc[acc.length - 1];
    if (n.type === "text" && !n.text) return acc;
    if (last?.type === "text" && n.type === "text" && !last.marks && !n.marks) last.text += n.text!;
    else acc.push({ ...n });
    return acc;
  }, []);
}

/** A paragraph from one or more lines; a single line break inside a paragraph is kept as a line break. */
function paragraph(lines: string[], ctx: Ctx): JSONNode {
  const content: JSONNode[] = [];
  lines.forEach((l, i) => {
    if (i) content.push({ type: "hardBreak" });
    content.push(...inline(l.trim().replace(/\\$/, ""), ctx));
  });
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

// ───────────── Blocks ─────────────

function dedent(lines: string[]) {
  const min = Math.min(...lines.filter((l) => !isBlank(l)).map(indentOf), Infinity);
  return lines.map((l) => (isBlank(l) ? "" : l.replace(/\t/g, "  ").slice(Number.isFinite(min) ? min : 0)));
}

function parseList(lines: string[], start: number, ctx: Ctx): { node: JSONNode; next: number } {
  const first = RE.item.exec(lines[start])!;
  const base = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const isTask = !ordered && RE.task.test(first[3]);
  const items: { text: string; checked: boolean; children: string[] }[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      // a blank line ends the list unless more of it follows
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      const nxt = lines[j];
      const nm = nxt !== undefined ? RE.item.exec(nxt) : null;
      const continues = nxt !== undefined && ((nm && indentOf(nxt) === base && /\d/.test(nm[2]) === ordered) || (indentOf(nxt) > base && items.length > 0));
      if (!continues) break;
      items[items.length - 1]?.children.push("");
      i = j;
      continue;
    }
    const m = RE.item.exec(line);
    const ind = indentOf(line);
    if (m && ind === base) {
      if (/\d/.test(m[2]) !== ordered || RE.task.test(m[3]) !== isTask) break;
      const t = isTask ? RE.task.exec(m[3])! : null;
      items.push({ text: t ? t[2] : m[3], checked: !!t && t[1].toLowerCase() === "x", children: [] });
    } else if (ind > base && items.length) items[items.length - 1].children.push(line);
    else break;
    i++;
  }
  const itemType = isTask ? "taskItem" : "listItem";
  const node: JSONNode = {
    type: isTask ? "taskList" : ordered ? "orderedList" : "bulletList",
    ...(ordered && Number(first[2].replace(/\D/g, "")) > 1 ? { attrs: { start: Number(first[2].replace(/\D/g, "")) } } : {}),
    content: items.map((it) => ({
      type: itemType,
      ...(isTask ? { attrs: { checked: it.checked } } : {}),
      content: [paragraph([it.text], ctx), ...parseBlocks(dedent(it.children), ctx)],
    })),
  };
  return { node, next: i };
}

function cells(row: string) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function table(rows: string[], ctx: Ctx): JSONNode {
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const width = Math.max(head.length, ...body.map((r) => r.length));
  const cell = (type: string, text: string): JSONNode => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [text ? { type: "paragraph", content: inline(text, ctx) } : { type: "paragraph" }] });
  const row = (type: string, r: string[]): JSONNode => ({ type: "tableRow", content: Array.from({ length: width }, (_, k) => cell(type, r[k] ?? "")) });
  return { type: "table", content: [row("tableHeader", head), ...body.map((r) => row("tableCell", r))] };
}

function parseBlocks(lines: string[], ctx: Ctx): JSONNode[] {
  const out: JSONNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    // ``` code ```
    const fence = RE.fence.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      const text = body.join("\n");
      out.push({ type: "codeBlock", attrs: { language: fence[1] || null }, ...(text ? { content: [{ type: "text", text }] } : {}) });
      continue;
    }
    // :::columns … :::next … :::
    if (RE.columnsOpen.test(line)) {
      const parts: string[][] = [[]];
      let depth = 0;
      i++;
      for (; i < lines.length; i++) {
        const l = lines[i];
        if (RE.columnsOpen.test(l)) depth++;
        else if (RE.blockEnd.test(l)) {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0 && RE.columnsNext.test(l)) {
          parts.push([]);
          continue;
        }
        parts[parts.length - 1].push(l);
      }
      i++;
      const cols = parts.map((p) => parseBlocks(p, ctx)).filter((c) => c.length);
      while (cols.length > 3) cols[cols.length - 2].push(...cols.pop()!);
      if (cols.length >= 2) out.push({ type: "columns", content: cols.map((c) => ({ type: "column", content: c })) });
      else out.push(...(cols[0] ?? []));
      continue;
    }
    if (RE.columnsNext.test(line) || RE.blockEnd.test(line)) {
      i++; // a stray marker: ignore it
      continue;
    }
    const h = RE.heading.exec(line);
    if (h) {
      out.push({ type: "heading", attrs: { level: Math.min(3, h[1].length) }, content: inline(h[2], ctx) });
      i++;
      continue;
    }
    if (RE.hr.test(line)) {
      out.push({ type: "horizontalRule" });
      i++;
      continue;
    }
    // > quote, or > [!INFO] callout
    if (RE.quote.test(line)) {
      const body: string[] = [];
      while (i < lines.length && RE.quote.test(lines[i])) body.push(lines[i++].replace(RE.quote, ""));
      const c = RE.callout.exec(body[0].trim());
      const tone = c ? CALLOUTS[c[1].toUpperCase()] : undefined;
      if (c && tone) {
        const inner = parseBlocks(body.slice(1), ctx);
        const title = c[2].trim() ? [{ type: "paragraph", content: withMark(inline(c[2].trim(), ctx), { type: "bold" }) }] : [];
        const content = [...title, ...inner];
        out.push({ type: "callout", attrs: { tone }, content: content.length ? content : [{ type: "paragraph" }] });
      } else {
        const content = parseBlocks(body, ctx);
        out.push({ type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] });
      }
      continue;
    }
    if (RE.tableRow.test(line) && lines[i + 1] !== undefined && RE.tableSep.test(lines[i + 1])) {
      const rows: string[] = [];
      while (i < lines.length && RE.tableRow.test(lines[i])) rows.push(lines[i++]);
      out.push(table(rows, ctx));
      continue;
    }
    if (RE.item.test(line)) {
      const { node, next } = parseList(lines, i, ctx);
      out.push(node);
      i = next;
      continue;
    }
    const img = RE.image.exec(line);
    if (img) {
      if (isSafeImageSrc(img[2])) out.push({ type: "image", attrs: { src: img[2], alt: img[1] || null, title: img[3] || null } });
      else out.push(paragraph([img[1] || img[2]], ctx));
      i++;
      continue;
    }
    // a link alone on its line: embedded player/document when the site allows it, otherwise a link card
    const url = RE.url.exec(line);
    if (url && isSafeHref(url[1])) {
      out.push(toEmbed(url[1]) ? { type: "embed", attrs: { url: url[1] } } : { type: "bookmark", attrs: { url: url[1], title: "" } });
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && (!para.length || !startsBlock(lines[i], lines[i + 1]))) para.push(lines[i++]);
    out.push(paragraph(para, ctx));
  }
  return out;
}

/** Converts WORKPLACE Markdown into an editor document. `people` resolves @[Full Name] mentions. */
export function markdownToDoc(md: string, people: Person[] = []): JSONNode {
  const lines = md.replace(/\r\n?/g, "\n").replace(/ /g, " ").split("\n");
  const content = parseBlocks(lines, { people });
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/**
 * Whether pasted plain text is meant as WORKPLACE Markdown. With rich HTML on the clipboard too (copied
 * from a web page or doc) only unmistakable markers count, so ordinary formatted pastes behave as before.
 */
export function looksLikeMarkdown(text: string, hasHtml: boolean) {
  const strong = [/^\s*>\s*\[!\w+\]/m, /^\s*:::\s*columns\s*$/im, /@date\(\d{4}-\d{2}-\d{2}\)/, /@\[[^\]]+\]/, /^\s*\|.*\|\s*\n\s*\|?\s*:?-{2,}/m, /^\s*[-*]\s+\[[ xX]\]\s/m, /^#{1,3}\s+\S/m, /^\s*```/m];
  if (strong.some((r) => r.test(text))) return true;
  if (hasHtml) return false;
  return [/\*\*[^*\n]+\*\*/, /^\s*[-*+]\s+\S/m, /^\s*\d+[.)]\s+\S/m, /\[[^\]]+\]\(https?:\/\/[^)]+\)/, /^\s*>\s/m, /^\s*-{3,}\s*$/m].some((r) => r.test(text));
}
