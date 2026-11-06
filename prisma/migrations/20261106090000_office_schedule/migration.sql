-- AlterTable
ALTER TABLE "ScheduleDay" ADD COLUMN     "frozen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "personal" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TeamOfficePattern" (
    "teamId" TEXT NOT NULL,
    "wfoWeekdays" INTEGER[],
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamOfficePattern_pkey" PRIMARY KEY ("teamId")
);

-- CreateTable
CREATE TABLE "OfficeDay" (
    "id" TEXT NOT NULL,
    "teamId" TEXT,
    "date" DATE NOT NULL,
    "mode" "WorkMode" NOT NULL,
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficeDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficeDay_date_idx" ON "OfficeDay"("date");

-- AddForeignKey
ALTER TABLE "TeamOfficePattern" ADD CONSTRAINT "TeamOfficePattern_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeDay" ADD CONSTRAINT "OfficeDay_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One override per date for the company, and one per date per team
CREATE UNIQUE INDEX "OfficeDay_company_date_key" ON "OfficeDay"("date") WHERE "teamId" IS NULL;
CREATE UNIQUE INDEX "OfficeDay_team_date_key" ON "OfficeDay"("teamId", "date") WHERE "teamId" IS NOT NULL;
-- An office day is either in the office or remote (offsite stays a request)
ALTER TABLE "OfficeDay" ADD CONSTRAINT "OfficeDay_mode_check" CHECK ("mode" IN ('WFO', 'WFH'));
