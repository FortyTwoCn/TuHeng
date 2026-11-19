DELETE FROM "UserNotification";
DELETE FROM "AIInvocationAttempt" WHERE "invocationId" IN (
  SELECT id FROM "AIInvocation" WHERE "runId" IN (SELECT id FROM reset_runs)
);
DELETE FROM "AIInvocation" WHERE "runId" IN (SELECT id FROM reset_runs);
DELETE FROM "OutboxEvent" WHERE "runId" IN (SELECT id FROM reset_runs);
DELETE FROM "BackgroundJob" WHERE "runId" IN (SELECT id FROM reset_runs);
DELETE FROM "GradingSuggestion" WHERE "runId" IN (SELECT id FROM reset_runs);
DELETE FROM "GradingRun" WHERE id IN (SELECT id FROM reset_runs);
DELETE FROM "Appeal" WHERE "attemptId" IN (SELECT id FROM reset_attempts);
DELETE FROM "ReviewAttempt" WHERE "attemptId" IN (SELECT id FROM reset_attempts) OR "entryId" IN (
  SELECT id FROM "ErrorBookEntry"
  WHERE "attemptId" IN (SELECT id FROM reset_attempts) OR "questionVersionId" IN (SELECT id FROM reset_versions)
);
DELETE FROM "ErrorBookEntry" WHERE "attemptId" IN (SELECT id FROM reset_attempts)
  OR "questionVersionId" IN (SELECT id FROM reset_versions);
DELETE FROM "KnowledgeEvidence" WHERE "decisionId" IN (
  SELECT id FROM "GradeDecision" WHERE "attemptId" IN (SELECT id FROM reset_attempts)
);
UPDATE "SubmissionAttempt" SET "publishedDecisionId" = NULL WHERE id IN (SELECT id FROM reset_attempts);
DELETE FROM "GradeDecision" WHERE "attemptId" IN (SELECT id FROM reset_attempts);
DELETE FROM "SubmissionAsset" WHERE "attemptId" IN (SELECT id FROM reset_attempts);
DELETE FROM "SubmissionAttempt" WHERE id IN (SELECT id FROM reset_attempts);
DELETE FROM "Submission" WHERE id IN (SELECT id FROM reset_submissions);
UPDATE "Submission" s SET "draftAssetIds" = ARRAY(
  SELECT a.id FROM unnest(s."draftAssetIds") WITH ORDINALITY a(id, n)
  WHERE NOT EXISTS (SELECT 1 FROM reset_assets k WHERE k.id = a.id) ORDER BY a.n
)
WHERE s."draftAssetIds" && (SELECT ARRAY(SELECT id FROM reset_assets));
DELETE FROM "AssignmentRecipient" WHERE "assignmentId" IN (SELECT id FROM reset_assignments);
DELETE FROM "AssignmentItem" WHERE "assignmentId" IN (SELECT id FROM reset_assignments);
DELETE FROM "Assignment" WHERE id IN (SELECT id FROM reset_assignments);
DELETE FROM "SelfTestItem" WHERE "setId" IN (SELECT id FROM reset_sets);
DELETE FROM "SelfTestSet" WHERE id IN (SELECT id FROM reset_sets);
CREATE TEMP TABLE reset_question_ids ON COMMIT DROP AS
SELECT DISTINCT "questionId" id FROM "QuestionVersion" WHERE id IN (SELECT id FROM reset_versions);
DELETE FROM "QuestionVersion" WHERE id IN (SELECT id FROM reset_versions);
DELETE FROM "Question" q USING reset_question_ids k
WHERE k.id = q.id AND NOT EXISTS (SELECT 1 FROM "QuestionVersion" v WHERE v."questionId" = q.id);
DELETE FROM "StoredAsset" WHERE id IN (SELECT id FROM reset_assets);
