"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { acknowledgeRegulationAction } from "@/server/actions/workplace";
import { Button } from "@/components/ui/button";

export function AcknowledgeButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await acknowledgeRegulationAction(id);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          router.refresh();
        })
      }
    >
      <CheckCircle2 className="h-4 w-4" /> I have read and understood this
    </Button>
  );
}
