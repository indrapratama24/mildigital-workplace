-- Rich content assets (images/files inside Company Hub content) and employee nickname.
ALTER TABLE "StoredFile" ADD COLUMN "isContentAsset" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Employee" ADD COLUMN "nickname" TEXT;
