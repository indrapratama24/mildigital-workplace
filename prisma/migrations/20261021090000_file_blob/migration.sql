-- Database-backed private file storage (used on serverless hosting).
CREATE TABLE "FileBlob" (
    "storageKey" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileBlob_pkey" PRIMARY KEY ("storageKey")
);
