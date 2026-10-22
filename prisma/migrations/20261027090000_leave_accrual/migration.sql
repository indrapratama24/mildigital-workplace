-- Monthly leave accrual for eligible (full-time) employees.
ALTER TABLE "RequestType" ADD COLUMN "monthlyAccrual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "eligibleStatuses" "EmploymentStatus"[] DEFAULT ARRAY[]::"EmploymentStatus"[];
ALTER TABLE "Employee" ADD COLUMN "fullTimeSince" DATE;

-- Annual leave: 12 days a year, earned 1 per month, for permanent (full-time) employees.
UPDATE "RequestType" SET "monthlyAccrual" = true, "eligibleStatuses" = ARRAY['PERMANENT']::"EmploymentStatus"[] WHERE "code" = 'ANNUAL';
-- Existing permanent employees have been full-time since they joined (HR can correct this per person).
UPDATE "Employee" SET "fullTimeSince" = "startDate" WHERE "employmentStatus" = 'PERMANENT';
