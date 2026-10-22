-- AlterTable
ALTER TABLE "ClientBrand" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "industryId" TEXT,
ADD COLUMN     "picEmail" TEXT,
ADD COLUMN     "picPhone" TEXT,
ADD COLUMN     "subIndustryId" TEXT;

-- CreateTable
CREATE TABLE "ClientCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientIndustry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientIndustry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSubIndustry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientSubIndustry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAdAccountType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientAdAccountType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBrandAdAccount" (
    "brandId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientBrandAdAccount_pkey" PRIMARY KEY ("brandId","typeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientCategory_name_key" ON "ClientCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ClientIndustry_categoryId_name_key" ON "ClientIndustry"("categoryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSubIndustry_industryId_name_key" ON "ClientSubIndustry"("industryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAdAccountType_name_key" ON "ClientAdAccountType"("name");

-- CreateIndex
CREATE INDEX "ClientBrandAdAccount_typeId_idx" ON "ClientBrandAdAccount"("typeId");

-- AddForeignKey
ALTER TABLE "ClientIndustry" ADD CONSTRAINT "ClientIndustry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ClientCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubIndustry" ADD CONSTRAINT "ClientSubIndustry_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "ClientIndustry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBrandAdAccount" ADD CONSTRAINT "ClientBrandAdAccount_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ClientBrand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBrandAdAccount" ADD CONSTRAINT "ClientBrandAdAccount_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "ClientAdAccountType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBrand" ADD CONSTRAINT "ClientBrand_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ClientCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBrand" ADD CONSTRAINT "ClientBrand_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "ClientIndustry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientBrand" ADD CONSTRAINT "ClientBrand_subIndustryId_fkey" FOREIGN KEY ("subIndustryId") REFERENCES "ClientSubIndustry"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ── Defaults ──
INSERT INTO "ClientCategory" ("id", "name", "sortOrder") VALUES
  ('ccat_retail_fashion', 'Retail-Fashion', 1),
  ('ccat_retail_nonfashion', 'Retail-Non Fashion', 2),
  ('ccat_b2b', 'B2B & Services', 3),
  ('ccat_fnb', 'F&B', 4)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "ClientAdAccountType" ("id", "name", "sortOrder") VALUES
  ('cad_meta_regular', 'Meta Regular', 1),
  ('cad_meta_cpas_shopee', 'Meta CPAS Shopee', 2),
  ('cad_iklanku_shopee', 'Iklanku Shopee', 3),
  ('cad_gmv_max_tiktok', 'GMV Max TikTok', 4),
  ('cad_ttam', 'TTAM', 5)
ON CONFLICT ("name") DO NOTHING;

-- ── Move existing data ──
-- Free-text industries become (uncategorised) Industry records; F&B industries go under the F&B category.
INSERT INTO "ClientIndustry" ("id", "name", "categoryId")
SELECT 'cind_' || md5(lower(trim(b."industry"))), min(trim(b."industry")), CASE WHEN lower(trim(b."industry")) IN ('f&b', 'fnb', 'food & beverage') THEN 'ccat_fnb' ELSE NULL END
FROM "ClientBrand" b
WHERE b."industry" IS NOT NULL AND trim(b."industry") <> ''
GROUP BY lower(trim(b."industry"));

UPDATE "ClientBrand" b SET "industryId" = 'cind_' || md5(lower(trim(b."industry")))
WHERE b."industry" IS NOT NULL AND trim(b."industry") <> '';
UPDATE "ClientBrand" b SET "categoryId" = i."categoryId" FROM "ClientIndustry" i WHERE b."industryId" = i."id" AND i."categoryId" IS NOT NULL;

-- PIC contact splits into email (contains @) or phone.
UPDATE "ClientBrand" SET "picEmail" = trim("picContact") WHERE "picContact" LIKE '%@%';
UPDATE "ClientBrand" SET "picPhone" = trim("picContact") WHERE "picContact" IS NOT NULL AND "picContact" NOT LIKE '%@%' AND trim("picContact") <> '';

ALTER TABLE "ClientBrand" DROP COLUMN "industry", DROP COLUMN "picContact";

CREATE INDEX "ClientBrand_categoryId_idx" ON "ClientBrand"("categoryId");
CREATE INDEX "ClientBrand_industryId_idx" ON "ClientBrand"("industryId");
