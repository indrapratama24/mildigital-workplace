// Per-level exceptions to a request type's rules (e.g. leaders need more notice).
// An exception lists the levels it covers and only the rules it changes; anything left out keeps the type's own value.

export type Requirement = "NONE" | "OPTIONAL" | "REQUIRED";

export interface LevelRuleOverrides {
  documentRequirement?: Requirement | null;
  delegation?: Requirement | null;
  reasonMinLength?: number | null;
  advanceNoticeDays?: number | null;
  allowHalfDay?: boolean | null;
  allowHourly?: boolean | null;
  defaultEntitlement?: number | null;
}

export interface LevelException extends LevelRuleOverrides {
  name: string;
  levelIds: string[];
}

export const OVERRIDE_KEYS = ["documentRequirement", "delegation", "reasonMinLength", "advanceNoticeDays", "allowHalfDay", "allowHourly", "defaultEntitlement"] as const;

/** Reads the stored JSON defensively (unknown keys dropped, empty values ignored). */
export function parseLevelExceptions(raw: unknown): LevelException[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => {
      const out: LevelException = { name: String(x.name ?? ""), levelIds: Array.isArray(x.levelIds) ? x.levelIds.map(String) : [] };
      for (const k of OVERRIDE_KEYS) if (x[k] !== undefined && x[k] !== null) (out as unknown as Record<string, unknown>)[k] = x[k];
      return out;
    })
    .filter((x) => x.levelIds.length);
}

/** The type's rules as they apply to someone at `levelId`: the first exception covering that level wins. */
export function rulesForLevel<T extends { levelExceptions: unknown } & Required<{ [K in keyof LevelRuleOverrides]: unknown }>>(type: T, levelId: string | null | undefined): T & { exceptionName: string | null } {
  const ex = levelId ? parseLevelExceptions(type.levelExceptions).find((e) => e.levelIds.includes(levelId)) : undefined;
  if (!ex) return { ...type, exceptionName: null };
  const merged: Record<string, unknown> = { ...type, exceptionName: ex.name || "Exception" };
  for (const k of OVERRIDE_KEYS) if (ex[k] !== undefined && ex[k] !== null) merged[k] = ex[k];
  return merged as T & { exceptionName: string | null };
}
