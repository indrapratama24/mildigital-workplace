"use client";
// Rich content editor (TipTap): text formats, headings, lists, checklists, tables, callouts, columns,
// images, files, embeds, link cards, dates and @mentions. Output is TipTap JSON (sanitised on the server).
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import * as DM from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AtSign,
  BookOpen,
  Bold,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  Code,
  Columns2,
  Columns3,
  FileCode2,
  FileDown,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Megaphone,
  Minus,
  Paperclip,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
  Globe,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { uploadContentFileAction } from "@/server/actions/workplace";
import { contentExtensions, CALLOUT_TONES, type CalloutTone } from "@/lib/content/extensions";
import { EMBED_PROVIDERS, isDocJson, isSafeHref, markdownToHtml, toEmbed } from "@/lib/content/format";
import { looksLikeMarkdown, markdownToDoc } from "@/lib/content/markdown";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";

type Person = { id: string; name: string };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const kbd = (s: string) => (isMac ? s : s.replace(/⌘/g, "Ctrl+").replace(/⌥/g, "Alt+").replace(/⇧/g, "Shift+"));

const TEXT_COLORS = ["#0a0f1f", "#475569", "#1f37a6", "#2563eb", "#0f766e", "#15803d", "#b45309", "#c2410c", "#b91c1c", "#7e22ce"];
const HIGHLIGHTS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa", "#e9d5ff", "#e2e8f0"];

