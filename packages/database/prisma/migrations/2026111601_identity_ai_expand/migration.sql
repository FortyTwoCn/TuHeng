-- DropForeignKey
ALTER TABLE "Assignment" DROP CONSTRAINT "Assignment_classId_fkey";

-- DropForeignKey
ALTER TABLE "GradingRun" DROP CONSTRAINT "GradingRun_configId_fkey";

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "credentialVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailNormalized" TEXT,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "installationComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'STUDENT',
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "loginId" TEXT,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordExpiresAt" TIMESTAMP(3),
ADD COLUMN     "realm" TEXT NOT NULL DEFAULT 'STUDENT',
ADD COLUMN     "schoolId" TEXT,
ADD COLUMN     "studentNumber" TEXT;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "schoolId" TEXT;

-- AlterTable
ALTER TABLE "TeachingClass" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "schoolId" TEXT;

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "audience" JSONB,
ADD COLUMN     "audienceRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "schoolId" TEXT,
ALTER COLUMN "classId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "GradingRun" ALTER COLUMN "configId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rosterVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentitySequence" (
    "id" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IdentitySequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationChallenge" (
    "id" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "targetEmail" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityThrottle" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityThrottle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reauthentication" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reauthentication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecretRecord" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "suffix" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SMTPConfigurationVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "secretId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SMTPConfigurationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT,
    "smtpId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialDeliveryBatch" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "schoolId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialDeliveryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialDeliveryItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "credentialVersion" INTEGER NOT NULL,
    "secretId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CredentialDeliveryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CredentialDownload" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "CredentialDownload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterImportBatch" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "rosterVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "result" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RosterImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentRecipient" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classIds" TEXT[],
    "reviewerIds" TEXT[],
    "revision" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "inferred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIProviderVersion" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "secretId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIProviderVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIModel" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIModelVersion" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "testStatus" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AITaskBindingVersion" (
    "id" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "modelId" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AITaskBindingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInvocation" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "taskKey" TEXT NOT NULL,
    "schoolId" TEXT,
    "actorId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "snapshot" JSONB,
    "status" TEXT NOT NULL DEFAULT 'BLOCKED_CONFIG',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "billingUncertain" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "School_code_key" ON "School"("code");

-- CreateIndex
CREATE INDEX "VerificationChallenge_realm_purpose_accountId_createdAt_idx" ON "VerificationChallenge"("realm", "purpose", "accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SMTPConfigurationVersion_version_key" ON "SMTPConfigurationVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_challengeId_key" ON "EmailDelivery"("challengeId");

-- CreateIndex
CREATE UNIQUE INDEX "CredentialDeliveryItem_batchId_accountId_key" ON "CredentialDeliveryItem"("batchId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterImportBatch_creatorId_schoolId_fingerprint_key" ON "RosterImportBatch"("creatorId", "schoolId", "fingerprint");

-- CreateIndex
CREATE INDEX "AssignmentRecipient_studentId_active_idx" ON "AssignmentRecipient"("studentId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentRecipient_assignmentId_studentId_key" ON "AssignmentRecipient"("assignmentId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AIProviderVersion_providerId_version_key" ON "AIProviderVersion"("providerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AIModelVersion_modelId_version_key" ON "AIModelVersion"("modelId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AITaskBindingVersion_taskKey_version_key" ON "AITaskBindingVersion"("taskKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AIInvocation_runId_key" ON "AIInvocation"("runId");

-- CreateIndex
CREATE INDEX "AIInvocation_taskKey_schoolId_status_idx" ON "AIInvocation"("taskKey", "schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");

-- CreateIndex
CREATE INDEX "User_schoolId_kind_active_idx" ON "User"("schoolId", "kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "User_realm_emailNormalized_key" ON "User"("realm", "emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "User_schoolId_studentNumber_key" ON "User"("schoolId", "studentNumber");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "TeachingClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingRun" ADD CONSTRAINT "GradingRun_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ModelConfigurationVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialDeliveryItem" ADD CONSTRAINT "CredentialDeliveryItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CredentialDeliveryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIProviderVersion" ADD CONSTRAINT "AIProviderVersion_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AIProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIModel" ADD CONSTRAINT "AIModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "AIProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIModelVersion" ADD CONSTRAINT "AIModelVersion_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "AIModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve legacy IDs; ambiguous role assignments need an explicit mapping, never a guess.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE cardinality(roles) <> 1 OR roles[1] NOT IN ('ADMIN','TEACHER','STUDENT')) THEN
    RAISE EXCEPTION 'IDENTITY_ROLE_MAPPING_REQUIRED: run identity-audit and supply an explicit mapping';
  END IF;
END $$;
UPDATE "User" SET kind = CASE roles[1] WHEN 'ADMIN' THEN 'SITE_ADMIN' ELSE roles[1] END,
  realm = CASE roles[1] WHEN 'STUDENT' THEN 'STUDENT' ELSE 'STAFF' END,
  "loginId" = CASE roles[1] WHEN 'ADMIN' THEN 'admin' ELSE NULL END,
  "tokenVersion" = "tokenVersion" + 1;
CREATE UNIQUE INDEX "User_loginId_casefold" ON "User" (lower("loginId")) WHERE "loginId" IS NOT NULL;
CREATE UNIQUE INDEX "User_single_root" ON "User" (kind) WHERE kind = 'SITE_ADMIN';
ALTER TABLE "User" ADD CONSTRAINT "User_kind_realm" CHECK ((kind = 'STUDENT' AND realm = 'STUDENT') OR (kind IN ('SITE_ADMIN','SCHOOL_ADMIN','TEACHER') AND realm = 'STAFF'));
ALTER TABLE "User" ADD CONSTRAINT "User_root_login" CHECK ((kind = 'SITE_ADMIN' AND "loginId" = 'admin') OR (kind <> 'SITE_ADMIN' AND ("loginId" IS NULL OR lower("loginId") <> 'admin')));
ALTER TABLE "User" ADD CONSTRAINT "User_verified_email" CHECK (("emailNormalized" IS NULL AND "emailVerifiedAt" IS NULL) OR ("emailNormalized" IS NOT NULL AND "emailVerifiedAt" IS NOT NULL));
ALTER TABLE "AssignmentRecipient" ADD CONSTRAINT "recipient_assignment_fk" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"(id);
ALTER TABLE "AssignmentRecipient" ADD CONSTRAINT "recipient_student_fk" FOREIGN KEY ("studentId") REFERENCES "User"(id);
ALTER TABLE "AssignmentRecipient" ADD CONSTRAINT "recipient_school_fk" FOREIGN KEY ("schoolId") REFERENCES "School"(id);
ALTER TABLE "VerificationChallenge" ADD CONSTRAINT "challenge_account_fk" FOREIGN KEY ("accountId") REFERENCES "User"(id);
ALTER TABLE "CredentialDeliveryItem" ADD CONSTRAINT "credential_account_fk" FOREIGN KEY ("accountId") REFERENCES "User"(id);
ALTER TABLE "CredentialDeliveryItem" ADD CONSTRAINT "credential_secret_fk" FOREIGN KEY ("secretId") REFERENCES "SecretRecord"(id);
ALTER TABLE "AIInvocation" ADD CONSTRAINT "invocation_run_fk" FOREIGN KEY ("runId") REFERENCES "GradingRun"(id);
