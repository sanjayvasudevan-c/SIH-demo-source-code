-- Demo setting: file outside the application windows (DEMO_MODE only).
ALTER TABLE "SimClock" ADD COLUMN "ignoreSchedule" BOOLEAN NOT NULL DEFAULT false;
