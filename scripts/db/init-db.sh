#!/usr/bin/env bash
# Bootstraps the eduia role plus the app database AND its e2e twin
# (<db>_test) inside an existing PostgreSQL container. Idempotent:
# re-running it changes nothing that already exists.
#
# Works with docker (production server) or podman (dev host) transparently.
#
# Usage, env style:
#   PG_CONTAINER=postgres-18 DB_PASSWORD_FILE=/root/.eduia-db-password bash scripts/db/init-db.sh
# Usage, flag style:
#   bash scripts/db/init-db.sh --container postgres-18 --password-file /root/.eduia-db-password \
#       [--db eduia] [--user eduia] [--superuser postgres] [--no-test-db]
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-}"
DB_NAME="${DB_NAME:-eduia}"
DB_USER="${DB_USER:-eduia}"
DB_PASSWORD_FILE="${DB_PASSWORD_FILE:-}"
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
CREATE_TEST_DB=1
RUNTIME=""

die() { echo "ERROR: $*" >&2; exit 1; }

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

parse_flags() {
  while (($# > 0)); do
    case "$1" in
      --container) PG_CONTAINER="$2"; shift 2 ;;
      --db) DB_NAME="$2"; shift 2 ;;
      --user) DB_USER="$2"; shift 2 ;;
      --password-file) DB_PASSWORD_FILE="$2"; shift 2 ;;
      --superuser) PG_SUPERUSER="$2"; shift 2 ;;
      --no-test-db) CREATE_TEST_DB=0; shift ;;
      -h|--help) usage 0 ;;
      *) die "unknown flag: $1 (see --help)" ;;
    esac
  done
}

validate_inputs() {
  [[ -n $PG_CONTAINER ]] || die "PG_CONTAINER (or --container) is required"
  [[ -n $DB_PASSWORD_FILE ]] || die "DB_PASSWORD_FILE (or --password-file) is required"
  [[ -f $DB_PASSWORD_FILE ]] || die "password file not found: $DB_PASSWORD_FILE"
  [[ -s $DB_PASSWORD_FILE ]] || die "password file is empty: $DB_PASSWORD_FILE"
}

pick_runtime() {
  if command -v docker >/dev/null 2>&1; then
    RUNTIME=docker
  elif command -v podman >/dev/null 2>&1; then
    RUNTIME=podman
  else
    die "neither docker nor podman is installed"
  fi
  "$RUNTIME" inspect "$PG_CONTAINER" >/dev/null 2>&1 ||
    die "container '$PG_CONTAINER' not found via $RUNTIME"
}

# Runs psql inside the container reading SQL from stdin, so psql variable
# interpolation (:"var" / :'var') handles quoting of identifiers and secrets.
run_psql() {
  "$RUNTIME" exec -i "$PG_CONTAINER" \
    psql -U "$PG_SUPERUSER" -d postgres -v ON_ERROR_STOP=1 -tA "$@"
}

exists_in_catalog() {
  local out
  out=$(echo "$1" | run_psql)
  [[ -n $out ]]
}

# The password reaches psql over stdin, never as a flag: everything in
# "$RUNTIME" exec ... is visible in the process table of the host and of the
# container, and lands in exec accounting. \set puts it in the same :'pw'
# variable, so psql still does the SQL quoting; the escaping here is psql's own
# (backslash and single quote) for the \set argument.
ensure_role() {
  if exists_in_catalog "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER';"; then
    echo "Role '$DB_USER' already exists, leaving it untouched."
    return 0
  fi
  local pw escaped
  pw=$(<"$DB_PASSWORD_FILE")
  escaped=${pw//\\/\\\\}
  escaped=${escaped//\'/\\\'}
  {
    printf '\\set pw %s\n' "'$escaped'"
    cat <<'SQL'
CREATE ROLE :"role" LOGIN PASSWORD :'pw';
SQL
  } | run_psql -v "role=$DB_USER"
  echo "Created role '$DB_USER' with login."
}

ensure_database() {
  local db="$1"
  if exists_in_catalog "SELECT 1 FROM pg_database WHERE datname = '$db';"; then
    echo "Database '$db' already exists, leaving it untouched."
    return 0
  fi
  run_psql -v "db=$db" -v "owner=$DB_USER" <<'SQL'
CREATE DATABASE :"db" OWNER :"owner";
SQL
  echo "Created database '$db' owned by '$DB_USER'."
}

main() {
  parse_flags "$@"
  validate_inputs
  pick_runtime
  echo "Bootstrapping '$DB_NAME'/'$DB_USER' in container '$PG_CONTAINER' (via $RUNTIME)"
  ensure_role
  ensure_database "$DB_NAME"
  # test/setup-e2e.ts points the e2e suite at this twin; a fresh clone that
  # skips it fails at connection time.
  if (( CREATE_TEST_DB )); then
    ensure_database "${DB_NAME}_test"
  fi
  echo "Done. The API can now connect as '$DB_USER' to '$DB_NAME'."
}

main "$@"
