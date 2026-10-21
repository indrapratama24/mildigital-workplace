-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventLocationType" AS ENUM ('IN_OFFICE', 'ONLINE', 'HYBRID', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "EventAttendance" AS ENUM ('MANDATORY', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "EventWfoRequirement" AS ENUM ('IN_OFFICE_REQUIRED', 'REMOTE_ALLOWED', 'NONE');

-- CreateEnum
CREATE TYPE "EventAssignmentType" AS ENUM ('ALL', 'DEPARTMENT', 'TEAM', 'LEVEL', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "EventParticipantStatus" AS ENUM ('INVITED', 'ATTENDED', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "RecurrenceFreq" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CalendarRole" AS ENUM ('VIEWER', 'ORGANIZER', 'EDITOR', 'MANAGER');

-- CreateEnum
CREATE TYPE "CalendarScope" AS ENUM ('ALL', 'DEPARTMENT', 'TEAM');

-- AlterEnum
ALTER TYPE "WorkflowSubject" ADD VALUE 'EVENT_EXCEPTION';


-- CreateTable
CREATE TABLE "InternalEventCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalEventCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalEventSeries" (
    "id" TEXT NOT NULL,
    "freq" "RecurrenceFreq" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "byWeekdays" INTEGER[],
    "untilDate" DATE NOT NULL,
    "rule" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalEventSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalEvent" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT,
    "isException" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "localDate" DATE NOT NULL,
    "localEndDate" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "locationType" "EventLocationType" NOT NULL,
    "locationDetail" TEXT,
    "meetingUrl" TEXT,
    "organizerId" TEXT NOT NULL,
    "attendanceRequirement" "EventAttendance" NOT NULL,
    "wfoRequirement" "EventWfoRequirement" NOT NULL,
    "reminderMinutes" INTEGER[],
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "cancelReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalEventAssignmentRule" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "assignmentType" "EventAssignmentType" NOT NULL,
    "targetId" TEXT,
    "dynamicMembership" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InternalEventAssignmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalEventParticipant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignmentSource" "EventAssignmentType" NOT NULL,
    "attendanceStatus" "EventParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalEventParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalCalendarPermission" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "teamId" TEXT,
    "appRole" "Role",
    "permissionRole" "CalendarRole" NOT NULL,
    "scope" "CalendarScope" NOT NULL DEFAULT 'ALL',
    "scopeId" TEXT,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalCalendarPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalEventAuditLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedById" TEXT,
    "previousValues" JSONB,
    "newValues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalEventAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalEventConflictException" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalEventConflictException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InternalEventCategory_name_key" ON "InternalEventCategory"("name");

-- CreateIndex
CREATE INDEX "InternalEvent_localDate_status_idx" ON "InternalEvent"("localDate", "status");

-- CreateIndex
CREATE INDEX "InternalEvent_seriesId_startAt_idx" ON "InternalEvent"("seriesId", "startAt");

-- CreateIndex
CREATE INDEX "InternalEvent_organizerId_idx" ON "InternalEvent"("organizerId");

-- CreateIndex
CREATE INDEX "InternalEventAssignmentRule_eventId_idx" ON "InternalEventAssignmentRule"("eventId");

-- CreateIndex
CREATE INDEX "InternalEventParticipant_employeeId_idx" ON "InternalEventParticipant"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalEventParticipant_eventId_employeeId_key" ON "InternalEventParticipant"("eventId", "employeeId");

-- CreateIndex
CREATE INDEX "InternalCalendarPermission_employeeId_idx" ON "InternalCalendarPermission"("employeeId");

-- CreateIndex
CREATE INDEX "InternalCalendarPermission_teamId_idx" ON "InternalCalendarPermission"("teamId");

-- CreateIndex
CREATE INDEX "InternalEventAuditLog_eventId_createdAt_idx" ON "InternalEventAuditLog"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "InternalEventConflictException_employeeId_date_idx" ON "InternalEventConflictException"("employeeId", "date");

-- CreateIndex
CREATE INDEX "InternalEventConflictException_eventId_idx" ON "InternalEventConflictException"("eventId");

-- AddForeignKey
ALTER TABLE "InternalEvent" ADD CONSTRAINT "InternalEvent_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "InternalEventSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEvent" ADD CONSTRAINT "InternalEvent_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "InternalEventCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEvent" ADD CONSTRAINT "InternalEvent_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEvent" ADD CONSTRAINT "InternalEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEvent" ADD CONSTRAINT "InternalEvent_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEventAssignmentRule" ADD CONSTRAINT "InternalEventAssignmentRule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InternalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEventParticipant" ADD CONSTRAINT "InternalEventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InternalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEventParticipant" ADD CONSTRAINT "InternalEventParticipant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalCalendarPermission" ADD CONSTRAINT "InternalCalendarPermission_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalCalendarPermission" ADD CONSTRAINT "InternalCalendarPermission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalCalendarPermission" ADD CONSTRAINT "InternalCalendarPermission_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEventAuditLog" ADD CONSTRAINT "InternalEventAuditLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InternalEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEventAuditLog" ADD CONSTRAINT "InternalEventAuditLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEventConflictException" ADD CONSTRAINT "InternalEventConflictException_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "InternalEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalEventConflictException" ADD CONSTRAINT "InternalEventConflictException_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───────── Integrity rules ─────────
ALTER TABLE "InternalEvent" ADD CONSTRAINT "InternalEvent_time_order" CHECK ("endAt" > "startAt");
ALTER TABLE "InternalCalendarPermission" ADD CONSTRAINT "InternalCalendarPermission_one_subject"
  CHECK ((("employeeId" IS NOT NULL)::int + ("teamId" IS NOT NULL)::int + ("appRole" IS NOT NULL)::int) = 1);
ALTER TABLE "InternalCalendarPermission" ADD CONSTRAINT "InternalCalendarPermission_scope_target"
  CHECK (("scope" = 'ALL' AND "scopeId" IS NULL) OR ("scope" <> 'ALL' AND "scopeId" IS NOT NULL));
CREATE UNIQUE INDEX "InternalEventAssignmentRule_unique_target" ON "InternalEventAssignmentRule" ("eventId", "assignmentType", COALESCE("targetId", ''));

CREATE TRIGGER "InternalEventAuditLog_append_only" BEFORE UPDATE OR DELETE ON "InternalEventAuditLog"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Default event categories (configurable in Settings → Departments & teams → Internal calendar)
INSERT INTO "InternalEventCategory" ("id", "name", "color", "sortOrder", "updatedAt") VALUES
  ('cat_ld',       'Learning & Development', '#1f63ee', 1, CURRENT_TIMESTAMP),
  ('cat_meeting',  'Internal Meeting',       '#0f766e', 2, CURRENT_TIMESTAMP),
  ('cat_team',     'Team Alignment',         '#7c3aed', 3, CURRENT_TIMESTAMP),
  ('cat_workshop', 'Workshop / Training',    '#d97706', 4, CURRENT_TIMESTAMP),
  ('cat_company',  'Company Event',          '#db2777', 5, CURRENT_TIMESTAMP),
  ('cat_other',    'Other',                  '#64748b', 6, CURRENT_TIMESTAMP);
