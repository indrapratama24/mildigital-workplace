"use client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16">
      <Notice tone="danger" title="Something went wrong">
        We couldn&apos;t load this page. {error.digest ? `Reference: ${error.digest}` : ""}
      </Notice>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
