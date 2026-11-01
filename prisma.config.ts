// Prisma CLI configuration (generate, migrate, seed). Prisma 7 no longer reads .env on its own.
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile(); // local .env; variables already set (e.g. on Vercel) take precedence
} catch {
  /* no .env file */
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx --env-file-if-exists=.env prisma/seed.ts" },
  // Migrations use the direct (non-pooled) connection; the app connects via DATABASE_URL (see src/server/db.ts).
  // Left optional so `prisma generate` (postinstall) works without a database configured.
  datasource: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL },
});
