ALTER TABLE "AIInvocation" ADD COLUMN "estimatedCost" DOUBLE PRECISION, ADD COLUMN "costCurrency" TEXT;
CREATE TABLE "AIInvocationAttempt" (
  "id" TEXT NOT NULL, "invocationId" TEXT NOT NULL, "ordinal" INTEGER NOT NULL,
  "providerId" TEXT NOT NULL, "modelId" TEXT NOT NULL, "status" TEXT NOT NULL,
  "inputTokens" INTEGER, "outputTokens" INTEGER, "durationMs" INTEGER,
  "estimatedCost" DOUBLE PRECISION, "costCurrency" TEXT, "billingUncertain" BOOLEAN NOT NULL DEFAULT false,
  "errorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIInvocationAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AIInvocationAttempt_invocationId_fkey" FOREIGN KEY ("invocationId") REFERENCES "AIInvocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AIInvocationAttempt_invocationId_ordinal_key" ON "AIInvocationAttempt"("invocationId", "ordinal");
CREATE INDEX "AIInvocationAttempt_providerId_createdAt_idx" ON "AIInvocationAttempt"("providerId", "createdAt");
