#!/usr/bin/env bash
# Day-to-day wrapper for the back-eduia dev service.
# Usage: stack.sh status|restart|logs|redeploy
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$INFRA_DIR")"
SERVICE=back-eduia-dev.service
HEALTH_URL=http://127.0.0.1:3125/health/live
DRIFT_TOLERANCE_SEC=5

fetch_health() {
  curl -fsS -m 3 "$HEALTH_URL" 2>/dev/null || true
}

wait_healthy() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
      echo "healthy after ${i}s"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: $HEALTH_URL never answered within 60s" >&2
  return 1
}

newest_src_epoch() {
  # Only the files that actually change running behaviour: runtime .ts (spec
  # files are not in the import graph) plus .env, which is read once at boot
  # and never picked up by bun --watch, so an edit there means real drift.
  {
    find "$APP_DIR/src" -type f -name '*.ts' ! -name '*.spec.ts' -printf '%T@\n'
    [[ -f "$APP_DIR/.env" ]] && stat -c '%Y' "$APP_DIR/.env"
  } 2>/dev/null | sort -rn | head -1 | cut -d. -f1
}

booted_epoch() {
  # Pull the bootedAt ISO timestamp out of the health JSON.
  local iso
  iso="$(echo "$1" | grep -o '"bootedAt":"[^"]*"' | cut -d'"' -f4)"
  [[ -n "$iso" ]] && date -d "$iso" +%s 2>/dev/null || true
}

check_drift() {
  local health="$1" booted newest
  booted="$(booted_epoch "$health")"
  newest="$(newest_src_epoch)"
  if [[ -z "$booted" || -z "$newest" ]]; then
    echo "drift: cannot compare (missing bootedAt or src mtimes)"
  elif (( newest - booted > DRIFT_TOLERANCE_SEC )); then
    echo "WARNING: DRIFT: running boot ($(date -d "@$booted")) is older" \
      "than newest src change ($(date -d "@$newest")); watch reload failed?"
  else
    echo "drift: none (running code matches newest src change)"
  fi
}

cmd_status() {
  local health
  echo "systemd: $(systemctl is-active "$SERVICE" 2>/dev/null || true)"
  health="$(fetch_health)"
  echo "health: ${health:-unreachable}"
  check_drift "$health"
}

cmd_restart() {
  systemctl restart "$SERVICE"
  wait_healthy
}

cmd_logs() {
  journalctl -u "$SERVICE" -f --no-pager -n 100
}

cmd_redeploy() {
  if git -C "$APP_DIR" remote get-url origin >/dev/null 2>&1; then
    git -C "$APP_DIR" pull --ff-only
  else
    echo "no git remote configured, skipping pull"
  fi
  cmd_restart
}

case "${1:-}" in
  status)   cmd_status ;;
  restart)  cmd_restart ;;
  logs)     cmd_logs ;;
  redeploy) cmd_redeploy ;;
  *) echo "usage: $0 status|restart|logs|redeploy" >&2; exit 2 ;;
esac
