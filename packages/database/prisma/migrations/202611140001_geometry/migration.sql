ALTER TABLE "QuestionVersion" ADD COLUMN "geometryDocument" JSONB;
ALTER TABLE "Submission" ADD COLUMN "draftGeometry" JSONB;
ALTER TABLE "SubmissionAttempt" ADD COLUMN "geometryAnswer" JSONB;
ALTER TABLE "SubmissionAttempt" ADD COLUMN "geometrySchemaVersion" TEXT;
