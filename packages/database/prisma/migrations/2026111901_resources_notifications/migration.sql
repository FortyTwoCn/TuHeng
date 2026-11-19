-- Run the development resource cutover before changing the asset contract.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "StoredAsset") THEN
    RAISE EXCEPTION 'RESOURCE_CUTOVER_REQUIRED: review and run dev:reset-resources before this migration';
  END IF;
END $$;

-- Existing notifications are intentionally cleared at the development cutover.
DELETE FROM "UserNotification";
ALTER TABLE "UserNotification" DROP CONSTRAINT IF EXISTS "UserNotification_userId_fkey";

-- DropIndex
DROP INDEX "UserNotification_userId_readAt_createdAt_idx";

-- DropIndex
DROP INDEX "UserNotification_userId_assignmentId_kind_revision_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarAssetId" TEXT,
ADD COLUMN     "avatarRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notificationConsent" JSONB,
ADD COLUMN     "notificationPreferences" JSONB;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "schoolId" TEXT,
ADD COLUMN     "selfTest" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SubmissionAttempt" ADD COLUMN     "storageContext" JSONB;

-- AlterTable
ALTER TABLE "StoredAsset" ADD COLUMN     "checksum" TEXT NOT NULL,
ADD COLUMN     "discardAfter" TIMESTAMP(3),
ADD COLUMN     "state" TEXT NOT NULL,
ADD COLUMN     "storageContext" JSONB,
ADD COLUMN     "storageSchoolId" TEXT,
ADD COLUMN     "storageSubjectUserId" TEXT,
ADD COLUMN     "uploadSessionId" TEXT;

-- AlterTable
ALTER TABLE "AssignmentRecipient" ADD COLUMN     "activeSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "UserNotification" DROP COLUMN "assignmentId",
ADD COLUMN     "category" TEXT NOT NULL,
ADD COLUMN     "deadlineAt" TIMESTAMP(3),
ADD COLUMN     "eventKey" TEXT NOT NULL,
ADD COLUMN     "resourceId" TEXT NOT NULL,
ADD COLUMN     "resourceType" TEXT NOT NULL,
ADD COLUMN     "schoolId" TEXT,
ADD COLUMN     "sequence" SERIAL NOT NULL,
ADD COLUMN     "summary" TEXT NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL,
ALTER COLUMN "revision" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AssetUploadSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "schoolId" TEXT,
    "targetSchoolId" TEXT,
    "target" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetUploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetArchiveTask" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceChecksum" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "errorCode" TEXT,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AssetArchiveTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetObjectGarbage" (
    "id" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "deleteAfter" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssetObjectGarbage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "consentVersion" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "sendingAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "schoolId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementRecipient" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,

    CONSTRAINT "AnnouncementRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetUploadSession_expiresAt_idx" ON "AssetUploadSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetArchiveTask_assetId_key" ON "AssetArchiveTask"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetArchiveTask_targetKey_key" ON "AssetArchiveTask"("targetKey");

-- CreateIndex
CREATE INDEX "AssetArchiveTask_state_nextAttemptAt_idx" ON "AssetArchiveTask"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetObjectGarbage_objectKey_key" ON "AssetObjectGarbage"("objectKey");

-- CreateIndex
CREATE INDEX "AssetObjectGarbage_deleteAfter_idx" ON "AssetObjectGarbage"("deleteAfter");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_notificationId_key" ON "NotificationDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_state_nextAttemptAt_idx" ON "NotificationDelivery"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_state_leaseUntil_idx" ON "NotificationDelivery"("state", "leaseUntil");

-- CreateIndex
CREATE INDEX "Announcement_creatorId_createdAt_idx" ON "Announcement"("creatorId", "createdAt");

-- CreateIndex
CREATE INDEX "Announcement_schoolId_publishedAt_idx" ON "Announcement"("schoolId", "publishedAt");

-- CreateIndex
CREATE INDEX "AnnouncementRecipient_userId_announcementId_idx" ON "AnnouncementRecipient"("userId", "announcementId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementRecipient_announcementId_userId_key" ON "AnnouncementRecipient"("announcementId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_avatarAssetId_key" ON "User"("avatarAssetId");

-- CreateIndex
CREATE INDEX "Question_schoolId_active_idx" ON "Question"("schoolId", "active");

-- CreateIndex
CREATE INDEX "Assignment_status_dueAt_idx" ON "Assignment"("status", "dueAt");

-- CreateIndex
CREATE INDEX "SubmissionAsset_assetId_idx" ON "SubmissionAsset"("assetId");

-- CreateIndex
CREATE INDEX "StoredAsset_state_discardAfter_idx" ON "StoredAsset"("state", "discardAfter");

-- CreateIndex
CREATE INDEX "StoredAsset_parentId_idx" ON "StoredAsset"("parentId");

-- CreateIndex
CREATE INDEX "StoredAsset_uploadSessionId_idx" ON "StoredAsset"("uploadSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_sequence_key" ON "UserNotification"("sequence");

-- CreateIndex
CREATE INDEX "UserNotification_userId_sequence_idx" ON "UserNotification"("userId", "sequence");

-- CreateIndex
CREATE INDEX "UserNotification_userId_readAt_sequence_idx" ON "UserNotification"("userId", "readAt", "sequence");

-- CreateIndex
CREATE INDEX "UserNotification_userId_category_sequence_idx" ON "UserNotification"("userId", "category", "sequence");

-- CreateIndex
CREATE INDEX "UserNotification_resourceType_resourceId_kind_deadlineAt_idx" ON "UserNotification"("resourceType", "resourceId", "kind", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserNotification_userId_eventKey_key" ON "UserNotification"("userId", "eventKey");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_avatarAssetId_fkey" FOREIGN KEY ("avatarAssetId") REFERENCES "StoredAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredAsset" ADD CONSTRAINT "StoredAsset_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "StoredAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredAsset" ADD CONSTRAINT "StoredAsset_uploadSessionId_fkey" FOREIGN KEY ("uploadSessionId") REFERENCES "AssetUploadSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetUploadSession" ADD CONSTRAINT "AssetUploadSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetArchiveTask" ADD CONSTRAINT "AssetArchiveTask_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StoredAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotification" ADD CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "UserNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRecipient" ADD CONSTRAINT "AnnouncementRecipient_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementRecipient" ADD CONSTRAINT "AnnouncementRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Snapshot retained text/geometry questions once; later reads use Question.schoolId.
UPDATE "Question" q SET "schoolId" = u."schoolId"
FROM "User" u JOIN "School" s ON s.id = u."schoolId"
WHERE q."ownerId" = u.id AND u.kind <> 'SITE_ADMIN';
UPDATE "Question" q SET "selfTest" = true
WHERE EXISTS (SELECT 1 FROM "QuestionVersion" v JOIN "SelfTestItem" i ON i."questionVersionId" = v.id WHERE v."questionId" = q.id);
UPDATE "AssignmentRecipient" SET "activeSince" = "createdAt";