export function RichEditor({
  value,
  onChange,
  people = [],
  placeholder = "Write here… Use + to add tables, embeds, files and more.",
  minHeight = 260,
}: {
  value: string;
  onChange: (json: string) => void;
  people?: Person[];
  placeholder?: string;
  minHeight?: number;
}) {
  const initial = useMemo(() => (isDocJson(value) ? JSON.parse(value) : value.trim() ? markdownToHtml(value) : ""), []); // eslint-disable-line react-hooks/exhaustive-deps
  const editorRef = useRef<Editor | null>(null);
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const editor = useEditor({
    extensions: [...contentExtensions(), Placeholder.configure({ placeholder })],
    content: initial,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "rich-content rich-editor focus:outline-none", style: `min-height:${minHeight}px` },
      // Text written in WORKPLACE Markdown (see /help/writing) is pasted fully formatted; ⌘Z keeps it as plain text.
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const hasHtml = !!event.clipboardData?.getData("text/html");
        if (!text.trim() || view.state.selection.$from.parent.type.name === "codeBlock" || !looksLikeMarkdown(text, hasHtml) || !editorRef.current) return false;
        editorRef.current.chain().focus().insertContent(markdownToDoc(text, peopleRef.current).content ?? []).run();
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(JSON.stringify(editor.getJSON())),
  });
  editorRef.current = editor;
  // Normalise legacy Markdown into JSON once so saving without edits keeps the same content.
  useEffect(() => {
    if (editor && !isDocJson(value) && value.trim()) onChange(JSON.stringify(editor.getJSON()));
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return <div className="rounded-xl border border-line bg-white" style={{ minHeight: minHeight + 48 }} />;
  return (
    <div className="rounded-xl border border-line bg-white focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-100">
      <Toolbar editor={editor} people={people} />
      <ContextBar editor={editor} />
      <div className="px-4 py-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// ───────────── Toolbar ─────────────

function Btn({ icon: Icon, label, onClick, active, disabled }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-canvas hover:text-ink disabled:opacity-30", active && "bg-brand-50 text-brand-700")}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-line" aria-hidden />;

const BLOCKS: { key: string; label: string; icon: LucideIcon; shortcut: string; run: (e: Editor) => void; active: (e: Editor) => boolean }[] = [
  { key: "p", label: "Paragraph", icon: Pilcrow, shortcut: "⌘⌥0", run: (e) => e.chain().focus().setParagraph().run(), active: (e) => e.isActive("paragraph") && !e.isActive("listItem") && !e.isActive("taskItem") },
  { key: "h1", label: "Big heading", icon: Heading1, shortcut: "⌘⌥1", run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
  { key: "h2", label: "Medium heading", icon: Heading2, shortcut: "⌘⌥2", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
  { key: "h3", label: "Small heading", icon: Heading3, shortcut: "⌘⌥3", run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  { key: "task", label: "Check list", icon: CheckSquare, shortcut: "⌘⇧9", run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive("taskList") },
  { key: "ol", label: "Ordered list", icon: ListOrdered, shortcut: "⌘⇧7", run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { key: "ul", label: "Bulleted list", icon: List, shortcut: "⌘⇧8", run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { key: "code", label: "Code block", icon: FileCode2, shortcut: "⌘⌥C", run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
];

const menuCls = "z-[60] min-w-[220px] rounded-xl border border-line bg-white p-1.5 shadow-pop";
const itemCls = "flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] text-ink outline-none data-[highlighted]:bg-brand-50 data-[highlighted]:text-brand-700";

function Toolbar({ editor, people }: { editor: Editor; people: Person[] }) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    editor.on("transaction", f);
    return () => {
      editor.off("transaction", f);
    };
  }, [editor]);
  const [dialog, setDialog] = useState<null | "link" | "embed" | "date" | "mention" | "imageUrl" | "markdown">(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const current = BLOCKS.find((b) => b.key !== "p" && b.active(editor)) ?? BLOCKS[0];

  const upload = (file: File, kind: "image" | "file") => {
    const fd = new FormData();
    fd.set("file", file);
    startUpload(async () => {
      const r = await uploadContentFileAction(fd);
      if (!r.ok) return void toast.error(r.error);
      const f = r.data as { id: string; name: string; size: number; mimeType: string };
      if (kind === "image" && f.mimeType.startsWith("image/")) editor.chain().focus().setImage({ src: `/api/files/${f.id}?inline=1`, alt: f.name }).run();
      else editor.chain().focus().insertContent({ type: "fileBlock", attrs: { fileId: f.id, name: f.name, size: f.size } }).run();
    });
  };

  const insertItems: { label: string; icon: LucideIcon; run: () => void; hint?: string }[][] = [
    [
      { label: "Table", icon: TableIcon, run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { label: "Two columns", icon: Columns2, run: () => insertColumns(editor, 2) },
      { label: "Three columns", icon: Columns3, run: () => insertColumns(editor, 3) },
      { label: "Callout", icon: Megaphone, run: () => editor.chain().focus().insertContent({ type: "callout", attrs: { tone: "info" }, content: [{ type: "paragraph" }] }).run() },
      { label: "Blockquote", icon: Quote, run: () => editor.chain().focus().toggleBlockquote().run() },
      { label: "Divider", icon: Minus, run: () => editor.chain().focus().setHorizontalRule().run() },
    ],
    [
      { label: "Image (upload)", icon: ImageIcon, run: () => imageRef.current?.click() },
      { label: "Image from URL", icon: ImageIcon, run: () => setDialog("imageUrl") },
      { label: "File (PDF / image)", icon: Paperclip, run: () => fileRef.current?.click() },
      { label: "Embed or link card", icon: Globe, run: () => setDialog("embed"), hint: "YouTube, Docs, Slides, Figma…" },
    ],
    [
      { label: "Date", icon: CalendarDays, run: () => setDialog("date") },
      { label: "Mention a colleague", icon: AtSign, run: () => setDialog("mention") },
    ],
    [
      { label: "Paste formatted text", icon: FileDown, run: () => setDialog("markdown"), hint: "WORKPLACE Markdown" },
      { label: "Writing guide", icon: BookOpen, run: () => window.open("/help/writing", "_blank", "noopener") },
    ],
  ];

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-line bg-white/95 px-2 py-1.5 backdrop-blur">
      <DM.Root modal={false}>
        <DM.Trigger asChild>
          <button type="button" onMouseDown={(e) => e.preventDefault()} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-ink-2 hover:bg-canvas" title="Text style">
            <current.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{current.label}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </DM.Trigger>
        <DM.Portal>
          <DM.Content className={menuCls} sideOffset={6} align="start">
            {BLOCKS.map((b, i) => (
              <div key={b.key}>
                {(i === 4 || i === 7) && <DM.Separator className="my-1 h-px bg-line-2" />}
                <DM.Item className={itemCls} onSelect={() => b.run(editor)}>
                  <span className="w-3.5">{b === current && <Check className="h-3.5 w-3.5 text-brand-700" />}</span>
                  <b.icon className="h-4 w-4" />
                  <span className="flex-1">{b.label}</span>
                  <span className="text-[11.5px] text-subtle">{kbd(b.shortcut)}</span>
                </DM.Item>
              </div>
            ))}
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      <Sep />
      <Btn icon={Bold} label={`Bold (${kbd("⌘B")})`} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
      <Btn icon={Italic} label={`Italic (${kbd("⌘I")})`} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Btn icon={UnderlineIcon} label={`Underline (${kbd("⌘U")})`} active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <Btn icon={Strikethrough} label={`Strikethrough (${kbd("⌘⇧S")})`} active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <ColorMenu editor={editor} />
      <Sep />
      <Btn icon={Quote} label={`Blockquote (${kbd("⌘⇧B")})`} active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <Btn icon={Code} label={`Inline code (${kbd("⌘E")})`} active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} />
      <Btn icon={Link2} label="Link" active={editor.isActive("link")} onClick={() => setDialog("link")} />
      {editor.isActive("link") && <Btn icon={Unlink} label="Remove link" onClick={() => editor.chain().focus().extendMarkRange("link").unsetLink().run()} />}
      <Sep />
      <Btn icon={AlignLeft} label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} />
      <Btn icon={AlignCenter} label="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} />
      <Btn icon={AlignRight} label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} />
      <Sep />
      <DM.Root modal={false}>
        <DM.Trigger asChild>
          <button type="button" onMouseDown={(e) => e.preventDefault()} className="flex h-8 items-center gap-1 rounded-lg bg-brand-700 px-2.5 text-[13px] font-medium text-white hover:bg-brand-800" title="Insert">
            <Plus className="h-4 w-4" /> Insert
          </button>
        </DM.Trigger>
        <DM.Portal>
          <DM.Content className={cn(menuCls, "min-w-[250px]")} sideOffset={6} align="start">
            {insertItems.map((group, gi) => (
              <div key={gi}>
                {gi > 0 && <DM.Separator className="my-1 h-px bg-line-2" />}
                {group.map((it) => (
                  <DM.Item key={it.label} className={itemCls} onSelect={() => setTimeout(it.run, 0)}>
                    <it.icon className="h-4 w-4 text-ink-2" />
                    <span className="flex-1">{it.label}</span>
                    {it.hint && <span className="text-[11px] text-subtle">{it.hint}</span>}
                  </DM.Item>
                ))}
              </div>
            ))}
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      {uploading && <span className="ml-1 text-[12px] text-muted">Uploading…</span>}
      <span className="ml-auto flex">
        <Btn icon={Undo2} label={`Undo (${kbd("⌘Z")})`} disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} />
        <Btn icon={Redo2} label={`Redo (${kbd("⌘⇧Z")})`} disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} />
      </span>
      <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, "image"); e.target.value = ""; }} />
      <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, "file"); e.target.value = ""; }} />
      <LinkDialog open={dialog === "link"} onClose={() => setDialog(null)} editor={editor} />
      <EmbedDialog open={dialog === "embed"} onClose={() => setDialog(null)} editor={editor} />
      <ImageUrlDialog open={dialog === "imageUrl"} onClose={() => setDialog(null)} editor={editor} />
      <DateDialog open={dialog === "date"} onClose={() => setDialog(null)} editor={editor} />
      <MentionDialog open={dialog === "mention"} onClose={() => setDialog(null)} editor={editor} people={people} />
      <MarkdownDialog open={dialog === "markdown"} onClose={() => setDialog(null)} editor={editor} people={people} />
    </div>
  );
}

