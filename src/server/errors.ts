export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "INVALID_STATE";

export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
    this.name = "DomainError";
  }
}

export const forbidden = (msg = "You are not allowed to perform this action.") => new DomainError("FORBIDDEN", msg);
export const notFound = (what = "Record") => new DomainError("NOT_FOUND", `${what} not found.`);
export const invalid = (msg: string, details?: unknown) => new DomainError("VALIDATION", msg, details);
export const conflict = (msg: string, details?: unknown) => new DomainError("CONFLICT", msg, details);
export const badState = (msg: string) => new DomainError("INVALID_STATE", msg);

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; code?: ErrorCode; details?: unknown };

/** Wraps a server action so domain errors become typed results and unexpected errors are not leaked. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message, code: e.code, details: e.details };
    if (e && typeof e === "object" && (e as { name?: string }).name === "ZodError") {
      const issue = (e as { issues?: { message: string; path: (string | number)[] }[] }).issues?.[0];
      return { ok: false, error: issue ? `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}` : "Invalid input.", code: "VALIDATION" };
    }
    // Next.js redirect()/notFound() must propagate
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    const prismaCode = (e as { code?: string }).code;
    if (prismaCode === "P2002") return { ok: false, error: "This record already exists (duplicate submission prevented).", code: "CONFLICT" };
    console.error("[action error]", e);
    return { ok: false, error: "Something went wrong. Please try again.", code: "INVALID_STATE" };
  }
}
