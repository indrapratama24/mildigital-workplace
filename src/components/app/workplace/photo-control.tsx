"use client";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { removePhotoAction, uploadPhotoAction } from "@/server/actions/workplace";
import { Avatar } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

/** Profile photo with upload/remove (own profile, or HR). */
export function PhotoControl({ employeeId, name, photoId }: { employeeId: string; name: string; photoId: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span className="group relative inline-flex">
      <button type="button" onClick={() => ref.current?.click()} className={cn("relative rounded-full", pending && "opacity-50")} aria-label="Change profile photo" title="Change profile photo">
        <Avatar name={name} photoId={photoId} className="h-11 w-11 text-[15px]" />
        <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-brand-700 text-white">
          <Camera className="h-2.5 w-2.5" />
        </span>
      </button>
      {photoId && (
        <button
          type="button"
          className="absolute -bottom-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap text-[10.5px] font-normal text-muted hover:text-danger group-hover:block"
          onClick={() =>
            start(async () => {
              const r = await removePhotoAction(employeeId);
              if (!r.ok) return void toast.error(r.error);
              router.refresh();
            })
          }
        >
          remove
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.set("file", file);
          start(async () => {
            const r = await uploadPhotoAction(employeeId, fd);
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message);
            router.refresh();
          });
          e.target.value = "";
        }}
      />
    </span>
  );
}
