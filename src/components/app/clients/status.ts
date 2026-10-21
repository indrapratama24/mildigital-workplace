import type { Tone } from "@/components/ui/badge";
import type { ClientStatusT } from "@/lib/engine/clients";

export const STATUS_TONE: Record<ClientStatusT, Tone> = { ACTIVE: "success", INACTIVE: "neutral", FREEZE: "permission" };
