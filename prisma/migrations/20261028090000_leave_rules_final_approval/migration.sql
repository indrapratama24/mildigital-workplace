-- CreateEnum
CREATE TYPE "YearEndOption" AS ENUM ('CASH', 'CARRY');

-- AlterEnum
ALTER TYPE "StepKind" ADD VALUE 'FINAL';


-- AlterTable
ALTER TABLE "RequestType" ADD COLUMN     "annualRules" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LeaveYearEndChoice" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestTypeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "option" "YearEndOption" NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveYearEndChoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveYearEndChoice_employeeId_requestTypeId_year_key" ON "LeaveYearEndChoice"("employeeId", "requestTypeId", "year");

-- AddForeignKey
ALTER TABLE "LeaveYearEndChoice" ADD CONSTRAINT "LeaveYearEndChoice_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveYearEndChoice" ADD CONSTRAINT "LeaveYearEndChoice_requestTypeId_fkey" FOREIGN KEY ("requestTypeId") REFERENCES "RequestType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Annual leave policy defaults ──
-- 1 day per month, 14 days' notice, tier rules and year-end choice for Annual Leave.
UPDATE "RequestType" SET "annualRules" = true, "advanceNoticeDays" = 14 WHERE "code" = 'ANNUAL';

-- Final approval after the leader: Indra (CEO) for leave requests. Changeable in Settings → Approvals.
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'finalApproverEmployeeId', to_jsonb(e."id"), now() FROM "Employee" e WHERE lower(e."email") = 'indra@mildigital.id' AND e."isActive"
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'finalApprovalRequestTypes', COALESCE(jsonb_agg(t."id"), '[]'::jsonb), now() FROM "RequestType" t WHERE t."category" = 'LEAVE'
ON CONFLICT ("key") DO NOTHING;
