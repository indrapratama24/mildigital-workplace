// Writing guide for WORKPLACE Markdown: every rule with its source and a live preview, a full page
// template and a copy-ready brief for AI assistants. Text in this format pastes fully formatted into
// any WORKPLACE editor (Company 101, regulations, announcements).
import { BookOpen, ClipboardPaste, Sparkles } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { markdownToDoc } from "@/lib/content/markdown";
import { addDays, todayJakarta } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { ContentBody } from "@/components/app/content-body";
import { SectionJump } from "@/components/app/section-jump";
import { CopyButton } from "./copy-button";

export const metadata = { title: "Writing guide" };

type Rule = { id: string; title: string; when: string; md: string; note?: string };

function rules(me: string, date: string): { group: string; items: Rule[] }[] {
  return [
    {
      group: "Structure",
      items: [
        { id: "headings", title: "Headings", when: "Split a page into sections people can scan. Use ## for sections and ### inside them; # is for a rare big title.", md: "## How we plan our week\n\n### Mandatory office days\nEveryone is in the office on Monday and Wednesday." },
        { id: "paragraphs", title: "Paragraphs & line breaks", when: "Leave an empty line between paragraphs. A single line break stays a line break.", md: "Our office is open from 08:00 to 18:00.\nParking is available on level B1.\n\nGuests sign in at the front desk." },
        { id: "divider", title: "Divider", when: "Separate two very different parts of a page.", md: "Part one ends here.\n\n---\n\nPart two starts here." },
      ],
    },
    {
      group: "Text",
      items: [
        {
          id: "inline",
          title: "Bold, italic and more",
          when: "Emphasise a few key words — not whole paragraphs.",
          md: "**Bold** for key words, *italic* for terms, ++underline++, ~~no longer valid~~, ==highlighted== and `CODE-123` for codes.",
        },
        { id: "links", title: "Links", when: "Link text inside a sentence. A link must start with https:// (or mailto:).", md: "Read the [employee handbook](https://mildigital.id) or email [hr@mildigital.id](mailto:hr@mildigital.id)." },
        { id: "mention", title: "Mention a colleague", when: "Links to their Team Directory profile. Use their full name exactly as in the directory.", md: `Questions? Ask @[${me}].`, note: "If the name isn't found, it stays as plain text — add the mention in the editor instead." },
        { id: "date", title: "Date", when: "Shows a date chip that reads well in every language. Write the date as YYYY-MM-DD.", md: `The new policy starts on @date(${date}).` },
      ],
    },
    {
      group: "Lists",
      items: [
        { id: "bullets", title: "Bulleted list", when: "Points without an order. Indent two spaces for a sub-point.", md: "- Laptop and charger\n- Access card\n  - Collect it from People Ops\n- Your first-week schedule" },
        { id: "numbered", title: "Numbered list", when: "Steps that happen in order.", md: "1. Open My Work Calendar\n2. Plan your WFO days\n3. Submit before the 25th" },
        { id: "checklist", title: "Checklist", when: "Things to do or confirm, e.g. onboarding. [x] shows as done.", md: "- [x] Sign your contract\n- [ ] Set up your work email\n- [ ] Meet your buddy" },
      ],
    },
    {
      group: "Highlight boxes",
      items: [
        {
          id: "callout",
          title: "Callouts",
          when: "Make one important message stand out. Start with > [!TYPE] and an optional bold title; every following line starts with >. Types: INFO, NOTE, SUCCESS, WARNING, IMPORTANT.",
          md: "> [!INFO] Good to know\n> Lunch is provided every Friday.\n\n> [!WARNING] Deadline\n> Submit your monthly plan before the 25th.\n\n> [!IMPORTANT]\n> Never share client logins outside the team.",
        },
        { id: "quote", title: "Quote", when: "A quote from a person or a document.", md: "> Growing the brands we serve starts with growing ourselves." },
      ],
    },
    {
      group: "Layout",
      items: [
        { id: "table", title: "Table", when: "Compare things side by side. The second line (---) marks the header row. Keep it to about 5 columns so it reads well on phones.", md: "| Leave type | Days per year | Notice |\n| --- | --- | --- |\n| Annual leave | 12 | 14 days |\n| Sick leave | As needed | — |" },
        {
          id: "columns",
          title: "Columns",
          when: "Put 2 or 3 short blocks next to each other (they stack on phones). Start with :::columns, separate with :::next, end with :::.",
          md: ":::columns\n### Our mission\nHelp brands grow with insight.\n:::next\n### Our vision\nThe partner brands trust most.\n:::",
        },
      ],
    },
    {
      group: "Media",
      items: [
        { id: "image", title: "Image", when: "An image on its own line. The address must start with https://. To use a photo from your computer, upload it in the editor (Insert → Image).", md: "![The team at the 2026 offsite](https://workplace.mildigital.id/og/team.jpg)" },
        {
          id: "embed",
          title: "Video, document or link card",
          when: "Put a link on its own line. YouTube, Vimeo, Loom, Google Docs/Slides/Sheets/Forms/Drive, Google Maps, Figma and Canva links play or open inside the page; any other link becomes a card.",
          md: "https://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nhttps://mildigital.id",
        },
        { id: "code", title: "Code or fixed text", when: "Text that must be copied exactly, like a template or settings.", md: "```\nSubject: [Leave] Your name — dates\n```" },
      ],
    },
  ];
}

