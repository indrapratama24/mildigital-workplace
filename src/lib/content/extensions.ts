// TipTap schema shared by the editor (browser) and the HTML renderer (server). No React here.
import { Node, mergeAttributes, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { isSafeHref, toEmbed } from "./format";

export const CALLOUT_TONES = {
  info: { emoji: "💡", label: "Info" },
  note: { emoji: "📌", label: "Note" },
  success: { emoji: "✅", label: "Success" },
  warning: { emoji: "⚠️", label: "Warning" },
  danger: { emoji: "🚨", label: "Important" },
} as const;
export type CalloutTone = keyof typeof CALLOUT_TONES;

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { tone: { default: "info", parseHTML: (el) => el.getAttribute("data-tone") ?? "info" } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]', contentElement: "div.callout-body" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const tone = (node.attrs.tone in CALLOUT_TONES ? node.attrs.tone : "info") as CalloutTone;
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "callout", "data-tone": tone, class: `callout callout-${tone}` }),
      ["span", { class: "callout-emoji", contenteditable: "false" }, CALLOUT_TONES[tone].emoji],
      ["div", { class: "callout-body" }, 0],
    ];
  },
});

/** Embedded page from an allow-listed provider; the iframe src is always recomputed from the URL. */
export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: null, parseHTML: (el) => el.getAttribute("data-url") } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="embed"]' }];
  },
  renderHTML({ node }) {
    const e = toEmbed(node.attrs.url);
    if (!e) return ["div", { "data-type": "embed", class: "embed embed-invalid" }, "Embed not supported"];
    return [
      "div",
      { "data-type": "embed", "data-url": node.attrs.url, "data-provider": e.provider, class: "embed" },
      [
        "iframe",
        {
          src: e.src,
          height: String(e.height),
          loading: "lazy",
          allowfullscreen: "true",
          referrerpolicy: "strict-origin-when-cross-origin",
          sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation allow-forms",
          title: `${e.provider} embed`,
        },
      ],
      ["a", { href: node.attrs.url, target: "_blank", rel: "noopener noreferrer", class: "embed-caption" }, `${e.provider} · open in new tab ↗`],
    ];
  },
});

/** Link card for any URL that can't be embedded. */
export const Bookmark = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { url: { default: null, parseHTML: (el) => el.getAttribute("href") }, title: { default: "", parseHTML: (el) => el.getAttribute("data-title") ?? "" } };
  },
  parseHTML() {
    return [{ tag: 'a[data-type="bookmark"]' }];
  },
  renderHTML({ node }) {
    const url = isSafeHref(node.attrs.url) ? node.attrs.url : "#";
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* relative */
    }
    return [
      "a",
      { "data-type": "bookmark", "data-title": node.attrs.title, href: url, target: "_blank", rel: "noopener noreferrer", class: "bookmark" },
      ["span", { class: "bookmark-title" }, node.attrs.title || host],
      ["span", { class: "bookmark-url" }, url],
    ];
  },
});

/** Uploaded file (PDF / image) shown as a download card. */
export const FileBlock = Node.create({
  name: "fileBlock",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      fileId: { default: null, parseHTML: (el) => el.getAttribute("data-file-id") },
      name: { default: "File", parseHTML: (el) => el.getAttribute("data-name") ?? "File" },
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute("data-size") ?? 0) },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-type="file"]' }];
  },
  renderHTML({ node }) {
    const id = /^[a-z0-9]+$/i.test(String(node.attrs.fileId)) ? node.attrs.fileId : "";
    const kb = Number(node.attrs.size) || 0;
    return [
      "a",
      { "data-type": "file", "data-file-id": id, "data-name": node.attrs.name, "data-size": String(kb), href: `/api/files/${id}`, class: "file-block" },
      ["span", { class: "file-icon" }, "📎"],
      ["span", { class: "file-name" }, node.attrs.name],
      ["span", { class: "file-size" }, kb ? (kb > 1048576 ? `${(kb / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(kb / 1024))} KB`) : ""],
    ];
  },
});

/** @mention of a colleague; links to their directory profile. */
export const Mention = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: null, parseHTML: (el) => el.getAttribute("data-id") }, label: { default: "", parseHTML: (el) => el.getAttribute("data-label") ?? "" } };
  },
  parseHTML() {
    return [{ tag: 'a[data-type="mention"]' }];
  },
  renderHTML({ node }) {
    const id = /^[a-z0-9]+$/i.test(String(node.attrs.id)) ? node.attrs.id : "";
    return ["a", { "data-type": "mention", "data-id": id, "data-label": node.attrs.label, href: `/directory/${id}`, class: "mention" }, `@${node.attrs.label}`];
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

const DATE_FMT = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const DateChip = Node.create({
  name: "dateChip",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { date: { default: null, parseHTML: (el) => el.getAttribute("data-date") } };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="date"]' }];
  },
  renderHTML({ node }) {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(node.attrs.date)) ? String(node.attrs.date) : null;
    return ["span", { "data-type": "date", "data-date": d ?? "", class: "date-chip" }, d ? `📅 ${DATE_FMT.format(new Date(`${d}T00:00:00Z`))}` : "📅"];
  },
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "column", class: "column" }), 0];
  },
});

export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-type="columns"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "columns", class: "columns" }), 0];
  },
});

export function contentExtensions(): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    Underline,
    Link.configure({ openOnClick: false, autolink: true, protocols: ["mailto", "tel"], HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" }, validate: (href) => isSafeHref(href) }),
    Image.configure({ inline: false, allowBase64: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    Callout,
    Embed,
    Bookmark,
    FileBlock,
    Mention,
    DateChip,
    Columns,
    Column,
  ];
}
