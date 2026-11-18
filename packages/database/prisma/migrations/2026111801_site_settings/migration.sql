CREATE TABLE "SiteConfigurationVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "filingNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteConfigurationVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SiteConfigurationVersion_version_positive" CHECK ("version" > 0),
    CONSTRAINT "SiteConfigurationVersion_filing_length" CHECK (char_length("filingNumber") <= 120)
);

CREATE UNIQUE INDEX "SiteConfigurationVersion_version_key" ON "SiteConfigurationVersion"("version");
