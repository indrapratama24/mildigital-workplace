-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnnouncementPriority" AS ENUM ('NORMAL', 'IMPORTANT', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AudienceType" AS ENUM ('ALL', 'TEAMS', 'LEVELS', 'EMPLOYEES');

-- CreateEnum
CREATE TYPE "RecognitionKind" AS ENUM ('PROMOTION', 'RECOGNITION', 'MILESTONE');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FREEZE');

-- CreateEnum
CREATE TYPE "ClientRole" AS ENUM ('CONSULTANT_PRIMARY', 'CONSULTANT_SECONDARY', 'CONSULTANT_ADDITIONAL', 'ADS_STRATEGIST');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "photoId" TEXT,
ADD COLUMN     "roleDescription" TEXT;

-- CreateTable
CREATE TABLE "PermissionGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "note" TEXT,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyContentSection" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyContentSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyRegulation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" TEXT,
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "publishedVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyRegulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulationVersion" (
    "id" TEXT NOT NULL,
    "regulationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "documentUrl" TEXT,
    "attachmentId" TEXT,
    "changeNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "RegulationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulationAcknowledgement" (
    "id" TEXT NOT NULL,
    "regulationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulationAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "publishAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "audienceType" "AudienceType" NOT NULL DEFAULT 'ALL',
    "linkUrl" TEXT,
    "attachmentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementAudience" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "teamId" TEXT,
    "levelId" TEXT,
    "employeeId" TEXT,

    CONSTRAINT "AnnouncementAudience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeRecognition" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "RecognitionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "date" DATE NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeRecognition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOrganization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBrand" (
    "id" TEXT NOT NULL,
    "clientCode" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL,
    "dateStart" DATE NOT NULL,
    "dateOff" DATE,
    "industry" TEXT,
    "description" TEXT,
    "websiteUrl" TEXT,
    "instagramUrl" TEXT,
    "tiktokUrl" TEXT,
    "picName" TEXT,
    "picContact" TEXT,
    "internalNotes" TEXT,
    "primaryConsultantWaived" BOOLEAN NOT NULL DEFAULT false,
    "waiverReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientCodeAlias" (
    "code" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCodeAlias_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ClientEngagement" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientEngagementPackage" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientEngagementPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientStatusHistory" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "fromStatus" "ClientStatus",
    "status" "ClientStatus" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientTeamAssignment" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" "ClientRole" NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "assignedById" TEXT,
    "endedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientTeamAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PermissionGrant_userId_permission_key" ON "PermissionGrant"("userId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyContentSection_key_key" ON "CompanyContentSection"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyRegulation_publishedVersionId_key" ON "CompanyRegulation"("publishedVersionId");

-- CreateIndex
CREATE INDEX "CompanyRegulation_status_category_idx" ON "CompanyRegulation"("status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "RegulationVersion_regulationId_version_key" ON "RegulationVersion"("regulationId", "version");

-- CreateIndex
CREATE INDEX "RegulationAcknowledgement_employeeId_idx" ON "RegulationAcknowledgement"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "RegulationAcknowledgement_versionId_employeeId_key" ON "RegulationAcknowledgement"("versionId", "employeeId");

-- CreateIndex
CREATE INDEX "Announcement_status_publishAt_idx" ON "Announcement"("status", "publishAt");

-- CreateIndex
CREATE INDEX "AnnouncementAudience_announcementId_idx" ON "AnnouncementAudience"("announcementId");

-- CreateIndex
CREATE INDEX "EmployeeRecognition_status_date_idx" ON "EmployeeRecognition"("status", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPackage_name_key" ON "ClientPackage"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ClientOrganization_name_key" ON "ClientOrganization"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ClientBrand_clientCode_key" ON "ClientBrand"("clientCode");

-- CreateIndex
CREATE INDEX "ClientBrand_status_idx" ON "ClientBrand"("status");

-- CreateIndex
CREATE INDEX "ClientBrand_name_idx" ON "ClientBrand"("name");

-- CreateIndex
CREATE INDEX "ClientEngagement_brandId_startDate_idx" ON "ClientEngagement"("brandId", "startDate");

-- CreateIndex
CREATE INDEX "ClientEngagementPackage_engagementId_effectiveFrom_idx" ON "ClientEngagementPackage"("engagementId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ClientStatusHistory_brandId_effectiveFrom_idx" ON "ClientStatusHistory"("brandId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ClientStatusHistory_status_effectiveFrom_idx" ON "ClientStatusHistory"("status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ClientTeamAssignment_brandId_effectiveTo_idx" ON "ClientTeamAssignment"("brandId", "effectiveTo");

-- CreateIndex
CREATE INDEX "ClientTeamAssignment_employeeId_effectiveTo_idx" ON "ClientTeamAssignment"("employeeId", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_photoId_key" ON "Employee"("photoId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermissionGrant" ADD CONSTRAINT "PermissionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRegulation" ADD CONSTRAINT "CompanyRegulation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyRegulation" ADD CONSTRAINT "CompanyRegulation_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "RegulationVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulationVersion" ADD CONSTRAINT "RegulationVersion_regulationId_fkey" FOREIGN KEY ("regulationId") REFERENCES "CompanyRegulation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulationVersion" ADD CONSTRAINT "RegulationVersion_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulationAcknowledgement" ADD CONSTRAINT "RegulationAcknowledgement_regulationId_fkey" FOREIGN KEY ("regulationId") REFERENCES "CompanyRegulation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulationAcknowledgement" ADD CONSTRAINT "RegulationAcknowledgement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RegulationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulationAcknowledgement" ADD CONSTRAINT "RegulationAcknowledgement_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAudience" ADD CONSTRAINT "AnnouncementAudience_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAudience" ADD CONSTRAINT "AnnouncementAudience_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAudience" ADD CONSTRAINT "AnnouncementAudience_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "EmployeeLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAudience" ADD CONSTRAINT "AnnouncementAudience_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRecognition" ADD CONSTRAINT "EmployeeRecognition_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRecognition" ADD CONSTRAINT "EmployeeRecognition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBrand" ADD CONSTRAINT "ClientBrand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "ClientOrganization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCodeAlias" ADD CONSTRAINT "ClientCodeAlias_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ClientBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEngagement" ADD CONSTRAINT "ClientEngagement_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ClientBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEngagementPackage" ADD CONSTRAINT "ClientEngagementPackage_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "ClientEngagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEngagementPackage" ADD CONSTRAINT "ClientEngagementPackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ClientPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientStatusHistory" ADD CONSTRAINT "ClientStatusHistory_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ClientBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientStatusHistory" ADD CONSTRAINT "ClientStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTeamAssignment" ADD CONSTRAINT "ClientTeamAssignment_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ClientBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTeamAssignment" ADD CONSTRAINT "ClientTeamAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Workplace Phase 1: guarantees that the services rely on ──

-- Client ID numbers are drawn from a sequence so an ID is never handed out twice.
CREATE SEQUENCE "client_code_seq" START 1;

ALTER TABLE "ClientBrand" ADD CONSTRAINT "ClientBrand_dates" CHECK ("dateOff" IS NULL OR "dateOff" >= "dateStart");
ALTER TABLE "ClientBrand" ADD CONSTRAINT "ClientBrand_inactive_has_date_off" CHECK ("status" <> 'INACTIVE' OR "dateOff" IS NOT NULL);
ALTER TABLE "ClientEngagement" ADD CONSTRAINT "ClientEngagement_dates" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
ALTER TABLE "ClientStatusHistory" ADD CONSTRAINT "ClientStatusHistory_dates" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");
ALTER TABLE "ClientTeamAssignment" ADD CONSTRAINT "ClientTeamAssignment_dates" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- One open status period and one open engagement per brand.
CREATE UNIQUE INDEX "ClientStatusHistory_one_open" ON "ClientStatusHistory"("brandId") WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX "ClientEngagement_one_open" ON "ClientEngagement"("brandId") WHERE "endDate" IS NULL;
CREATE UNIQUE INDEX "ClientEngagementPackage_one_open" ON "ClientEngagementPackage"("engagementId") WHERE "effectiveTo" IS NULL;

-- An employee holds at most one current role per client; one current Consultant 1 and one Consultant 2.
CREATE UNIQUE INDEX "ClientTeamAssignment_one_role_per_employee" ON "ClientTeamAssignment"("brandId", "employeeId") WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX "ClientTeamAssignment_one_primary" ON "ClientTeamAssignment"("brandId") WHERE "effectiveTo" IS NULL AND "role" = 'CONSULTANT_PRIMARY';
CREATE UNIQUE INDEX "ClientTeamAssignment_one_secondary" ON "ClientTeamAssignment"("brandId") WHERE "effectiveTo" IS NULL AND "role" = 'CONSULTANT_SECONDARY';

-- At most three current Ads Strategists per client (also checked in the service with a row lock).
CREATE OR REPLACE FUNCTION client_max_ads_strategists() RETURNS trigger AS $$
BEGIN
  IF NEW."role" = 'ADS_STRATEGIST' AND NEW."effectiveTo" IS NULL AND (
    SELECT count(*) FROM "ClientTeamAssignment"
    WHERE "brandId" = NEW."brandId" AND "role" = 'ADS_STRATEGIST' AND "effectiveTo" IS NULL AND "id" <> NEW."id"
  ) >= 3 THEN
    RAISE EXCEPTION 'A client can have at most 3 Ads Strategists';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ClientTeamAssignment_max_as" BEFORE INSERT OR UPDATE ON "ClientTeamAssignment"
  FOR EACH ROW EXECUTE FUNCTION client_max_ads_strategists();

-- History rows are closed (effectiveTo), never deleted.
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ClientStatusHistory_no_delete" BEFORE DELETE ON "ClientStatusHistory" FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER "ClientTeamAssignment_no_delete" BEFORE DELETE ON "ClientTeamAssignment" FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER "RegulationAcknowledgement_append_only" BEFORE UPDATE OR DELETE ON "RegulationAcknowledgement" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Default content: Company 101 sections (empty bodies; administrators fill them in) and the three packages.
INSERT INTO "CompanyContentSection" ("id", "key", "title", "body", "sortOrder", "updatedAt") VALUES
  ('cs_intro', 'intro', 'Company Introduction', '', 1, now()),
  ('cs_history', 'history', 'Company History', '', 2, now()),
  ('cs_vision', 'vision', 'Vision', '', 3, now()),
  ('cs_mission', 'mission', 'Mission', '', 4, now()),
  ('cs_values', 'values', 'Company Values', '', 5, now()),
  ('cs_principles', 'principles', 'MIL Principles', '', 6, now()),
  ('cs_organization', 'organization', 'Organization Overview', '', 7, now()),
  ('cs_how_we_work', 'how_we_work', 'How We Work', '', 8, now()),
  ('cs_office', 'office', 'Office Information', '', 9, now()),
  ('cs_facilities', 'facilities', 'Facilities & Meeting Rooms', '', 10, now())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "ClientPackage" ("id", "name", "description", "sortOrder", "updatedAt") VALUES
  ('pkg_advance', 'Advance', NULL, 1, now()),
  ('pkg_regular', 'Regular', NULL, 2, now()),
  ('pkg_basic', 'Basic', NULL, 3, now())
ON CONFLICT ("name") DO NOTHING;
