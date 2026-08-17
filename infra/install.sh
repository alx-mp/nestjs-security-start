#!/usr/bin/env bash
# Installs the back-eduia dev units into systemd. Idempotent: re-running
# re-renders the unit files, reloads systemd, and restarts the service.
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$INFRA_DIR")"
UNIT_DIR=/etc/systemd/system
SERVICE=back-eduia-dev.service
TIMER=back-eduia-watchdog.timer
PORT=3125
HEALTH_URL=http://127.0.0.1:3125/health/live

resolve_bun() {
  if [[ -x /root/.bun/bin/bun ]]; then
    echo /root/.bun/bin/bun
  elif command -v bun >/dev/null 2>&1; then
    command -v bun
  else
    echo "bun not found at /root/.bun/bin/bun nor on PATH" >&2
    return 1
  fi
}

# Refuse to evict a unit that is not ours. A blind fuser -k on a shared host
# has already killed a sibling service once.
check_port() {
  local holder
  holder="$(ss -ltnp "sport = :$PORT" 2>/dev/null | tail -n +2 || true)"
  [[ -z $holder ]] && return 0

  if grep -rqs "PORT=$PORT\b\|:$PORT/tcp" "$UNIT_DIR"/back-eduia*.service 2>/dev/null; then
    return 0
  fi
  # Our own unit already running also counts as ours.
  if systemctl is-active --quiet "$SERVICE"; then
    return 0
  fi
  echo "ERROR: port $PORT is held by another process and no back-eduia unit claims it:" >&2
  echo "$holder" >&2
  exit 1
}

render_units() {
  local tpl name
  for tpl in "$INFRA_DIR"/*.template; do
    name="$(basename "$tpl" .template)"
    sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@BUN@|$BUN|g" \
      "$tpl" > "$UNIT_DIR/$name"
    echo "installed $UNIT_DIR/$name"
  done
}

start_units() {
  # Clear any stray listener on the app port before systemd takes over.
  /usr/sbin/fuser -k "$PORT"/tcp 2>/dev/null || true
  systemctl daemon-reload
  systemctl enable --now "$TIMER"
  systemctl enable "$SERVICE"
  # restart (not just enable --now) so a re-run picks up unit changes.
  systemctl restart "$SERVICE"
}

wait_healthy() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

report() {
  systemctl status "$SERVICE" --no-pager -l | head -15 || true
  systemctl status "$TIMER" --no-pager -l | head -8 || true
  echo "health: $(curl -fsS -m 3 "$HEALTH_URL" 2>/dev/null || echo unreachable)"
}

main() {
  BUN="$(resolve_bun)"
  echo "APP_DIR=$APP_DIR"
  echo "BUN=$BUN"
  check_port
  render_units
  start_units
  if wait_healthy; then
    echo "service is healthy"
    report
  else
    echo "ERROR: $HEALTH_URL never answered within 60s" >&2
    report
    exit 1
  fi
}

main "$@"
