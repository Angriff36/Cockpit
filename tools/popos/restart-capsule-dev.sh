#!/usr/bin/env bash
#
# Capsule Pro — dev stack restart + verification (Pop!_OS)
#
# Cockpit dispatches this script over SSH. It owns the full restart:
#   - kills only the processes bound to the app/API ports
#   - relaunches the app and API via the repo's dev scripts
#   - resets and re-publishes Tailscale Serve
#   - verifies every relevant origin with proxy env scrubbed
#   - exits non-zero if any *critical* check fails
#
# Deploy:
#   scp this file to /home/oc/projects/capsule-pro/tools/restart-capsule-dev.sh
#   chmod +x /home/oc/projects/capsule-pro/tools/restart-capsule-dev.sh
#
# Trigger from Cockpit (or anywhere):
#   ssh oc@pop-os '/home/oc/projects/capsule-pro/tools/restart-capsule-dev.sh'

set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
REPO=/home/oc/projects/capsule-pro
LOGS=$REPO/.dev-logs
APP_PORT=2221
API_PORT=2223
REMOTE_URL=https://pop-os.tail78dd9e.ts.net

# Repo scripts (verified from package.json on pop-os):
#   "dev:app" → turbo run dev --filter=./apps/app   (port 2221)
#   "dev:api" → turbo run dev --filter=./apps/api   (port 2223)
APP_CMD=${APP_CMD:-'pnpm dev:app'}
API_CMD=${API_CMD:-'pnpm dev:api'}

HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-60}   # seconds per endpoint

# Auth redirects count as healthy for routes behind auth (e.g. /calendar)
ACCEPT_REGEX='^(200|301|302|303|307|308|401|403)$'

# ── Setup ──────────────────────────────────────────────────────────────────
cd "$REPO"
mkdir -p "$LOGS"
TS=$(date +%Y%m%d-%H%M%S)
RUN_LOG="$LOGS/restart-$TS.log"
exec > >(tee -a "$RUN_LOG") 2>&1

log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die()  { log "FAIL: $*"; exit 1; }

log "Capsule Pro restart starting (repo=$REPO, run-log=$RUN_LOG)"

# ── Kill listeners on app/API ports only ───────────────────────────────────
kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    log "killing port $port (pids: $pids)"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
      log "force-killing port $port (pids: $pids)"
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  else
    log "port $port already free"
  fi
}

kill_port "$APP_PORT"
kill_port "$API_PORT"

# ── Launch app & API ───────────────────────────────────────────────────────
# Detach with setsid + nohup so the SSH session can disconnect cleanly.
start_bg() {
  local label=$1 cmd=$2 logfile=$3
  log "starting $label: $cmd"
  setsid nohup bash -lc "$cmd" >"$logfile" 2>&1 < /dev/null &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  log "  pid=$pid  log=$logfile"
}

start_bg app "$APP_CMD" "$LOGS/app.log"
start_bg api "$API_CMD" "$LOGS/api.log"

# ── Tailscale Serve: reset then publish app on https://<tailnet>/ ──────────
log "resetting tailscale serve"
sudo tailscale serve reset >>"$LOGS/tailscale-serve.log" 2>&1 || true

log "publishing tailscale serve https=443 → http://127.0.0.1:$APP_PORT"
sudo tailscale serve --bg --https=443 / "http://127.0.0.1:$APP_PORT" \
  >>"$LOGS/tailscale-serve.log" 2>&1 \
  || die "tailscale serve publish failed (see $LOGS/tailscale-serve.log)"

# ── Health checks with proxies scrubbed ────────────────────────────────────
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy

wait_status() {
  local url=$1 label=$2 timeout=${3:-$HEALTH_TIMEOUT}
  local end=$(( $(date +%s) + timeout ))
  local code=000
  while (( $(date +%s) < end )); do
    code=$(curl --noproxy '*' -k -s -o /dev/null \
                -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")
    if [[ "$code" =~ $ACCEPT_REGEX ]]; then
      log "  ok  $label  $code  $url"
      return 0
    fi
    sleep 2
  done
  log "  bad $label  last=$code  $url"
  return 1
}

LOCAL_APP_OK=0; LOCAL_API_OK=0; REMOTE_OK=0; LOCAL_CAL_OK=0; REMOTE_CAL_OK=0

log "verifying endpoints (proxies unset)"
wait_status "http://127.0.0.1:$APP_PORT"             "local-app"        && LOCAL_APP_OK=1 || true
wait_status "http://127.0.0.1:$API_PORT"             "local-api"        && LOCAL_API_OK=1 || true
wait_status "$REMOTE_URL"                            "tailscale-root"   && REMOTE_OK=1    || true
wait_status "http://127.0.0.1:$APP_PORT/calendar"    "local-calendar"   && LOCAL_CAL_OK=1 || true
wait_status "$REMOTE_URL/calendar"                   "tailscale-cal"    && REMOTE_CAL_OK=1 || true

# ── Final report ───────────────────────────────────────────────────────────
status() { [[ "${1:-0}" == 1 ]] && echo PASS || echo FAIL; }

echo
echo "── Capsule Pro dev restart ─────────────────────────────────────────"
printf "  %-18s %-44s %s\n" "local app"        "http://127.0.0.1:$APP_PORT"            "$(status $LOCAL_APP_OK)"
printf "  %-18s %-44s %s\n" "local api"        "http://127.0.0.1:$API_PORT"            "$(status $LOCAL_API_OK)"
printf "  %-18s %-44s %s\n" "tailscale root"   "$REMOTE_URL"                           "$(status $REMOTE_OK)"
printf "  %-18s %-44s %s\n" "local /calendar"  "http://127.0.0.1:$APP_PORT/calendar"   "$(status $LOCAL_CAL_OK)"
printf "  %-18s %-44s %s\n" "remote /calendar" "$REMOTE_URL/calendar"                  "$(status $REMOTE_CAL_OK)"
echo "  logs:   $LOGS"
echo "  run:    $RUN_LOG"
echo "────────────────────────────────────────────────────────────────────"

# ── Exit semantics ─────────────────────────────────────────────────────────
# Critical: local app, local API, tailscale serve (covered by remote root)
(( LOCAL_APP_OK == 1 )) || die "local app health check failed"
(( LOCAL_API_OK == 1 )) || die "local API health check failed"
(( REMOTE_OK    == 1 )) || die "tailscale serve health check failed"

# /calendar checks are reported but non-fatal; uncomment to enforce.
# (( LOCAL_CAL_OK  == 1 )) || die "local /calendar failed"
# (( REMOTE_CAL_OK == 1 )) || die "remote /calendar failed"

log "OK — all critical checks passed"
exit 0