function template(me: string, date: string) {
  return `## Welcome to MIL Digital

We're glad you're here. This page covers what you need in your **first week**.

> [!INFO] Your buddy
> @[${me}] will help you settle in and answer your questions.

### Your first week

:::columns
**Day 1**
- Meet the team
- Collect your laptop and access card
:::next
**Day 2–5**
- Learn our tools
- Shadow a client meeting
:::

### Checklist

- [ ] Sign your contract
- [ ] Set up your work email
- [ ] Plan your first month in My Work Calendar

### Key policies

| Topic | What to know |
| --- | --- |
| Working hours | 09:00–18:00 |
| Monthly plan | Submit before the 25th |

> [!WARNING] Deadline
> Your first monthly plan is due on @date(${date}).

https://www.youtube.com/watch?v=dQw4w9WgXcQ
`;
}

const AI_BRIEF = `Write the content in "WORKPLACE Markdown" so it can be pasted straight into our company platform. Rules:
- Headings: "## Section" and "### Sub-section" (avoid "#").
- Paragraphs: leave an empty line between paragraphs; a single line break is kept as a line break.
- Text: **bold**, *italic*, ++underline++, ~~strike~~, ==highlight==, \`code\`. Links: [text](https://...). Only https:// or mailto: links.
- Lists: "- item" (indent 2 spaces for sub-items), "1. step", checklist "- [ ] task" / "- [x] done".
- Callouts: a line "> [!INFO] Optional title" (types: INFO, NOTE, SUCCESS, WARNING, IMPORTANT), then each body line starts with "> ". Use at most one or two per section.
- Quote: lines starting with "> " (without [!TYPE]).
- Table: pipe table with a header row and a "| --- | --- |" line; max ~5 columns.
- Columns: ":::columns", then the first column, ":::next", the second (optional third after another ":::next"), and ":::" to close. Keep each column short.
- Divider: a line with "---".
- Image: "![description](https://...)" on its own line.
- Video/document/link card: put the https link alone on its own line (YouTube, Vimeo, Loom, Google Docs/Slides/Sheets/Forms/Drive, Figma, Canva embed; other sites become a link card).
- Dates: @date(YYYY-MM-DD). Colleagues: @[Full Name] exactly as in the Team Directory.
- No HTML, no emoji headings, no "####" or deeper headings, no nested tables.
Style: start with a 1–2 sentence summary, keep paragraphs short (2–4 lines), use a heading every few paragraphs, and prefer lists and tables over long text.
Output only the Markdown, inside one code block.`;

const TIPS = [
  "Open with a one- or two-sentence summary, then a heading every few paragraphs.",
  "One callout per section is plenty — if everything stands out, nothing does.",
  "Prefer lists and small tables over long paragraphs; keep paragraphs to 2–4 lines.",
  "Use columns for 2–3 short, parallel blocks (mission / vision, day 1 / day 2). They stack on phones.",
  "Images look best in landscape (16:9) and with a short description.",
  "Files (PDF) can't come in through text — attach them in the editor with Insert → File.",
];

