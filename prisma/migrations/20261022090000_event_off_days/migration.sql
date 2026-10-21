-- Events may opt in to holidays / non-working days; by default they are skipped or cancelled there.
ALTER TABLE "InternalEvent" ADD COLUMN "allowOnOffDays" BOOLEAN NOT NULL DEFAULT false;
