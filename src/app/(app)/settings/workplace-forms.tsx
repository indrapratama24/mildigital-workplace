"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import * as W from "@/server/actions/workplace";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/misc";
import { RichEditor } from "@/components/app/editor/rich-editor";

type Result = { ok: boolean; error?: string; message?: string; data?: unknown };
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: (r: Result) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      if (r.message) toast.success(r.message);
      after?.(r);
      router.refresh();
    });
  return { pending, run };
}

type Person = { id: string; name: string };

// ───────────── Client packages & rules ─────────────

type Pkg = { id?: string; name: string; description: string | null; isActive: boolean; sortOrder: number };

export function PackageRow({ pkg, clients }: { pkg?: Pkg & { id: string }; clients?: number }) {
  const [f, setF] = useState<Pkg>(pkg ?? { name: "", description: "", isActive: true, sortOrder: 10 });
  const { pending, run } = useRun();
  const dirty = !pkg || JSON.stringify(f) !== JSON.stringify(pkg);
  return (
    <div className="grid gap-2 border-b border-line-2 py-3 sm:grid-cols-[1fr_1.4fr_80px_auto_auto] sm:items-end">
      <Field label="Package name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Premium" /></Field>
      <Field label="Description"><Input value={f.description ?? ""} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Optional" /></Field>
      <Field label="Order"><Input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Field>
      <div className="pb-2.5"><Checkbox checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} label="Available" /></div>
      <div className="flex gap-1">
        <Button size="md" variant={dirty ? "primary" : "secondary"} disabled={!dirty || f.name.trim().length < 2} loading={pending} onClick={() => run(() => W.upsertPackageAction({ ...f, id: pkg?.id }), () => !pkg && setF({ name: "", description: "", isActive: true, sortOrder: 10 }))}>
          {pkg ? "Save" : <><Plus className="h-4 w-4" /> Add</>}
        </Button>
        {pkg && (
          <Button
            size="md"
            variant="ghost"
            className="text-danger hover:bg-danger-soft"
            aria-label={`Remove ${pkg.name}`}
            onClick={() => run(() => W.removePackageAction(pkg.id), (r) => toast.success((r.data as { mode: string }).mode === "archived" ? "Package archived — clients keep their history." : "Package deleted."))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      {pkg && <div className="text-[11.5px] text-muted sm:col-span-5">{clients ?? 0} client(s) currently on this package{!pkg.isActive && " · archived: hidden from new selections"}</div>}
    </div>
  );
}

export function ClientRulesForm({ initial }: { initial: { clientRequirePrimaryConsultant: boolean; clientFreezeCountsAsActive: boolean } }) {
  const [f, setF] = useState(initial);
  const { pending, run } = useRun();
  return (
    <div className="space-y-3">
      <Checkbox checked={f.clientRequirePrimaryConsultant} onChange={(e) => setF({ ...f, clientRequirePrimaryConsultant: e.target.checked })} label="Active clients require a Consultant" description="Client managers can still record an explicit, audited exception per client." />
      <Checkbox checked={f.clientFreezeCountsAsActive} onChange={(e) => setF({ ...f, clientFreezeCountsAsActive: e.target.checked })} label="Count Freeze clients as Active" description="Off (default): Freeze is reported separately and excluded from Active Clients." />
      <Button loading={pending} onClick={() => run(() => W.updateClientRulesAction(f))}>Save rules</Button>
    </div>
  );
}

// ───────────── Roles & access ─────────────

export function GrantEditor({ userId, name, grants, inherited, options, presets }: { userId: string; name: string; grants: string[]; inherited: string[]; options: { key: string; label: string }[]; presets: { key: string; label: string; permissions: string[] }[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(grants);
  const { pending, run } = useRun();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => { setSel(grants); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Extra access · ${name}`}
        description="Grants add permissions on top of the role. Seniority or level never grants access by itself."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={() => run(() => W.setGrantsAction(userId, sel), () => setOpen(false))}>Save access</Button>
          </>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {presets.map((p) => (
            <Button key={p.key} size="sm" variant="secondary" onClick={() => setSel([...new Set([...sel, ...p.permissions.filter((x) => !inherited.includes(x))])])}>
              <Plus className="h-3.5 w-3.5" /> {p.label}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          {options.map((o) => (
            <Checkbox
              key={o.key}
              checked={inherited.includes(o.key) || sel.includes(o.key)}
              disabled={inherited.includes(o.key)}
              onChange={(e) => setSel(e.target.checked ? [...sel, o.key] : sel.filter((x) => x !== o.key))}
              label={<span><code className="text-[12px] text-brand-700">{o.key}</code>{inherited.includes(o.key) && <span className="ml-2 text-[11px] text-muted">(from role)</span>}</span>}
              description={o.label}
            />
          ))}
        </div>
      </Dialog>
    </>
  );
}

// ───────────── Platform ─────────────

export function PlatformForm({ knowledgeHubUrl, knowledgeHubName }: { knowledgeHubUrl: string | null; knowledgeHubName: string }) {
  const [url, setUrl] = useState(knowledgeHubUrl ?? "");
  const [name, setName] = useState(knowledgeHubName);
  const { pending, run } = useRun();
  return (
    <div className="space-y-3">
      <Field label="Name" hint="Shown everywhere it appears: the sidebar, Home and Settings.">
        <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="MIL Academy – Knowledge Hub" />
      </Field>
      <Field label="URL" hint="Opens in a new tab from the sidebar and Home. Leave empty while the platform is in development — employees then see a “Platform in Development” message.">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://academy.mildigital.id" />
      </Field>
      <Button loading={pending} disabled={name.trim().length < 2} onClick={() => run(() => W.updatePlatformAction({ knowledgeHubUrl: url || null, knowledgeHubName: name }))}>Save</Button>
    </div>
  );
}

// ───────────── About MIL sections ─────────────

type Section = { id?: string; title: string; body: string; isPublished: boolean; sortOrder: number };

export function SectionEditor({ section, categoryId = null, people = [] }: { section?: Section & { id: string }; categoryId?: string | null; people?: Person[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Section>(section ?? { title: "", body: "", isPublished: true, sortOrder: 50 });
  const { pending, run } = useRun();
  return (
    <>
      {section ? (
        <Button size="sm" variant="ghost" onClick={() => { setF(section); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Add section</Button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        className="sm:max-w-5xl"
        title={section ? `Edit · ${section.title}` : "New section"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} disabled={f.title.trim().length < 2} onClick={() => run(() => W.saveSectionAction({ ...f, id: section?.id, categoryId }), () => setOpen(false))}>Save section</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
          <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Order"><Input type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Field>
        </div>
        <div className="mt-3">
          {open && <RichEditor value={f.body} onChange={(body) => setF((p) => ({ ...p, body }))} people={people} minHeight={320} />}
        </div>
        <div className="mt-3"><Checkbox checked={f.isPublished} onChange={(e) => setF({ ...f, isPublished: e.target.checked })} label="Visible in the Company Hub" /></div>
      </Dialog>
    </>
  );
}

/** A trash button that asks before deleting a Company Hub section or category. */
export function ConfirmDelete({ kind, id, title, description, label = "Delete" }: { kind: "section" | "category"; id: string; title: string; description: React.ReactNode; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger" aria-label={`${label} ${title}`} title={label} onClick={() => setOpen(true)}><Trash2 className="h-3.5 w-3.5" /></Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`${label} “${title}”?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={pending} onClick={() =>
                run(kind === "section" ? () => W.deleteSectionAction({ id }) : () => W.deleteHubCategoryAction({ id }), () => {
                  setOpen(false);
                  if (kind === "category") router.replace("/settings/content");
                })
              }
            >
              {label}</Button>
          </>
        }
      >
        <p className="text-[14px] text-ink-2">{description}</p>
      </Dialog>
    </>
  );
}

type Category = { title: string; description: string; isPublished: boolean; sortOrder: number };

export function CategoryEditor({ category }: { category?: Category & { id: string } }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Category>(category ?? { title: "", description: "", isPublished: true, sortOrder: 50 });
  const router = useRouter();
  const { pending, run } = useRun();
  return (
    <>
      {category ? (
        <Button size="sm" variant="ghost" onClick={() => { setF(category); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => { setF({ title: "", description: "", isPublished: true, sortOrder: 50 }); setOpen(true); }}><Plus className="h-3.5 w-3.5" /> Add category</Button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={category ? `Edit · ${category.title}` : "New Company Hub category"}
        description="A category is a new tab in the Company Hub, built from sections like About MIL."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={pending}
              disabled={f.title.trim().length < 2}
              onClick={() =>
                run(() => W.saveHubCategoryAction({ ...f, id: category?.id }), (r) => {
                  setOpen(false);
                  const id = (r.data as { id?: string } | undefined)?.id;
                  if (!category && id) router.push(`/settings/content?category=${id}`);
                })
              }
            >
              {category ? "Save category" : "Create category"}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
          <Field label="Name" hint="Shown as the tab name, e.g. Benefits or Onboarding."><Input value={f.title} maxLength={40} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Order"><Input type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Field>
        </div>
        <div className="mt-3"><Field label="Short description (optional)"><Input value={f.description} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
        <div className="mt-3"><Checkbox checked={f.isPublished} onChange={(e) => setF({ ...f, isPublished: e.target.checked })} label="Visible in the Company Hub" /></div>
      </Dialog>
    </>
  );
}

// ───────────── Attachments ─────────────

function AttachmentField({ value, onChange }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value ? (
        <Badge tone="brand" className="gap-1.5 py-1"><Paperclip className="h-3 w-3" /> {value.name}<button type="button" className="ml-1 text-[11px] underline" onClick={() => onChange(null)}>remove</button></Badge>
      ) : (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => ref.current?.click()}><Paperclip className="h-3.5 w-3.5" /> Attach PDF / image</Button>
      )}
      <input
        ref={ref}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.set("file", file);
          start(async () => {
            const r = await W.uploadContentFileAction(fd);
            if (!r.ok) return void toast.error(r.error);
            onChange(r.data as { id: string; name: string });
          });
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ───────────── Regulations ─────────────

export interface RegulationFormValues {
  title: string;
  category: string;
  summary: string;
  body: string;
  effectiveDate: string;
  documentUrl: string;
  attachment: { id: string; name: string } | null;
  ownerId: string;
  requiresAcknowledgement: boolean;
  changeNote: string;
}

export function RegulationEditor({
  id,
  initial,
  people,
  categories,
  label,
  isRevision,
}: {
  id?: string;
  initial: RegulationFormValues;
  people: { id: string; name: string }[];
  categories: string[];
  label: string;
  isRevision?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(initial);
  const { pending, run } = useRun();
  const set = <K extends keyof RegulationFormValues>(k: K, v: RegulationFormValues[K]) => setF((p) => ({ ...p, [k]: v }));
  const payload = { ...f, attachmentId: f.attachment?.id ?? null, ownerId: f.ownerId || null, summary: f.summary || null, documentUrl: f.documentUrl || null, changeNote: f.changeNote || null };
  return (
    <>
      <Button size="sm" variant={id ? "ghost" : "primary"} onClick={() => { setF(initial); setOpen(true); }}>
        {id ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        className="sm:max-w-5xl"
        title={id ? (isRevision ? "New revision (draft)" : "Edit draft") : "New regulation (draft)"}
        description={isRevision ? "The published version stays live until you publish this revision. Published versions never change." : "Saved as a draft. Publish it when it's ready for employees."}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={() => run(() => (id ? W.saveRegulationDraftAction(id, payload) : W.createRegulationAction(payload)), () => setOpen(false))}>Save draft</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2"><Input value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Category" required>
            <Input value={f.category} onChange={(e) => set("category", e.target.value)} list="reg-categories" placeholder="e.g. HR, IT & Security, Finance" />
            <datalist id="reg-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Effective date" required><Input type="date" value={f.effectiveDate} onChange={(e) => set("effectiveDate", e.target.value)} /></Field>
          <Field label="Owner"><Select value={f.ownerId} onChange={(e) => set("ownerId", e.target.value)}><option value="">— None —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Document URL"><Input value={f.documentUrl} onChange={(e) => set("documentUrl", e.target.value)} placeholder="https://drive.google.com/…" /></Field>
          <Field label="Short description" className="sm:col-span-2"><Input value={f.summary} onChange={(e) => set("summary", e.target.value)} maxLength={500} /></Field>
          <div className="sm:col-span-2">
            <div className="mb-1.5 text-[13px] font-medium text-ink">Content</div>
            {open && <RichEditor value={f.body} onChange={(v) => set("body", v)} people={people} />}
          </div>
          <Field label="Attachment" className="sm:col-span-2"><AttachmentField value={f.attachment} onChange={(v) => set("attachment", v)} /></Field>
          {isRevision && <Field label="What changed?" className="sm:col-span-2"><Input value={f.changeNote} onChange={(e) => set("changeNote", e.target.value)} /></Field>}
          <div className="sm:col-span-2"><Checkbox checked={f.requiresAcknowledgement} onChange={(e) => set("requiresAcknowledgement", e.target.checked)} label="Employees must acknowledge this regulation" description="Each published version asks every active employee to confirm they've read it." /></div>
        </div>
      </Dialog>
    </>
  );
}

export function RegulationAdminActions({ id, hasDraft, status, published }: { id: string; hasDraft: boolean; status: string; published: boolean }) {
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap gap-1">
      {hasDraft && status !== "ARCHIVED" && <Button size="sm" loading={pending} onClick={() => run(() => W.publishRegulationAction(id))}>Publish</Button>}
      {hasDraft && published && <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => W.discardRegulationDraftAction(id))}>Discard draft</Button>}
      <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => W.archiveRegulationAction(id, status !== "ARCHIVED"))}>{status === "ARCHIVED" ? "Restore" : "Archive"}</Button>
    </div>
  );
}

// ───────────── Announcements ─────────────

export interface AnnouncementFormValues {
  title: string;
  body: string;
  category: string;
  priority: "NORMAL" | "IMPORTANT" | "CRITICAL";
  publishAt: string; // yyyy-MM-ddTHH:mm (Jakarta)
  expiresAt: string;
  audienceType: "ALL" | "TEAMS" | "LEVELS" | "EMPLOYEES";
  teamIds: string[];
  levelIds: string[];
  employeeIds: string[];
  linkUrl: string;
  attachment: { id: string; name: string } | null;
}

const toUtc = (local: string) => (local ? new Date(`${local}:00+07:00`).toISOString() : null);

export function AnnouncementEditor({
  id,
  initial,
  teams,
  levels,
  people,
  categories,
}: {
  id?: string;
  initial: AnnouncementFormValues;
  teams: { id: string; name: string }[];
  levels: { id: string; name: string }[];
  people: { id: string; name: string }[];
  categories: string[];
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(initial);
  const { pending, run } = useRun();
  const set = <K extends keyof AnnouncementFormValues>(k: K, v: AnnouncementFormValues[K]) => setF((p) => ({ ...p, [k]: v }));
  const save = (status: "DRAFT" | "PUBLISHED") =>
    run(
      () =>
        W.saveAnnouncementAction(id ?? null, {
          ...f,
          status,
          publishAt: toUtc(f.publishAt),
          expiresAt: toUtc(f.expiresAt),
          linkUrl: f.linkUrl || null,
          attachmentId: f.attachment?.id ?? null,
        }),
      () => setOpen(false),
    );
  const targets = f.audienceType === "TEAMS" ? teams : f.audienceType === "LEVELS" ? levels : f.audienceType === "EMPLOYEES" ? people : [];
  const key = f.audienceType === "TEAMS" ? "teamIds" : f.audienceType === "LEVELS" ? "levelIds" : "employeeIds";
  return (
    <>
      <Button size="sm" variant={id ? "ghost" : "primary"} onClick={() => { setF(initial); setOpen(true); }}>
        {id ? <><Pencil className="h-3.5 w-3.5" /> Edit</> : <><Plus className="h-3.5 w-3.5" /> New announcement</>}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        className="sm:max-w-5xl"
        title={id ? "Edit announcement" : "New announcement"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="secondary" loading={pending} onClick={() => save("DRAFT")}>Save draft</Button>
            <Button loading={pending} onClick={() => save("PUBLISHED")}>Publish</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2"><Input value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="Category" required>
            <Input value={f.category} onChange={(e) => set("category", e.target.value)} list="ann-categories" placeholder="Company update, Regulation, Milestone…" />
            <datalist id="ann-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={(e) => set("priority", e.target.value as AnnouncementFormValues["priority"])}>
              <option value="NORMAL">Normal</option>
              <option value="IMPORTANT">Important</option>
              <option value="CRITICAL">Critical</option>
            </Select>
          </Field>
          <Field label="Publish at (WIB)" required><Input type="datetime-local" value={f.publishAt} onChange={(e) => set("publishAt", e.target.value)} /></Field>
          <Field label="Expires at (optional)"><Input type="datetime-local" value={f.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <div className="mb-1.5 text-[13px] font-medium text-ink">Content</div>
            {open && <RichEditor value={f.body} onChange={(v) => set("body", v)} people={people} minHeight={200} />}
          </div>
          <Field label="Target audience">
            <Select value={f.audienceType} onChange={(e) => set("audienceType", e.target.value as AnnouncementFormValues["audienceType"])}>
              <option value="ALL">All employees</option>
              <option value="TEAMS">Selected teams</option>
              <option value="LEVELS">Selected employee levels</option>
              <option value="EMPLOYEES">Selected employees</option>
            </Select>
          </Field>
          <Field label="Link (optional)"><Input value={f.linkUrl} onChange={(e) => set("linkUrl", e.target.value)} placeholder="https://" /></Field>
          {f.audienceType !== "ALL" && (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-line-2 p-3 sm:col-span-2">
              {targets.map((t) => (
                <Checkbox key={t.id} checked={(f[key] as string[]).includes(t.id)} onChange={(e) => set(key, e.target.checked ? [...(f[key] as string[]), t.id] : (f[key] as string[]).filter((x) => x !== t.id))} label={t.name} />
              ))}
            </div>
          )}
          <Field label="Attachment" className="sm:col-span-2"><AttachmentField value={f.attachment} onChange={(v) => set("attachment", v)} /></Field>
        </div>
      </Dialog>
    </>
  );
}

export function AnnouncementStatusButtons({ id, status }: { id: string; status: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex gap-1">
      {status !== "PUBLISHED" && status !== "ARCHIVED" && <Button size="sm" loading={pending} onClick={() => run(() => W.setAnnouncementStatusAction(id, "PUBLISHED"))}>Publish</Button>}
      {status === "PUBLISHED" && <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => W.setAnnouncementStatusAction(id, "DRAFT"))}>Unpublish</Button>}
      {status !== "ARCHIVED" ? (
        <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => W.setAnnouncementStatusAction(id, "ARCHIVED"))}>Archive</Button>
      ) : (
        <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => W.setAnnouncementStatusAction(id, "DRAFT"))}>Restore as draft</Button>
      )}
    </div>
  );
}

