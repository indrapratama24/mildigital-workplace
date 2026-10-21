-- People data: personal, contact, identity, bank and family/tax details (sensitive fields encrypted by the app).
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED');

CREATE TABLE "EmployeePersonalData" (
    "employeeId" TEXT NOT NULL,
    "birthDate" DATE,
    "birthPlace" TEXT,
    "phone" TEXT,
    "personalEmail" TEXT,
    "addressKtp" TEXT,
    "addressDomicile" TEXT,
    "nikEncrypted" TEXT,
    "nikLast4" TEXT,
    "nikHash" TEXT,
    "npwpEncrypted" TEXT,
    "npwpLast4" TEXT,
    "bankName" TEXT,
    "bankAccountEncrypted" TEXT,
    "bankAccountLast4" TEXT,
    "bankAccountHolder" TEXT,
    "maritalStatus" "MaritalStatus",
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "emergencyContactName" TEXT,
    "emergencyContactRelation" TEXT,
    "emergencyContactPhone" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeePersonalData_pkey" PRIMARY KEY ("employeeId"),
    CONSTRAINT "EmployeePersonalData_dependents_range" CHECK ("dependents" BETWEEN 0 AND 10)
);
CREATE UNIQUE INDEX "EmployeePersonalData_nikHash_key" ON "EmployeePersonalData"("nikHash");
ALTER TABLE "EmployeePersonalData" ADD CONSTRAINT "EmployeePersonalData_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
