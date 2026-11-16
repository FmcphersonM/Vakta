#!/usr/bin/env bash
# Starts the local PostgreSQL server (development only) and creates the
# "vakta" user plus the "vakta" and "vakta_test" databases if they are missing.
# The app user is deliberately NOT a superuser, exactly like on a managed host,
# so that row-level security is enforced in development too.
set -euo pipefail
service postgresql start >/dev/null 2>&1 || pg_ctlcluster 16 main start
for i in $(seq 1 20); do su postgres -c "pg_isready -q" && break; sleep 0.5; done
su postgres -c "psql -v ON_ERROR_STOP=1 -q" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vakta') THEN
    CREATE ROLE vakta LOGIN PASSWORD 'vakta' NOSUPERUSER NOBYPASSRLS CREATEDB;
  END IF;
END $$;
SQL
for db in vakta vakta_test; do
  su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"" | grep -q 1 \
    || su postgres -c "createdb -O vakta $db"
done
echo "Postgres ready: postgres://vakta:vakta@localhost:5432/vakta"
