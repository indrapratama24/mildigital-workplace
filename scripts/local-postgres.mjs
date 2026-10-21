// Local development PostgreSQL (real Postgres binaries shipped via npm).
// Production deployments should point DATABASE_URL at a managed PostgreSQL instance instead.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".local-pg");
const port = Number(process.env.LOCAL_PG_PORT ?? 5433);
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "mil",
  password: "mil_local_dev",
  port,
  persistent: true,
  onLog: () => {},
});

const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
if (fresh) await pg.initialise();
await pg.start();
for (const db of ["mil_hybrid", "mil_hybrid_test"]) {
  try { await pg.createDatabase(db); } catch { /* already exists */ }
}
console.log(`Local PostgreSQL running on port ${port} (data: ${dataDir}). Ctrl+C to stop.`);
const stop = async () => { await pg.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
