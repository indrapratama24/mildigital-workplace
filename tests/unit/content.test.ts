import { describe, expect, it } from "vitest";
import { docToText, isSafeHref, markdownToHtml, toEmbed } from "@/lib/content/format";
import { isEmptyContent, renderContentHtml, sanitizeContent } from "@/server/content";

const doc = (content: unknown[]) => JSON.stringify({ type: "doc", content });
const p = (text: string, marks?: unknown[]) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] });

describe("rich content", () => {
  it("converts provider URLs to embeds and rejects others", () => {
    expect(toEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(toEmbed("https://youtu.be/dQw4w9WgXcQ")?.provider).toBe("YouTube");
    expect(toEmbed("https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit")?.src).toMatch(/\/preview$/);
    expect(toEmbed("https://www.figma.com/design/abc123/Thing")?.provider).toBe("Figma");
    expect(toEmbed("https://example.com/page")).toBeNull();
    expect(toEmbed("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("https://mildigital.id")).toBe(true);
  });

  it("sanitises unknown nodes, unsafe links, images and colours", () => {
    const dirty = doc([
      p("hi", [{ type: "link", attrs: { href: "javascript:alert(1)" } }, { type: "bold" }, { type: "evil" }]),
      { type: "script", content: [{ type: "text", text: "x" }] },
      { type: "image", attrs: { src: "data:image/png;base64,AAAA" } },
      { type: "embed", attrs: { url: "https://evil.example/frame" } },
      { type: "paragraph", content: [{ type: "text", text: "red", marks: [{ type: "textStyle", attrs: { color: "red;background:url(x)" } }] }] },
      { type: "heading", attrs: { level: 9, onclick: "x" }, content: [{ type: "text", text: "H" }] },
    ]);
    const clean = JSON.parse(sanitizeContent(dirty));
    expect(clean.content.map((n: { type: string }) => n.type)).toEqual(["paragraph", "paragraph", "heading"]);
    expect(clean.content[0].content[0].marks).toEqual([{ type: "bold" }]);
    expect(clean.content[1].content[0].marks[0].attrs.color).toBeNull();
    expect(clean.content[2].attrs).toEqual({ level: 2, textAlign: null });
  });

  it("renders tables, callouts, columns, embeds and mentions to safe HTML", () => {
    const html = renderContentHtml(
      doc([
        { type: "callout", attrs: { tone: "warning" }, content: [p("Careful")] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [p("A")] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [p("<b>1</b>")] }] }] },
        { type: "columns", content: [{ type: "column", content: [p("L")] }, { type: "column", content: [p("R")] }] },
        { type: "embed", attrs: { url: "https://youtu.be/dQw4w9WgXcQ" } },
        { type: "paragraph", content: [{ type: "mention", attrs: { id: "abc123def", label: "Ayu" } }] },
      ]),
    );
    expect(html).toContain('class="callout callout-warning"');
    expect(html).toContain("<table");
    expect(html).toContain("&lt;b&gt;1&lt;/b&gt;");
    expect(html).toContain('class="columns"');
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"');
    expect(html).toContain('href="/directory/abc123def"');
    expect(html).not.toContain("<script");
  });

  it("detects empty content, extracts text and opens legacy Markdown", () => {
    expect(isEmptyContent(doc([{ type: "paragraph" }]))).toBe(true);
    expect(isEmptyContent(doc([{ type: "horizontalRule" }]))).toBe(false);
    expect(docToText(doc([p("Hello"), p("world")]))).toBe("Hello world");
    expect(markdownToHtml("# Title\n- **a**\n- [b](https://x.id)\n\n<script>")).toBe('<h1>Title</h1><ul><li><p><strong>a</strong></p></li><li><p><a href="https://x.id">b</a></p></li></ul><p>&lt;script&gt;</p>');
  });
});
