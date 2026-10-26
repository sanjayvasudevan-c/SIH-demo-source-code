-- Rule pack guard (add-on A5). Applied after 001 and after migrate-from-json has back-filled. Idempotent.

-- Back-filled columns become NOT NULL; the old policy version column goes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Application" WHERE "cycleId" IS NULL OR "rulePackVersionId" IS NULL) THEN
    RAISE EXCEPTION 'Applications without a rule pack remain; run migrate-from-json first';
  END IF;
  IF EXISTS (SELECT 1 FROM "Assignment" WHERE "rulePackVersionId" IS NULL) THEN
    RAISE EXCEPTION 'Assignments without a rule pack remain; run migrate-from-json first';
  END IF;
END
$$;
ALTER TABLE "Application" ALTER COLUMN "cycleId" SET NOT NULL;
ALTER TABLE "Application" ALTER COLUMN "rulePackVersionId" SET NOT NULL;
ALTER TABLE "Assignment" ALTER COLUMN "rulePackVersionId" SET NOT NULL;
ALTER TABLE "Assignment" DROP COLUMN IF EXISTS "policyVersion";

-- Exactly one PUBLISHED version per cycle.
CREATE UNIQUE INDEX IF NOT EXISTS rulepack_one_published
  ON "RulePackVersion" ("cycleId") WHERE status = 'PUBLISHED';

-- Content is immutable after DRAFT; status moves only along the transition list; only drafts may be deleted.
CREATE OR REPLACE FUNCTION rulepack_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'rule pack version % is %; only drafts can be deleted', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'a rule pack version must be created as DRAFT';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.content IS DISTINCT FROM OLD.content OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash") AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'rule pack version % is %; its content cannot change', OLD.id, OLD.status;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'IN_REVIEW')
    OR (OLD.status = 'IN_REVIEW' AND NEW.status IN ('APPROVED', 'REJECTED'))
    OR (OLD.status = 'REJECTED' AND NEW.status = 'DRAFT')
    OR (OLD.status = 'APPROVED' AND NEW.status = 'PUBLISHED')
    OR (OLD.status = 'PUBLISHED' AND NEW.status = 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'rule pack version % cannot move from % to %', OLD.id, OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'PUBLISHED' AND OLD.status <> 'PUBLISHED' THEN
    PERFORM pg_notify('rules_published', NEW."cycleId");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rulepack_guard ON "RulePackVersion";
CREATE TRIGGER rulepack_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "RulePackVersion"
  FOR EACH ROW EXECUTE FUNCTION rulepack_guard();

-- Amendments of non-draft versions are frozen with their version.
CREATE OR REPLACE FUNCTION amendment_guard() RETURNS trigger AS $$
DECLARE s "RulePackStatus";
BEGIN
  SELECT status INTO s FROM "RulePackVersion" WHERE id = COALESCE(NEW."versionId", OLD."versionId");
  IF s IS NOT NULL AND s <> 'DRAFT' THEN
    RAISE EXCEPTION 'the amendment of a % version cannot change', s;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS amendment_guard ON "Amendment";
CREATE TRIGGER amendment_guard
  BEFORE UPDATE OR DELETE ON "Amendment"
  FOR EACH ROW EXECUTE FUNCTION amendment_guard();

GRANT SELECT, INSERT, UPDATE, DELETE ON "ApprovalCycle", "RulePackVersion", "Amendment" TO aicte_app;
