import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Prisma 7 connects through the `pg` driver; the 5 s connect timeout matches Prisma 6's default. */
export function createDbClient(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5000 });
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

export const db: PrismaClient = globalForPrisma.prisma ?? createDbClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Prisma.TransactionClient;
export type DbOrTx = PrismaClient | Tx;

/** Serializable transactions for approvals / schedule updates; retries on serialization conflicts. */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if ((code === "P2034" || code === "40001") && attempt < retries) continue;
      throw e;
    }
  }
}
