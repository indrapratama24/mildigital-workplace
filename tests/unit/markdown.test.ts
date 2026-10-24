import { describe, expect, it } from "vitest";
import { looksLikeMarkdown, markdownToDoc } from "@/lib/content/markdown";
import { renderContentHtml, sanitizeContent } from "@/server/content";
import type { JSONNode } from "@/lib/content/format";

const people = [{ id: "ckemployee0001", name: "Indra Pratama" }];
const types = (d: JSONNode) => (d.content ?? []).map((n) => n.type);
/** What the stored page would render to (after the server's sanitiser). */
const html = (md: string) => renderContentHtml(sanitizeContent(JSON.stringify(markdownToDoc(md, people))));

describe("WORKPLACE Markdown", () => {
  it("builds every block type", () => {
    const md = [
      "# Welcome",
      "Intro line one",
      "line two",
      "",
      "## Rules",
      "> [!WARNING] Before you start",
      "> Read the handbook first.",
      "",
      "> A plain quote",
      "",
      "- One",
      "  - Nested",
      "- Two",
      "",
      "1. First",
      "2. Second",
      "",
      "- [x] Done",
      "- [ ] To do",
      "",
      "| Type | Days |",
      "| --- | ---: |",
      "| Annual | 12 |",
      "",
      ":::columns",
      "### Left",
      "Text",
      ":::next",
      "### Right",
      "More",
      ":::",
      "",
      "---",
      "```",
      "code here",
      "```",
      "![Team](https://mildigital.id/team.jpg)",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://mildigital.id/about",
    ].join("\n");
    const d = markdownToDoc(md, people);
    expect(types(d)).toEqual(["heading", "paragraph", "heading", "callout", "blockquote", "bulletList", "orderedList", "taskList", "table", "columns", "horizontalRule", "codeBlock", "image", "embed", "bookmark"]);
    const [, intro, , callout, , bullets, , tasks, table, columns] = d.content!;
    expect(intro.content!.map((n) => n.type)).toEqual(["text", "hardBreak", "text"]);
    expect(callout.attrs).toEqual({ tone: "warning" });
    expect(callout.content![0].content![0].marks).toEqual([{ type: "bold" }]);
    expect(bullets.content![0].content!.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
    expect(tasks.content!.map((n) => n.attrs?.checked)).toEqual([true, false]);
    expect(table.content!.map((r) => r.content![0].type)).toEqual(["tableHeader", "tableCell"]);
    expect(columns.content).toHaveLength(2);
    // survives the server sanitiser and renders
    const out = html(md);
    for (const bit of ["callout-warning", "<table", 'data-type="columns"', "youtube-nocookie.com/embed/dQw4w9WgXcQ", 'data-type="bookmark"', "<img"]) expect(out).toContain(bit);
  });

  it("handles inline formatting, links, dates and mentions", () => {
    const d = markdownToDoc("**Bold** *it* ~~old~~ ==key== ++under++ `code` [site](https://mildigital.id) @date(2026-12-01) @[Indra Pratama] @[Nobody Here] https://x.com/a_b_c.", people);
    const nodes = d.content![0].content!;
    const marked = (t: string) => nodes.find((n) => n.text === t)?.marks?.map((m) => m.type);
    expect(marked("Bold")).toEqual(["bold"]);
    expect(marked("it")).toEqual(["italic"]);
    expect(marked("old")).toEqual(["strike"]);
    expect(marked("key")).toEqual(["highlight"]);
    expect(marked("under")).toEqual(["underline"]);
    expect(marked("code")).toEqual(["code"]);
    expect(marked("site")).toEqual(["link"]);
    expect(marked("https://x.com/a_b_c")).toEqual(["link"]);
    expect(nodes.find((n) => n.type === "dateChip")?.attrs).toEqual({ date: "2026-12-01" });
    expect(nodes.find((n) => n.type === "mention")?.attrs).toEqual({ id: "ckemployee0001", label: "Indra Pratama" });
    expect(nodes.some((n) => n.text?.includes("@Nobody Here"))).toBe(true);
  });

  it("drops unsafe links and images", () => {
    const out = html("[x](javascript:alert(1))\n\n![a](http://insecure.example/a.png)");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img");
  });

  it("only takes over a paste when the text is clearly Markdown", () => {
    expect(looksLikeMarkdown("> [!INFO] Hi", true)).toBe(true);
    expect(looksLikeMarkdown("## Title\ntext", true)).toBe(true);
    expect(looksLikeMarkdown("- a\n- b", true)).toBe(false); // a formatted list copied from a page keeps its own formatting
    expect(looksLikeMarkdown("- a\n- b", false)).toBe(true);
    expect(looksLikeMarkdown("Just a sentence.", false)).toBe(false);
  });
});
