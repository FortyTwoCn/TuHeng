ALTER TABLE "VerificationChallenge" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT -1;
-- A pre-cutover code has no verified session version; require a fresh challenge.
UPDATE "VerificationChallenge" SET "revokedAt" = now() WHERE "consumedAt" IS NULL AND "revokedAt" IS NULL;
