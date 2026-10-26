-- CreateEnum
CREATE TYPE "RulePackStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AmendmentKind" AS ENUM ('APH', 'ADDENDUM', 'CORRIGENDUM', 'PUBLIC_NOTICE', 'REVISED_PUBLIC_NOTICE', 'CIRCULAR', 'ACADEMIC_CALENDAR', 'FEE_NOTIFICATION', 'PROTOTYPE_PLACEHOLDER');

-- AlterEnum

ALTER TYPE "Role" ADD VALUE 'RULE_EDITOR';
ALTER TYPE "Role" ADD VALUE 'RULE_APPROVER';

-- AlterTable
ALTER TABLE "Institution" ADD COLUMN     "isTechnical" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'ENGINEERING_COLLEGE';

-- AlterTable
-- Nullable until migrate-from-json back-fills existing rows; prisma/sql/002_rulepack_guard.sql then sets NOT NULL.
ALTER TABLE "Application" ADD COLUMN     "cycleId" TEXT,
ADD COLUMN     "rulePackVersionId" TEXT;

-- AlterTable
-- policyVersion is kept until the back-fill is done; 002_rulepack_guard.sql drops it.
ALTER TABLE "Assignment" ALTER COLUMN "policyVersion" DROP NOT NULL,
ADD COLUMN     "rulePackVersionId" TEXT;

-- AlterTable
ALTER TABLE "EvcVisit" ADD COLUMN     "appointedUnder" TEXT;

-- CreateTable
CREATE TABLE "ApprovalCycle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulePackVersion" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RulePackStatus" NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "rejectedRemarks" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "scheduledPublish" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RulePackVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amendment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "kind" "AmendmentKind" NOT NULL,
    "refNo" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceDocId" TEXT,
    "applyScope" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Amendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalCycle_code_key" ON "ApprovalCycle"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RulePackVersion_cycleId_version_key" ON "RulePackVersion"("cycleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Amendment_versionId_key" ON "Amendment"("versionId");

-- CreateIndex
CREATE INDEX "Application_rulePackVersionId_idx" ON "Application"("rulePackVersionId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ApprovalCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_rulePackVersionId_fkey" FOREIGN KEY ("rulePackVersionId") REFERENCES "RulePackVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulePackVersion" ADD CONSTRAINT "RulePackVersion_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ApprovalCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Amendment" ADD CONSTRAINT "Amendment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "RulePackVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

