"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, X, MessageSquareWarning, HelpCircle } from "lucide-react";
import { decideAction, clarifyAction, reassignAction, cancelRevisionAction } from "@/server/actions/work";
import { cancelRequestAction as cancelReq } from "@/server/actions/requests";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";

type Decision = "APPROVE" | "REJECT" | "REQUEST_CHANGES" | "ACCEPT" | "DECLINE" | "REQUEST_CLARIFICATION";

const LABELS: Record<Decision, string> = {
  APPROVE: "Approve",
  REJECT: "Reject",
  REQUEST_CHANGES: "Request changes",
  ACCEPT: "Accept delegation",
  DECLINE: "Decline delegation",
  REQUEST_CLARIFICATION: "Request clarification",
};

export function DecisionPanel({ stepId, kind, redirectTo = "/approvals" }: { stepId: string; kind: "LEADER" | "HR" | "DELEGATE"; redirectTo?: string }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [confirm, setConfirm] = useState<Decision | null>(null);
  const [pending, start] = useTransition();
  const decisions: Decision[] = kind === "DELEGATE" ? ["ACCEPT", "REQUEST_CLARIFICATION", "DECLINE"] : ["APPROVE", "REQUEST_CHANGES", "REJECT"];
  const needsComment = (d: Decision) => ["REJECT", "REQUEST_CHANGES", "DECLINE", "REQUEST_CLARIFICATION"].includes(d);
  const go = (d: Decision) =>
    start(async () => {
      if (needsComment(d) && !comment.trim()) return void toast.error("Please add a comment explaining your decision.");
      const r = await decideAction({ stepId, decision: d, comment: comment || undefined });
      setConfirm(null);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${LABELS[d]} — done.`);
      router.push(redirectTo);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <Field label="Comment" hint={kind === "DELEGATE" ? "Required when declining or asking for clarification." : "Required when rejecting or requesting changes."}>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder={kind === "DELEGATE" ? "e.g. Happy to cover — I'll check pacing daily." : "Add a note for the employee"} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {decisions.map((d) => (
          <Button
            key={d}
            variant={d === "APPROVE" || d === "ACCEPT" ? "primary" : d === "REJECT" || d === "DECLINE" ? "danger-outline" : "secondary"}
            onClick={() => (d === "REJECT" || d === "DECLINE" ? setConfirm(d) : go(d))}
            loading={pending && confirm === null && false}
            disabled={pending}
          >
            {d === "APPROVE" || d === "ACCEPT" ? <Check className="h-4 w-4" /> : d === "REJECT" || d === "DECLINE" ? <X className="h-4 w-4" /> : d === "REQUEST_CLARIFICATION" ? <HelpCircle className="h-4 w-4" /> : <MessageSquareWarning className="h-4 w-4" />}
            {LABELS[d]}
          </Button>
        ))}
      </div>
      <Dialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `${LABELS[confirm]}?` : ""}
        description={confirm === "DECLINE" ? "The employee will be asked to choose another delegate." : "This closes the request. The employee is notified with your comment."}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Back
            </Button>
            <Button variant="danger" loading={pending} onClick={() => confirm && go(confirm)}>
              {confirm ? LABELS[confirm] : ""}
            </Button>
          </>
        }
      >
        {!comment.trim() && <p className="text-sm text-danger">Add a comment first.</p>}
      </Dialog>
    </div>
  );
}

export function ClarifyForm({ stepId }: { stepId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Answer your delegate's question" />
      <Button
        loading={pending}
        disabled={!text.trim()}
        onClick={() =>
          start(async () => {
            const r = await clarifyAction({ stepId, comment: text });
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message);
            setText("");
            router.refresh();
          })
        }
      >
        Send clarification
      </Button>
    </div>
  );
}

export function ReassignForm({ stepId, candidates }: { stepId: string; candidates: { id: string; fullName: string }[] }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Select value={to} onChange={(e) => setTo(e.target.value)} aria-label="New approver">
        <option value="">Choose a new approver…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName}
          </option>
        ))}
      </Select>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. leader on leave)" className="min-h-[60px]" />
      <Button
        variant="secondary"
        size="sm"
        disabled={!to || reason.trim().length < 5}
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await reassignAction({ stepId, assigneeId: to, reason });
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message);
            router.refresh();
          })
        }
      >
        Reassign approval
      </Button>
    </div>
  );
}

export function CancelButton({ id, kind }: { id: string; kind: "request" | "revision" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="danger-outline" size="sm" onClick={() => setOpen(true)}>
        Cancel {kind}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Cancel this ${kind}?`}
        description="Pending approvals are withdrawn and approvers are no longer asked to act."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = kind === "request" ? await cancelReq(id) : await cancelRevisionAction(id);
                  setOpen(false);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  router.refresh();
                })
              }
            >
              Cancel {kind}
            </Button>
          </>
        }
      />
    </>
  );
}