function insertColumns(editor: Editor, n: 2 | 3) {
  editor
    .chain()
    .focus()
    .insertContent({ type: "columns", content: Array.from({ length: n }, () => ({ type: "column", content: [{ type: "paragraph" }] })) })
    .run();
}

function ColorMenu({ editor }: { editor: Editor }) {
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button type="button" onMouseDown={(e) => e.preventDefault()} title="Text color & highlight" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-canvas">
          <Palette className="h-4 w-4" />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content className={cn(menuCls, "w-[232px] p-3")} sideOffset={6}>
          <div className="mb-1.5 text-[11.5px] font-medium text-muted">Text color</div>
          <div className="flex flex-wrap gap-1.5">
            {TEXT_COLORS.map((c) => (
              <DM.Item key={c} onSelect={() => editor.chain().focus().setColor(c).run()} className="h-6 w-6 cursor-pointer rounded-full border border-line outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-brand-300" style={{ background: c }} aria-label={`Text color ${c}`} />
            ))}
            <DM.Item onSelect={() => editor.chain().focus().unsetColor().run()} className="flex h-6 cursor-pointer items-center rounded-full border border-line px-2 text-[11px] outline-none data-[highlighted]:bg-canvas">Reset</DM.Item>
          </div>
          <div className="mb-1.5 mt-3 flex items-center gap-1 text-[11.5px] font-medium text-muted"><Highlighter className="h-3.5 w-3.5" /> Highlight</div>
          <div className="flex flex-wrap gap-1.5">
            {HIGHLIGHTS.map((c) => (
              <DM.Item key={c} onSelect={() => editor.chain().focus().setHighlight({ color: c }).run()} className="h-6 w-6 cursor-pointer rounded-md border border-line outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-brand-300" style={{ background: c }} aria-label={`Highlight ${c}`} />
            ))}
            <DM.Item onSelect={() => editor.chain().focus().unsetHighlight().run()} className="flex h-6 cursor-pointer items-center rounded-md border border-line px-2 text-[11px] outline-none data-[highlighted]:bg-canvas">None</DM.Item>
          </div>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** Extra controls when the cursor is inside a table or a callout. */
function ContextBar({ editor }: { editor: Editor }) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    editor.on("selectionUpdate", f);
    editor.on("transaction", f);
    return () => {
      editor.off("selectionUpdate", f);
      editor.off("transaction", f);
    };
  }, [editor]);
  const chip = "rounded-md px-2 py-1 text-[12px] font-medium text-ink-2 hover:bg-white hover:text-brand-700";
  if (editor.isActive("table"))
    return (
      <div className="flex flex-wrap items-center gap-1 border-b border-line-2 bg-canvas px-3 py-1.5">
        <span className="mr-1 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">Table</span>
        <button type="button" className={chip} onClick={() => editor.chain().focus().addRowBefore().run()}>+ Row above</button>
        <button type="button" className={chip} onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row below</button>
        <button type="button" className={chip} onClick={() => editor.chain().focus().addColumnBefore().run()}>+ Column left</button>
        <button type="button" className={chip} onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column right</button>
        <button type="button" className={chip} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Header row</button>
        <button type="button" className={chip} onClick={() => editor.chain().focus().mergeOrSplit().run()}>Merge / split</button>
        <button type="button" className={chip} onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</button>
        <button type="button" className={chip} onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</button>
        <button type="button" className={cn(chip, "text-danger")} onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 className="inline h-3.5 w-3.5" /> Table</button>
      </div>
    );
  if (editor.isActive("callout"))
    return (
      <div className="flex flex-wrap items-center gap-1 border-b border-line-2 bg-canvas px-3 py-1.5">
        <span className="mr-1 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">Callout</span>
        {(Object.keys(CALLOUT_TONES) as CalloutTone[]).map((t) => (
          <button key={t} type="button" className={cn(chip, editor.isActive("callout", { tone: t }) && "bg-white text-brand-700")} onClick={() => editor.chain().focus().updateAttributes("callout", { tone: t }).run()}>
            {CALLOUT_TONES[t].emoji} {CALLOUT_TONES[t].label}
          </button>
        ))}
        <button type="button" className={cn(chip, "text-danger")} onClick={() => editor.chain().focus().lift("callout").run()}>Remove callout</button>
      </div>
    );
  if (editor.isActive("columns"))
    return (
      <div className="flex flex-wrap items-center gap-1 border-b border-line-2 bg-canvas px-3 py-1.5">
        <span className="mr-1 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">Columns</span>
        <button type="button" className={cn(chip, "text-danger")} onClick={() => deleteAncestor(editor, "columns")}><Trash2 className="inline h-3.5 w-3.5" /> Remove columns</button>
      </div>
    );
  return null;
}

