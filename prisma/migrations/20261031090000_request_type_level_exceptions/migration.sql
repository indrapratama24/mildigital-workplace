-- AlterTable
ALTER TABLE "RequestType" ADD COLUMN     "levelExceptions" JSONB NOT NULL DEFAULT '[]';
