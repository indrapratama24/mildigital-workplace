// Server component: renders stored content — rich (TipTap JSON → sanitised HTML) or legacy Markdown.
import { isDocJson } from "@/lib/content/format";
import { renderContentHtml } from "@/server/content";
import { RichText } from "./rich-text";
import { cn } from "@/lib/cn";

export function ContentBody({ body, className }: { body: string; className?: string }) {
  if (!isDocJson(body)) return <RichText text={body} className={className} />;
  return <div className={cn("rich-content", className)} dangerouslySetInnerHTML={{ __html: renderContentHtml(body) }} />;
}