function deleteAncestor(editor: Editor, type: string) {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === type) {
      editor.chain().focus().deleteRange({ from: $from.before(d), to: $from.after(d) }).run();
      return;
    }
  }
}

// ───────────── Dialogs ─────────────

/** Radix focuses the dialog's first button; move focus to the main field once it has opened. */
function useAutoFocus(open: boolean) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => ref.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);
  return ref;
}

function UrlDialog({ open, onClose, title, description, label, initial = "", submit, children }: { open: boolean; onClose: () => void; title: string; description?: string; label: string; initial?: string; submit: (url: string) => string | null; children?: (url: string) => React.ReactNode }) {
  const [url, setUrl] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useAutoFocus(open);
  useEffect(() => {
    if (open) {
      setUrl(initial);
      setErr(null);
    }
  }, [open, initial]);
  const go = () => {
    const e = submit(url.trim());
    if (e) setErr(e);
    else onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={go}>Insert</Button>
        </>
      }
    >
      <Field label={label} error={err ?? undefined}>
        <Input ref={inputRef} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), go())} placeholder="https://" />
      </Field>
      {children?.(url.trim())}
    </Dialog>
  );
}

function LinkDialog({ open, onClose, editor }: { open: boolean; onClose: () => void; editor: Editor }) {
  const initial = open ? (editor.getAttributes("link").href as string | undefined) ?? "" : "";
  return (
    <UrlDialog
      open={open}
      onClose={onClose}
      title="Link"
      description="Select text first to turn it into a link, or insert the URL as text."
      label="URL"
      initial={initial}
      submit={(url) => {
        if (!url) {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          return null;
        }
        const href = /^[a-z]+:/i.test(url) || url.startsWith("/") ? url : `https://${url}`;
        if (!isSafeHref(href)) return "Use an http(s), mailto: or tel: link.";
        if (editor.state.selection.empty && !editor.isActive("link")) editor.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href } }] }).run();
        else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
        return null;
      }}
    />
  );
}

