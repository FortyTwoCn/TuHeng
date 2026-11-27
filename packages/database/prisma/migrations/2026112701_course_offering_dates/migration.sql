ALTER TABLE "CourseOffering"
  ADD COLUMN "startsAt" TIMESTAMP(3),
  ADD COLUMN "endsAt" TIMESTAMP(3);

WITH starts AS (
  SELECT o.id, COALESCE(MIN(c."createdAt"), CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS start_at
  FROM "CourseOffering" o
  LEFT JOIN "TeachingClass" c ON c."offeringId" = o.id
  GROUP BY o.id
)
UPDATE "CourseOffering" o
SET "startsAt" = starts.start_at,
    "endsAt" = starts.start_at + INTERVAL '6 months'
FROM starts WHERE o.id = starts.id;

ALTER TABLE "CourseOffering"
  ALTER COLUMN "startsAt" SET NOT NULL,
  ALTER COLUMN "endsAt" SET NOT NULL,
  ADD CONSTRAINT "CourseOffering_valid_term_range" CHECK ("startsAt" < "endsAt");
