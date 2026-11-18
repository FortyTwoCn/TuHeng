ALTER TABLE "Course" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CourseOffering" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Course_schoolId_title_idx" ON "Course" ("schoolId","title");
