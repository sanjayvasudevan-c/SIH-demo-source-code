-- Run by the postgres image on first start (and by scripts/setup.mjs for local dev).
-- aicte_migrator owns the schema and runs migrations; aicte_app is what the API and scheduler use.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aicte_migrator') THEN
    CREATE ROLE aicte_migrator LOGIN CREATEDB PASSWORD 'migrator_pw';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aicte_app') THEN
    CREATE ROLE aicte_app LOGIN PASSWORD 'app_pw';
  END IF;
END
$$;

SELECT 'CREATE DATABASE aicte OWNER aicte_migrator'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'aicte')\gexec
SELECT 'CREATE DATABASE aicte_seed OWNER aicte_migrator'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'aicte_seed')\gexec

GRANT CONNECT ON DATABASE aicte TO aicte_app;