// ───────────── Recognition ─────────────

export function RecognitionEditor({ id, initial, people }: { id?: string; initial: { employeeId: string; kind: "PROMOTION" | "RECOGNITION" | "MILESTONE"; title: string; message: string; date: string; status: "PUBLISHED" | "DRAFT" }; people: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(initial);
  const { pending, run } = useRun();
  return (
    <>
      <Button size="sm" variant={id ? "ghost" : "primary"} onClick={() => { setF(initial); setOpen(true); }}>
        {id ? <><Pencil className="h-3.5 w-3.5" /> Edit</> : <><Plus className="h-3.5 w-3.5" /> Add recognition</>}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={id ? "Edit recognition" : "Recognise someone"}
        description="Birthdays, work anniversaries and level promotions appear automatically from the directory."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} disabled={!f.employeeId || f.title.trim().length < 3} onClick={() => run(() => W.saveRecognitionAction(id ?? null, { ...f, message: f.message || null }), () => setOpen(false))}>Save</Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee" required><Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}><option value="RECOGNITION">Recognition</option><option value="PROMOTION">Promotion</option><option value="MILESTONE">Milestone</option></Select></Field>
          <Field label="Title" required className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Client Hero of Q3" /></Field>
          <Field label="Message" className="sm:col-span-2"><Textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}><option value="PUBLISHED">Published</option><option value="DRAFT">Draft</option></Select></Field>
        </div>
      </Dialog>
    </>
  );
}

