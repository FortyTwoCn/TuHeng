-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseOffering" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "term" TEXT NOT NULL,

    CONSTRAINT "CourseOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingClass" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "TeachingClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,

    CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,

    CONSTRAINT "TeachingGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePoint" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,

    CONSTRAINT "KnowledgePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "courseId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,
    "maxPoints" INTEGER NOT NULL,
    "knowledgeIds" TEXT[],
    "assetIds" TEXT[],
    "reference" JSONB NOT NULL,
    "rubric" JSONB NOT NULL,
    "analysis" JSONB,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "allowLate" BOOLEAN NOT NULL DEFAULT false,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "releaseAnswers" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentItem" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "AssignmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "draftAssetIds" TEXT[],

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionAttempt" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "submissionId" TEXT,
    "questionVersionId" TEXT NOT NULL,
    "selfTestItemId" TEXT,
    "version" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedDecisionId" TEXT,

    CONSTRAINT "SubmissionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionAsset" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "SubmissionAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "purpose" TEXT NOT NULL,
    "parentId" TEXT,
    "transform" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelConfigurationVersion" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "outputMode" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL,
    "concurrency" INTEGER NOT NULL,
    "keyEnv" TEXT NOT NULL DEFAULT 'AI_API_KEY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelConfigurationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingRun" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "strategyVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "errorCode" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradingSuggestion" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "processedAssets" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradingSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeDecision" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "items" JSONB NOT NULL,
    "feedback" TEXT NOT NULL,
    "annotations" JSONB NOT NULL,
    "aiIncorrect" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfTestFolder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "SelfTestFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfTestSet" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "folderId" TEXT,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfTestSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfTestItem" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "SelfTestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorBookEntry" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "questionVersionId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorBookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAttempt" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,

    CONSTRAINT "ReviewAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeEvidence" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "knowledgeId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "earned" INTEGER NOT NULL,
    "possible" INTEGER NOT NULL,
    "evidence" TEXT NOT NULL,

    CONSTRAINT "KnowledgeEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "id" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_active_idx" ON "User"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Course_code_key" ON "Course"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CourseOffering_courseId_term_key" ON "CourseOffering"("courseId", "term");

-- CreateIndex
CREATE INDEX "TeachingClass_offeringId_idx" ON "TeachingClass"("offeringId");

-- CreateIndex
CREATE INDEX "Enrollment_classId_idx" ON "Enrollment"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "Enrollment_userId_classId_key" ON "Enrollment"("userId", "classId");

