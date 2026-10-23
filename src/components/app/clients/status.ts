import type { Tone } from "@/components/ui/badge";
import type { ClientDisplayStatus } from "@/lib/engine/clients";

export const STATUS_TONE: Record<ClientDisplayStatus, Tone> = { ACTIVE: "success", INACTIVE: "neutral", FREEZE: "permission", PREPARATION: "pending" };
