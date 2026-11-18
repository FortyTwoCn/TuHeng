import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {
    rows: [summary],
  } = await client.query(`
    SELECT (SELECT count(*) FROM "School") AS schools,
      (SELECT count(*) FROM "Course") AS courses,
      (SELECT count(*) FROM "CourseOffering") AS offerings,
      (SELECT count(*) FROM "TeachingClass") AS classes,
      (SELECT count(*) FROM "Assignment" WHERE status='PUBLISHED' AND COALESCE("audienceRevision",0)=0) AS published_legacy,
      (SELECT count(*) FROM "Assignment" WHERE status='PUBLISHED' AND "audienceRevision">0) AS published_snapshots,
      (SELECT count(*) FROM (SELECT "classId" FROM "TeachingGrant" GROUP BY 1 HAVING count(*)>1) g) AS cotaught_classes`);
  const { rows: issues } = await client.query(`
    WITH catalog AS (SELECT c.id,c."schoolId",s.id AS parent,
      CASE WHEN starts_with(c.code,c."schoolId"||':') THEN substr(c.code,length(c."schoolId")+2) ELSE c.code END AS business
      FROM "Course" c LEFT JOIN "School" s ON s.id=c."schoolId")
    SELECT id,'unresolved-school' AS issue FROM catalog WHERE parent IS NULL
    UNION ALL SELECT c.id,'ambiguous-code' FROM catalog c WHERE EXISTS
      (SELECT 1 FROM catalog x WHERE x."schoolId"=c."schoolId" AND x.business=c.business AND x.id<>c.id)
    UNION ALL SELECT t.id,'class-school-mismatch' FROM "TeachingClass" t JOIN "CourseOffering" o ON o.id=t."offeringId"
      JOIN "Course" c ON c.id=o."courseId" WHERE t."schoolId" IS DISTINCT FROM c."schoolId"`);
  console.log(JSON.stringify({ summary, issues }, null, 2));
  await client.query('COMMIT');
} finally {
  await client.end();
}
