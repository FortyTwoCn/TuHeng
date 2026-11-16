CREATE TABLE "UserNotification" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "assignmentId" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "revision" INTEGER NOT NULL, "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "UserNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON UPDATE CASCADE ON DELETE RESTRICT,
 CONSTRAINT "UserNotification_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "UserNotification_userId_assignmentId_kind_revision_key" ON "UserNotification"("userId", "assignmentId", "kind", "revision");
CREATE INDEX "UserNotification_userId_readAt_createdAt_idx" ON "UserNotification"("userId", "readAt", "createdAt");
