/* eslint-disable no-console */
// Production bootstrap (run once against an empty, migrated database):
//   1. loads reference configuration (level policies, request types, holidays, default teams)
//   2. creates the first Super Admin with a password typed interactively (never stored in code or logs)
// Usage:  npm run db:bootstrap   (uses DATABASE_URL from the environment / .env.production.local)
import { PrismaClient } from "@prisma/client";
import readline from "node:readline";
import { hashPassword, passwordPolicyError } from "../src/server/auth/password";
import { fromISO, todayJakarta } from "../src/lib/dates";
import { createReferenceData } from "./reference";

const db = new PrismaClient();

// One shared readline interface (works for interactive terminals and piped input).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let muted = false;
const rlw = rl as unknown as { _writeToOutput: (s: string) => void };
const write = rlw._writeToOutput.bind(rl);
rlw._writeToOutput = (s: string) => (muted ? undefined : write(s));
const lines: string[] = [];
const waiters: ((s: string) => void)[] = [];
rl.on("line", (l) => (waiters.length ? waiters.shift()!(l) : lines.push(l)));

function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  return new Promise((resolve) => {
    const done = (answer: string) => {
      muted = false;
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    };
    if (lines.length) done(lines.shift()!);
    else waiters.push(done);
  });
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/\/\/[^@]*@/, "//***@").split("?")[0];
  console.log(`Database: ${host}`);
  if ((await db.user.count()) > 0) {
    console.log("Users already exist — bootstrap has already run. Nothing to do.");
    return;
  }
  const name = (await ask("Admin full name [Indra Pratama]: ")) || "Indra Pratama";
  const email = ((await ask("Admin work email [indra@mildigital.id]: ")) || "indra@mildigital.id").toLowerCase();
  let password = "";
  for (;;) {
    password = await ask("Password (hidden): ", true);
    const err = passwordPolicyError(password);
    if (err) {
      console.log(err);
      continue;
    }
    if ((await ask("Confirm password (hidden): ", true)) !== password) {
      console.log("Passwords don't match.");
      continue;
    }
    break;
  }

  const hasReference = (await db.policy.count()) > 0;
  const ref = hasReference ? null : await createReferenceData(db);
  const level = await db.employeeLevel.findUniqueOrThrow({ where: { code: "MANAGER" } });
  const team = await db.team.findFirst({ where: { name: "People Ops" } });
  const annual = await db.requestType.findUnique({ where: { code: "ANNUAL" } });
  const today = todayJakarta();

  await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, role: "SUPER_ADMIN", passwordHash: await hashPassword(password) } });
    const emp = await tx.employee.create({
      data: { employeeCode: "MIL-0001", fullName: name, email, jobTitle: "Managing Director", startDate: fromISO(today), userId: user.id, departmentId: team?.departmentId ?? null },
    });
    await tx.employeeLevelAssignment.create({ data: { employeeId: emp.id, levelId: level.id, effectiveFrom: fromISO(`${today.slice(0, 4)}-01-01`), reason: "Initial level" } });
    if (team) await tx.employeeTeamMembership.create({ data: { employeeId: emp.id, teamId: team.id, effectiveFrom: fromISO(today) } });
    if (annual) await tx.leaveBalance.create({ data: { employeeId: emp.id, requestTypeId: annual.id, year: Number(today.slice(0, 4)), entitledDays: 12 } });
    await tx.systemSetting.upsert({ where: { key: "hrFallbackEmployeeId" }, create: { key: "hrFallbackEmployeeId", value: emp.id }, update: {} });
    await tx.auditLog.create({ data: { actorUserId: user.id, action: "system.bootstrap", entityType: "System", entityId: "bootstrap", metadata: { referenceLoaded: !!ref } } });
  });
  console.log(`\nDone. Sign in as ${email}. ${ref ? "Reference policies, request types, holidays and default teams were loaded." : ""}`);
  console.log("Next: Settings → Holidays (verify dates), Team Directory → Add employee / Import CSV.");
}

main()
  .then(() => {
    rl.close();
    return db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