function EmbedDialog({ open, onClose, editor }: { open: boolean; onClose: () => void; editor: Editor }) {
  return (
    <UrlDialog
      open={open}
      onClose={onClose}
      title="Embed or link card"
      description={`Embeds: ${EMBED_PROVIDERS.join(", ")}. Other links become a link card.`}
      label="Paste a URL"
      submit={(url) => {
        const href = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
        if (!isSafeHref(href) || !/^https?:/i.test(href)) return "Paste a full http(s) link.";
        if (toEmbed(href)) editor.chain().focus().insertContent({ type: "embed", attrs: { url: href } }).run();
        else editor.chain().focus().insertContent({ type: "bookmark", attrs: { url: href, title: "" } }).run();
        return null;
      }}
    >
      {(url) =>
        url ? (
          <p className="mt-2 text-[12.5px] text-muted">
            {toEmbed(/^[a-z]+:/i.test(url) ? url : `https://${url}`) ? `✓ Will be embedded (${toEmbed(/^[a-z]+:/i.test(url) ? url : `https://${url}`)!.provider}). Shared documents must be viewable by the reader.` : "Will be shown as a link card."}
          </p>
        ) : null
      }
    </UrlDialog>
  );
}

function ImageUrlDialog({ open, onClose, editor }: { open: boolean; onClose: () => void; editor: Editor }) {
  return (
    <UrlDialog
      open={open}
      onClose={onClose}
      title="Image from URL"
      label="Image URL (https)"
      submit={(url) => {
        if (!/^https:\/\//i.test(url)) return "Use an https:// image URL.";
        editor.chain().focus().setImage({ src: url }).run();
        return null;
      }}
    />
  );
}

function DateDialog({ open, onClose, editor }: { open: boolean; onClose: () => void; editor: Editor }) {
  const [d, setD] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Insert date"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!d} onClick={() => { editor.chain().focus().insertContent([{ type: "dateChip", attrs: { date: d } }, { type: "text", text: " " }]).run(); onClose(); }}>Insert</Button>
        </>
      }
    >
      <Field label="Date"><Input type="date" value={d} onChange={(e) => setD(e.target.value)} /></Field>
    </Dialog>
  );
}

function MentionDialog({ open, onClose, editor, people }: { open: boolean; onClose: () => void; editor: Editor; people: Person[] }) {
  const [q, setQ] = useState("");
  const inputRef = useAutoFocus(open);
  const list = people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  const pick = (p: Person) => {
    editor.chain().focus().insertContent([{ type: "mention", attrs: { id: p.id, label: p.name } }, { type: "text", text: " " }]).run();
    setQ("");
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Mention a colleague" description="Links to their Team Directory profile.">
      <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name" onKeyDown={(e) => e.key === "Enter" && list[0] && (e.preventDefault(), pick(list[0]))} />
      <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto">
        {list.map((p) => (
          <button key={p.id} type="button" onClick={() => pick(p)} className="block w-full rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-brand-50">{p.name}</button>
        ))}
        {!list.length && <p className="px-3 py-2 text-[13px] text-muted">{people.length ? "No match." : "No people available."}</p>}
      </div>
    </Dialog>
  );
}

function MarkdownDialog({ open, onClose, editor, people }: { open: boolean; onClose: () => void; editor: Editor; people: Person[] }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText("");
  }, [open]);
  const insert = () => {
    editor.chain().focus().insertContent(markdownToDoc(text, people).content ?? []).run();
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Paste formatted text"
      description="Paste a page written in WORKPLACE Markdown — headings, callouts, tables, columns, videos and more come in formatted."
      className="sm:max-w-2xl"
      footer={
        <>
          <a href="/help/writing" target="_blank" rel="noopener" className="mr-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline">
            <BookOpen className="h-4 w-4" /> Writing guide
          </a>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!text.trim()} onClick={insert}>Insert</Button>
        </>
      }
    >
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} className="font-mono text-[12.5px]" placeholder={"## Section title\n\n> [!INFO] Good to know\n> Text inside the callout.\n\n- Point one\n- Point two"} autoFocus />
    </Dialog>
  );
}
