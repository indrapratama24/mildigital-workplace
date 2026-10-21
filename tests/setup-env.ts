import { readFileSync, existsSync } from "node:fs";

// Minimal .env loader for tests; integration tests always run against TEST_DATABASE_URL.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED = process.env.TEST_DATABASE_URL;
process.env.TZ = "UTC";
