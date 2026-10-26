-- CreateEnum
CREATE TYPE "Role" AS ENUM ('COLLEGE', 'OFFICER', 'SENIOR', 'SUPER_SENIOR', 'HOD', 'BUREAU', 'COMMITTEE', 'AUTHORITY', 'ADMIN');

-- CreateEnum
CREATE TYPE "Stage" AS ENUM ('SCRUTINY', 'EVC', 'SAC_SHC', 'DECISION');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('IN_STAGE', 'RETURNED', 'APPROVED', 'APPROVED_WITH_CONDITIONS', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "HolderType" AS ENUM ('USER', 'COMMITTEE', 'AUTHORITY', 'COLLEGE', 'NONE');

-- CreateEnum
CREATE TYPE "AppType" AS ENUM ('NEW_INSTITUTION', 'EXTENSION', 'NAME_CHANGE', 'INTAKE_INCREASE', 'CHANGE_OF_SITE', 'VERIFICATION_VISIT', 'RESTORATION');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('NEW', 'EXTENSION', 'EXPANSION');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('SCRUTINY', 'RE_SCRUTINY', 'EVC_DESK', 'VERIFY', 'SAC_SHC_FORWARD');

-- CreateEnum
CREATE TYPE "AvailabilityKind" AS ENUM ('LEAVE', 'TRAINING', 'FIELD_VISIT', 'OFFLINE');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('STAGE_SLA', 'EVC_SCHEDULE', 'EVC_REPORT', 'VERIFICATION', 'UNDERTAKING', 'DOC_EXPIRY');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('OPEN', 'PAUSED', 'MET', 'MISSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('WORKING', 'CALENDAR');

-- CreateEnum
CREATE TYPE "ReasonCode" AS ENUM ('STAGE_AT_RISK', 'STAGE_OVERDUE', 'WAITING_ON_COLLEGE', 'STALLED', 'EVC_NOT_SCHEDULED', 'EVC_OVERDUE', 'EVIDENCE_PENDING_VERIFICATION', 'UNDERTAKING_DUE_SOON', 'UNDERTAKING_OVERDUE', 'DOC_EXPIRING', 'DOC_EXPIRED', 'BLOCKED', 'URGENT', 'ESCALATED');

-- CreateEnum
CREATE TYPE "EvcStatus" AS ENUM ('UNSCHEDULED', 'SCHEDULED', 'REPORTED');

-- CreateEnum
CREATE TYPE "UndertakingStatus" AS ENUM ('OPEN', 'SUBMITTED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('NONE', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "regionId" TEXT,
    "reportsToId" TEXT,
    "institutionId" TEXT,
    "title" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficerProfile" (
    "userId" TEXT NOT NULL,
    "homeRegionId" TEXT,
    "capacityPoints" DECIMAL(65,30) NOT NULL DEFAULT 10,
    "maxUtil" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "barredInstitutionIds" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "OfficerProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "OfficerAvailability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AvailabilityKind" NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficerAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "permanentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "portfolioOfficerId" TEXT,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioHistory" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "fromOfficerId" TEXT,
    "toOfficerId" TEXT NOT NULL,
    "byUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "applicationNo" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "type" "AppType" NOT NULL,
    "category" "Category" NOT NULL,
    "categoryRank" INTEGER NOT NULL,
    "route" JSONB NOT NULL,
    "stage" "Stage" NOT NULL,
    "status" "Status" NOT NULL,
    "holderType" "HolderType" NOT NULL,
    "holderUserId" TEXT,
    "evcScheduled" BOOLEAN NOT NULL DEFAULT false,
    "sacForwarded" BOOLEAN NOT NULL DEFAULT false,
    "previousOfficerId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "stageEnteredAt" TIMESTAMP(3) NOT NULL,
    "lastActionAt" TIMESTAMP(3) NOT NULL,
    "formData" JSONB NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "taskRefId" TEXT NOT NULL DEFAULT '',
    "officerId" TEXT NOT NULL,
    "weight" DECIMAL(65,30) NOT NULL,
    "tier" INTEGER NOT NULL,
    "reasonText" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "recommendedOfficerId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "releasedReason" TEXT,
    "overriddenById" TEXT,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "institutionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL,
    "expiryDate" DATE,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "supersedesId" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deficiency" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "replyNote" TEXT,
    "replyDocumentIds" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "Deficiency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvcVisit" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "proposedMemberIds" JSONB NOT NULL,
    "memberIds" JSONB NOT NULL,
    "visitDate" DATE,
    "mode" TEXT,
    "status" "EvcStatus" NOT NULL,
    "checklist" JSONB,
    "recommendation" TEXT,
    "reportText" TEXT,
    "reportedById" TEXT,
    "reportedAt" TIMESTAMP(3),

    CONSTRAINT "EvcVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "committeeRole" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedById" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Undertaking" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "UndertakingStatus" NOT NULL,
    "evidenceDocId" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "remarks" TEXT,

    CONSTRAINT "Undertaking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadlineItem" (
    "id" BIGSERIAL NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "ItemType" NOT NULL,
    "sourceId" TEXT NOT NULL DEFAULT '',
    "responsibleUserId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "unit" "Unit" NOT NULL,
    "totalDays" INTEGER,
    "status" "ItemStatus" NOT NULL,
    "pausedRemaining" INTEGER,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "DeadlineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertLog" (
    "id" BIGSERIAL NOT NULL,
    "itemId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "offsetOrLevel" INTEGER NOT NULL,
    "triggerDate" DATE NOT NULL,
    "late" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionFlag" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "reasonCode" "ReasonCode" NOT NULL,
    "sourceItemId" TEXT NOT NULL DEFAULT '',
    "ownerRole" "Role" NOT NULL,
    "ownerUserId" TEXT,
    "reasonText" TEXT NOT NULL,
    "nextAction" TEXT NOT NULL,
    "nextEscalationAt" DATE,
    "escalationLevel" INTEGER NOT NULL,
    "sortKeys" JSONB NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ExceptionFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormCheckResult" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "institutionId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "modelAvailable" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "severity" "Severity" NOT NULL,
    "warnings" JSONB NOT NULL,
    "justification" TEXT,
    "officerLabels" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormCheckResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "chainKey" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "applicationId" TEXT,
    "fromState" JSONB,
    "toState" JSONB,
    "reason" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "prevHash" TEXT NOT NULL,
    "rowHash" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "SimClock" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "offsetDays" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SimClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulerHeartbeat" (
    "instanceId" TEXT NOT NULL,
    "isLeader" BOOLEAN NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastResult" JSONB NOT NULL,

    CONSTRAINT "SchedulerHeartbeat_pkey" PRIMARY KEY ("instanceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_reportsToId_idx" ON "User"("reportsToId");

-- CreateIndex
CREATE INDEX "User_regionId_role_idx" ON "User"("regionId", "role");

-- CreateIndex
CREATE INDEX "OfficerAvailability_userId_startsOn_endsOn_idx" ON "OfficerAvailability"("userId", "startsOn", "endsOn");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_permanentId_key" ON "Institution"("permanentId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_applicationNo_key" ON "Application"("applicationNo");

-- CreateIndex
CREATE INDEX "Application_regionId_stage_idx" ON "Application"("regionId", "stage");

-- CreateIndex
CREATE INDEX "Application_institutionId_idx" ON "Application"("institutionId");

-- CreateIndex
CREATE INDEX "Assignment_applicationId_idx" ON "Assignment"("applicationId");

-- CreateIndex
CREATE INDEX "Document_applicationId_idx" ON "Document"("applicationId");

-- CreateIndex
CREATE INDEX "Document_institutionId_idx" ON "Document"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "EvcVisit_applicationId_key" ON "EvcVisit"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_applicationId_key" ON "Decision"("applicationId");

-- CreateIndex
CREATE INDEX "DeadlineItem_status_dueDate_idx" ON "DeadlineItem"("status", "dueDate");

-- CreateIndex
CREATE INDEX "DeadlineItem_applicationId_idx" ON "DeadlineItem"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertLog_itemId_kind_offsetOrLevel_key" ON "AlertLog"("itemId", "kind", "offsetOrLevel");

-- CreateIndex
CREATE UNIQUE INDEX "ExceptionFlag_applicationId_reasonCode_sourceItemId_key" ON "ExceptionFlag"("applicationId", "reasonCode", "sourceItemId");

-- CreateIndex
CREATE INDEX "FormCheckResult_draftId_idx" ON "FormCheckResult"("draftId");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "AuditLog_chainKey_id_idx" ON "AuditLog"("chainKey", "id");

-- CreateIndex
CREATE INDEX "AuditLog_applicationId_idx" ON "AuditLog"("applicationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficerProfile" ADD CONSTRAINT "OfficerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficerAvailability" ADD CONSTRAINT "OfficerAvailability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_portfolioOfficerId_fkey" FOREIGN KEY ("portfolioOfficerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deficiency" ADD CONSTRAINT "Deficiency_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvcVisit" ADD CONSTRAINT "EvcVisit_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Undertaking" ADD CONSTRAINT "Undertaking_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeadlineItem" ADD CONSTRAINT "DeadlineItem_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionFlag" ADD CONSTRAINT "ExceptionFlag_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormCheckResult" ADD CONSTRAINT "FormCheckResult_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
