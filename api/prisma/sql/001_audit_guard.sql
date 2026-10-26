-- Applied after every `prisma migrate deploy`, as aicte_migrator. Idempotent.

-- Grants: the app role may read and write every table, but the audit log is insert-only.
GRANT USAGE ON SCHEMA public TO aicte_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aicte_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aicte_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM aicte_app;
REVOKE ALL ON "_prisma_migrations" FROM aicte_app;

-- Append-only trigger: even the owner cannot change or remove audit rows without disabling it.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_append_only ON "AuditLog";
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- One open assignment per task.
CREATE UNIQUE INDEX IF NOT EXISTS assignment_open_task_unique
  ON "Assignment" ("applicationId", "taskType", "taskRefId") WHERE "releasedAt" IS NULL;
CREATE INDEX IF NOT EXISTS assignment_open_officer
  ON "Assignment" ("officerId") WHERE "releasedAt" IS NULL;

-- Open exception flags.
CREATE INDEX IF NOT EXISTS exception_flag_open
  ON "ExceptionFlag" ("applicationId") WHERE "resolvedAt" IS NULL;

-- CHECK constraints.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'officer_capacity_positive') THEN
    ALTER TABLE "OfficerProfile" ADD CONSTRAINT officer_capacity_positive CHECK ("capacityPoints" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_range_valid') THEN
    ALTER TABLE "OfficerAvailability" ADD CONSTRAINT availability_range_valid CHECK ("endsOn" >= "startsOn");
  END IF;
END
$$;
