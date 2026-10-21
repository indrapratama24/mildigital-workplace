// Application-level encryption for sensitive personal data (NIK, NPWP, bank account numbers).
// AES-256-GCM with a random IV per value; format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
// The key (32 bytes, base64) lives in DATA_ENCRYPTION_KEY — back it up: without it encrypted values can't be read.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) throw new Error("DATA_ENCRYPTION_KEY is not configured");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes (base64)");
  return k;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unsupported ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/** Keyed hash for uniqueness checks without storing the plaintext. */
export function blindIndex(value: string): string {
  return createHmac("sha256", key()).update(`idx:${value}`).digest("hex");
}

export const last4 = (v: string) => v.replace(/\D/g, "").slice(-4);
export const mask = (l4: string | null | undefined) => (l4 ? `•••• ${l4}` : null);
