-- Session-scoped inventory. The script compares the entire old asset table
-- against its declared development owner layout before using this plan.
CREATE TEMP TABLE reset_assets ON COMMIT DROP AS SELECT id, "objectKey" FROM "StoredAsset";
ALTER TABLE reset_assets ADD PRIMARY KEY (id);

CREATE TEMP TABLE reset_versions ON COMMIT DROP AS
SELECT DISTINCT v.id FROM "QuestionVersion" v
WHERE EXISTS (
  SELECT 1 FROM reset_assets a
  WHERE a.id = ANY(v."assetIds") OR v.reference->'assetIds' @> jsonb_build_array(a.id)
);
ALTER TABLE reset_versions ADD PRIMARY KEY (id);

CREATE TEMP TABLE reset_assignments ON COMMIT DROP AS
SELECT DISTINCT i."assignmentId" AS id FROM "AssignmentItem" i
JOIN reset_versions v ON v.id = i."questionVersionId";

CREATE TEMP TABLE reset_sets ON COMMIT DROP AS
SELECT DISTINCT i."setId" AS id FROM "SelfTestItem" i
JOIN reset_versions v ON v.id = i."questionVersionId";

CREATE TEMP TABLE reset_submissions ON COMMIT DROP AS
SELECT s.id FROM "Submission" s JOIN "AssignmentItem" i ON i.id = s."itemId"
JOIN reset_assignments a ON a.id = i."assignmentId";

CREATE TEMP TABLE reset_attempts ON COMMIT DROP AS
WITH RECURSIVE seeds AS (
  SELECT a.id FROM "SubmissionAttempt" a
  WHERE a."questionVersionId" IN (SELECT id FROM reset_versions)
    OR a."submissionId" IN (SELECT id FROM reset_submissions)
    OR a."selfTestItemId" IN (SELECT id FROM "SelfTestItem" WHERE "setId" IN (SELECT id FROM reset_sets))
  UNION
  SELECT "attemptId" FROM "SubmissionAsset" WHERE "assetId" IN (SELECT id FROM reset_assets)
  UNION
  SELECT "attemptId" FROM "GradeDecision" d WHERE EXISTS (
    SELECT 1 FROM reset_assets k WHERE d.annotations @> jsonb_build_array(jsonb_build_object('assetId', k.id))
  )
  UNION
  SELECT r."attemptId" FROM "GradingRun" r LEFT JOIN "GradingSuggestion" g ON g."runId" = r.id
  WHERE EXISTS (
    SELECT 1 FROM reset_assets k
    WHERE r.request->'question'->'assets' @> jsonb_build_array(jsonb_build_object('id', k.id))
       OR r.request->'reference'->'assets' @> jsonb_build_array(jsonb_build_object('id', k.id))
       OR r.request->'submissionAssets' @> jsonb_build_array(jsonb_build_object('id', k.id))
       OR g."processedAssets" @> jsonb_build_array(jsonb_build_object('processedId', k.id))
       OR g."processedAssets" @> jsonb_build_array(jsonb_build_object('originalId', k.id))
  )
), affected AS (
  SELECT id FROM seeds
  UNION
  SELECT r."attemptId" FROM affected a JOIN "ErrorBookEntry" e ON e."attemptId" = a.id
  JOIN "ReviewAttempt" r ON r."entryId" = e.id
)
SELECT id FROM affected;
ALTER TABLE reset_attempts ADD PRIMARY KEY (id);

CREATE TEMP TABLE reset_runs ON COMMIT DROP AS
SELECT r.id, coalesce(j.lane, o.lane, CASE WHEN a.source = 'ASSIGNMENT' THEN 'formal' ELSE 'selftest' END) lane
FROM "GradingRun" r JOIN "SubmissionAttempt" a ON a.id = r."attemptId"
JOIN reset_attempts affected ON affected.id = a.id
LEFT JOIN "BackgroundJob" j ON j."runId" = r.id LEFT JOIN "OutboxEvent" o ON o."runId" = r.id;
