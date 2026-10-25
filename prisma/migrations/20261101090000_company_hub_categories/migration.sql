-- AlterTable
ALTER TABLE "CompanyContentSection" ADD COLUMN     "categoryId" TEXT;

-- CreateTable
CREATE TABLE "CompanyHubCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyHubCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyHubCategory_slug_key" ON "CompanyHubCategory"("slug");

-- CreateIndex
CREATE INDEX "CompanyContentSection_categoryId_idx" ON "CompanyContentSection"("categoryId");

-- AddForeignKey
ALTER TABLE "CompanyContentSection" ADD CONSTRAINT "CompanyContentSection_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CompanyHubCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
