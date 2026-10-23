-- DropIndex

-- AlterTable
ALTER TABLE "ClientTeamAssignment" ADD COLUMN     "adAccountTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

