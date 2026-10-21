"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { Loader2 } from "lucide-react";
import { eventDetailAction } from "@/server/actions/calendar";
import type { EventDetail } from "@/server/services/events";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/misc";
import { EventDetailView } from "./event-detail-view";

const Ctx = createContext<{ open: (id: string) => void }>({ open: () => {} });
export const useEventDialog = () => useContext(Ctx);

/** Provides a single Event Details modal for every event chip below it. */
export function EventDialogProvider({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const [data, setData] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(async (eventId: string) => {
    setId(eventId);
    setData(null);
    setError(null);
    const r = await eventDetailAction(eventId);
    if (r.ok) setData(r.data!);
    else setError(r.error);
  }, []);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <Dialog open={!!id} onOpenChange={(o) => !o && setId(null)} title={data?.title ?? "Event"} description={data ? `${data.category.name} · ${data.topic}` : undefined} className="sm:max-w-2xl">
        {!data && !error && (
          <div className="flex justify-center py-10 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {data && <EventDetailView e={data} compact onDone={() => setId(null)} />}
      </Dialog>
    </Ctx.Provider>
  );
}