export function ArchiveRecognitionButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" className="text-danger" loading={pending} onClick={() => run(() => W.archiveRecognitionAction(id))}>Remove</Button>;
}

export function AckNotice() {
  return <Notice>Acknowledgements are tracked per published version.</Notice>;
}

// ───────────── Client categories, ad accounts, industries ─────────────

type ListItem = { id?: string; name: string; isActive: boolean; sortOrder: number };

/** Row editor for simple named lists (client categories, ad account types). */
export function NamedListRow({ kind, item, usage }: { kind: "category" | "adAccount"; item?: ListItem & { id: string }; usage?: number }) {
  const blank = { name: "", isActive: true, sortOrder: 50 };
  const [f, setF] = useState<ListItem>(item ?? blank);
  const { pending, run } = useRun();
  const dirty = !item || JSON.stringify(f) !== JSON.stringify(item);
  const save = () => run(() => (kind === "category" ? W.upsertCategoryAction({ ...f, id: item?.id }) : W.upsertAdAccountTypeAction({ ...f, id: item?.id })), () => !item && setF(blank));
  return (
    <div className="grid items-end gap-2 border-b border-line-2 py-2.5 sm:grid-cols-[1fr_80px_auto_auto]">
      <Field label={item ? (usage !== undefined ? `Name · ${usage} client(s)` : "Name") : kind === "category" ? "New category" : "New ad account"}>
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} />
      </Field>
      <Field label="Order"><Input type="number" min={0} value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: Number(e.target.value) })} /></Field>
      <div className="pb-2.5"><Checkbox checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} label="Available" /></div>
      <Button size="md" variant={dirty ? "primary" : "secondary"} disabled={!dirty || f.name.trim().length < 2} loading={pending} onClick={save}>{item ? "Save" : <><Plus className="h-4 w-4" /> Add</>}</Button>
    </div>
  );
}