export default async function WritingGuidePage() {
  const me = await requirePageUser();
  const date = addDays(todayJakarta(), 14);
  const people = [{ id: me.employeeId, name: me.fullName }];
  const preview = (md: string) => <ContentBody body={JSON.stringify(markdownToDoc(md, people))} />;
  const groups = rules(me.fullName, date);
  const tpl = template(me.fullName, date);
  return (
    <>
      <PageHeader
        eyebrow="Company Hub"
        title="Writing guide"
        description="Write a page anywhere — Notes, a doc or an AI assistant — in WORKPLACE Markdown, then paste it into any WORKPLACE editor. It comes in fully formatted."
      />
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-0.5 text-[13.5px]" aria-label="Guide">
            <a href="#how" className="block rounded-xl px-3 py-1.5 text-ink-2 hover:bg-white hover:text-brand-700">How it works</a>
            {groups.map((g) => (
              <div key={g.group}>
                <div className="mb-1 mt-3 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{g.group}</div>
                {g.items.map((r) => <a key={r.id} href={`#${r.id}`} className="block rounded-xl px-3 py-1.5 text-ink-2 hover:bg-white hover:text-brand-700">{r.title}</a>)}
              </div>
            ))}
            <div className="mb-1 mt-3 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Ready to use</div>
            <a href="#template" className="block rounded-xl px-3 py-1.5 text-ink-2 hover:bg-white hover:text-brand-700">Full page template</a>
            <a href="#ai" className="block rounded-xl px-3 py-1.5 text-ink-2 hover:bg-white hover:text-brand-700">Brief for AI assistants</a>
            <a href="#tips" className="block rounded-xl px-3 py-1.5 text-ink-2 hover:bg-white hover:text-brand-700">Tips for a good page</a>
          </nav>
        </aside>
        <div className="min-w-0 space-y-5">
          <SectionJump
            label="Guide"
            groups={[
              { items: [{ id: "how", title: "How it works" }] },
              ...groups.map((g) => ({ label: g.group, items: g.items.map((r) => ({ id: r.id, title: r.title })) })),
              { label: "Ready to use", items: [{ id: "template", title: "Full page template" }, { id: "ai", title: "Brief for AI assistants" }, { id: "tips", title: "Tips for a good page" }] },
            ]}
          />
          <Card id="how" className="scroll-mt-32 lg:scroll-mt-24">
            <CardHeader title="How it works" />
            <CardBody>
              <ol className="grid gap-3 sm:grid-cols-3">
                {[
                  { icon: BookOpen, t: "Write", d: "Follow the rules below — or copy the brief for AI assistants and let ChatGPT, Claude or Gemini draft it." },
                  { icon: ClipboardPaste, t: "Paste", d: "Paste into the editor of a Company 101 section, regulation or announcement. Or use Insert → Paste formatted text." },
                  { icon: Sparkles, t: "Finish", d: "Check the result, add files or uploaded photos, then save. Pasted the wrong way? Press ⌘Z / Ctrl+Z once to keep it as plain text." },
                ].map((s, i) => (
                  <li key={s.t} className="rounded-xl border border-line bg-canvas/60 p-3.5">
                    <div className="flex items-center gap-2 font-medium text-ink"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-700 text-[12px] text-white">{i + 1}</span><s.icon className="h-4 w-4 text-brand-600" /> {s.t}</div>
                    <p className="mt-1.5 text-[13px] text-muted">{s.d}</p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          {groups.map((g) => (
            <section key={g.group} className="space-y-3">
              <h2 className="px-1 font-display text-[13px] font-bold uppercase tracking-[0.08em] text-subtle">{g.group}</h2>
              {g.items.map((r) => (
                <Card key={r.id} id={r.id} className="scroll-mt-32 lg:scroll-mt-24">
                  <CardHeader title={r.title} description={r.when} action={<CopyButton text={r.md} />} />
                  <CardBody className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">You write</div>
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-ink">{r.md}</pre>
                    </div>
                    <div className="min-w-0">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">It looks like</div>
                      <div className="rounded-xl border border-line px-3.5 py-3">{preview(r.md)}</div>
                      {r.note && <p className="mt-1.5 text-[12px] text-muted">{r.note}</p>}
                    </div>
                  </CardBody>
                </Card>
              ))}
            </section>
          ))}

          <Card id="template" className="scroll-mt-32 lg:scroll-mt-24">
            <CardHeader title="Full page template" description="A complete example using most blocks. Copy it, change the words and paste it into the editor." action={<CopyButton text={tpl} label="Copy template" />} />
            <CardBody className="grid gap-3 lg:grid-cols-2">
              <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-ink">{tpl}</pre>
              <div className="min-w-0 rounded-xl border border-line px-4 py-3">{preview(tpl)}</div>
            </CardBody>
          </Card>

          <Card id="ai" className="scroll-mt-32 lg:scroll-mt-24">
            <CardHeader title="Brief for AI assistants" description="Paste this before your request (e.g. “Write our remote-work policy for new joiners”). The answer can be pasted straight into WORKPLACE." action={<CopyButton text={AI_BRIEF} label="Copy brief" />} />
            <CardBody>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-ink">{AI_BRIEF}</pre>
            </CardBody>
          </Card>

          <Card id="tips" className="scroll-mt-32 lg:scroll-mt-24">
            <CardHeader title="Tips for a good page" />
            <CardBody>
              <ul className="space-y-2 text-[13.5px] text-ink-2">
                {TIPS.map((t) => <li key={t} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />{t}</li>)}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
