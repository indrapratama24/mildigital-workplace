// Private file storage. Files live outside /public and are only served through the authorised
// /api/files/[id] route. STORAGE_DRIVER selects the backend:
//   "disk" (default locally)  — files under UPLOAD_DIR
//   "db"   (default on Vercel) — files in the FileBlob table (serverless hosts have no persistent disk)
// For large volumes, add an S3/GCS/Vercel Blob implementation of StorageAdapter.
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalDiskStorage implements StorageAdapter {
  constructor(private root: string) {}
  private resolve(key: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error("Invalid storage key");
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.resolve(key), data, { mode: 0o600 });
  }
  get(key: string) {
    return readFile(this.resolve(key));
  }
  async remove(key: string) {
    await unlink(this.resolve(key)).catch(() => {});
  }
}

class DatabaseStorage implements StorageAdapter {
  async put(key: string, data: Buffer) {
    const { db } = await import("../db");
    await db.fileBlob.create({ data: { storageKey: key, data: new Uint8Array(data) } });
  }
  async get(key: string) {
    const { db } = await import("../db");
    const row = await db.fileBlob.findUniqueOrThrow({ where: { storageKey: key } });
    return Buffer.from(row.data);
  }
  async remove(key: string) {
    const { db } = await import("../db");
    await db.fileBlob.deleteMany({ where: { storageKey: key } });
  }
}

let instance: StorageAdapter | null = null;
export function getStorage(): StorageAdapter {
  if (!instance) {
    const driver = process.env.STORAGE_DRIVER ?? (process.env.VERCEL ? "db" : "disk");
    instance = driver === "db" ? new DatabaseStorage() : new LocalDiskStorage(path.resolve(process.env.UPLOAD_DIR ?? "./storage/uploads"));
  }
  return instance;
}