export function IndustryRow({ industry, categories }: { industry: { id: string; name: string; categoryId: string | null; brands: number; subIndustries: { id: string; name: string }[] }; categories: { id: string; name: string }[] }) {
  const [f, setF] = useState({ name: industry.name, categoryId: industry.categoryId ?? "" });
  const { pending, run } = useRun();
  const dirty = f.name !== industry.name || f.categoryId !== (industry.categoryId ?? "");
  return (
    <div className="border-b border-line-2 py-3">
      <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Field label={`Industry · ${industry.brands} client(s)`}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></Field>
        <Field label="Category">
          <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            <option value="">Uncategorised</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Button size="md" variant={dirty ? "primary" : "secondary"} disabled={!dirty || f.name.trim().length < 2} loading={pending} onClick={() => run(() => W.updateIndustryAction({ kind: "industry", id: industry.id, name: f.name, categoryId: f.categoryId || null }))}>Save</Button>
        <Button size="md" variant="ghost" className="text-danger" disabled={industry.brands > 0 || industry.subIndustries.length > 0} title={industry.brands || industry.subIndustries.length ? "In use" : "Delete"} onClick={() => run(() => W.updateIndustryAction({ kind: "industry", id: industry.id, remove: true }))}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {industry.subIndustries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5 pl-1">
          <span className="text-[11.5px] text-muted">Sub-industries:</span>
          {industry.subIndustries.map((s) => <SubIndustryChip key={s.id} sub={s} />)}
        </div>
      )}
    </div>
  );
}

function SubIndustryChip({ sub }: { sub: { id: string; name: string } }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sub.name);
  const { pending, run } = useRun();
  if (editing)
    return (
      <span className="inline-flex items-center gap-1">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 w-[160px] text-[12px]" autoFocus maxLength={80} />
        <Button size="sm" loading={pending} onClick={() => run(() => W.updateIndustryAction({ kind: "sub", id: sub.id, name }), () => setEditing(false))}>Save</Button>
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => run(() => W.updateIndustryAction({ kind: "sub", id: sub.id, remove: true }))}>Delete</Button>
      </span>
    );
  return (
    <button type="button" onClick={() => setEditing(true)} className="rounded-full border border-line bg-white px-2.5 py-0.5 text-[12px] text-ink-2 hover:border-brand-300" title="Rename or delete">
      {sub.name}
    </button>
  );
}