-- CreateIndex
CREATE INDEX "TeachingGrant_classId_idx" ON "TeachingGrant"("classId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingGrant_userId_classId_key" ON "TeachingGrant"("userId", "classId");

-- CreateIndex
CREATE INDEX "Question_ownerId_active_idx" ON "Question"("ownerId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE INDEX "Assignment_classId_status_dueAt_idx" ON "Assignment"("classId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentItem_assignmentId_position_key" ON "AssignmentItem"("assignmentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_userId_itemId_key" ON "Submission"("userId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionAttempt_publishedDecisionId_key" ON "SubmissionAttempt"("publishedDecisionId");

-- CreateIndex
CREATE INDEX "SubmissionAttempt_ownerId_submittedAt_idx" ON "SubmissionAttempt"("ownerId", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionAttempt_ownerId_idempotencyKey_key" ON "SubmissionAttempt"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionAttempt_submissionId_version_key" ON "SubmissionAttempt"("submissionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionAsset_attemptId_position_key" ON "SubmissionAsset"("attemptId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "StoredAsset_objectKey_key" ON "StoredAsset"("objectKey");

-- CreateIndex
CREATE INDEX "StoredAsset_ownerId_createdAt_idx" ON "StoredAsset"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "GradingRun_status_leaseUntil_idx" ON "GradingRun"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "GradingRun_attemptId_createdAt_idx" ON "GradingRun"("attemptId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GradingSuggestion_runId_key" ON "GradingSuggestion"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeDecision_attemptId_revision_key" ON "GradeDecision"("attemptId", "revision");

-- CreateIndex
CREATE INDEX "Appeal_status_attemptId_idx" ON "Appeal"("status", "attemptId");

-- CreateIndex
CREATE INDEX "SelfTestFolder_ownerId_idx" ON "SelfTestFolder"("ownerId");

-- CreateIndex
CREATE INDEX "SelfTestSet_ownerId_idx" ON "SelfTestSet"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfTestItem_setId_position_key" ON "SelfTestItem"("setId", "position");

-- CreateIndex
CREATE INDEX "ErrorBookEntry_ownerId_archived_idx" ON "ErrorBookEntry"("ownerId", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorBookEntry_ownerId_attemptId_key" ON "ErrorBookEntry"("ownerId", "attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewAttempt_attemptId_key" ON "ReviewAttempt"("attemptId");

-- CreateIndex
CREATE INDEX "KnowledgeEvidence_ownerId_knowledgeId_idx" ON "KnowledgeEvidence"("ownerId", "knowledgeId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeEvidence_decisionId_knowledgeId_key" ON "KnowledgeEvidence"("decisionId", "knowledgeId");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJob_runId_key" ON "BackgroundJob"("runId");

-- CreateIndex
CREATE INDEX "BackgroundJob_status_updatedAt_idx" ON "BackgroundJob"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_runId_key" ON "OutboxEvent"("runId");

-- CreateIndex
CREATE INDEX "OutboxEvent_deliveredAt_createdAt_idx" ON "OutboxEvent"("deliveredAt", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingClass" ADD CONSTRAINT "TeachingClass_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "CourseOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "TeachingClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingGrant" ADD CONSTRAINT "TeachingGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingGrant" ADD CONSTRAINT "TeachingGrant_classId_fkey" FOREIGN KEY ("classId") REFERENCES "TeachingClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "TeachingClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentItem" ADD CONSTRAINT "AssignmentItem_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentItem" ADD CONSTRAINT "AssignmentItem_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "AssignmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_selfTestItemId_fkey" FOREIGN KEY ("selfTestItemId") REFERENCES "SelfTestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_publishedDecisionId_fkey" FOREIGN KEY ("publishedDecisionId") REFERENCES "GradeDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAsset" ADD CONSTRAINT "SubmissionAsset_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "SubmissionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAsset" ADD CONSTRAINT "SubmissionAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StoredAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredAsset" ADD CONSTRAINT "StoredAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingRun" ADD CONSTRAINT "GradingRun_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "SubmissionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingRun" ADD CONSTRAINT "GradingRun_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ModelConfigurationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingSuggestion" ADD CONSTRAINT "GradingSuggestion_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GradingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeDecision" ADD CONSTRAINT "GradeDecision_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "SubmissionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeDecision" ADD CONSTRAINT "GradeDecision_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "SubmissionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfTestFolder" ADD CONSTRAINT "SelfTestFolder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfTestSet" ADD CONSTRAINT "SelfTestSet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfTestSet" ADD CONSTRAINT "SelfTestSet_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "SelfTestFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfTestItem" ADD CONSTRAINT "SelfTestItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "SelfTestSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfTestItem" ADD CONSTRAINT "SelfTestItem_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorBookEntry" ADD CONSTRAINT "ErrorBookEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorBookEntry" ADD CONSTRAINT "ErrorBookEntry_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorBookEntry" ADD CONSTRAINT "ErrorBookEntry_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "SubmissionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAttempt" ADD CONSTRAINT "ReviewAttempt_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ErrorBookEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAttempt" ADD CONSTRAINT "ReviewAttempt_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "SubmissionAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "KnowledgePoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEvidence" ADD CONSTRAINT "KnowledgeEvidence_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "GradeDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackgroundJob" ADD CONSTRAINT "BackgroundJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "GradingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

