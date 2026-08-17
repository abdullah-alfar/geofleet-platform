#!/usr/bin/env bash
# Shared helpers for scripts/api-test/*.sh — sourced, not run directly.
#
# Design: every script in this directory is independently runnable (so you
# can jump straight to, say, 09-create-ride-request.sh while reading
# RideRequestController) AND chainable (each one saves the ids/tokens the
# next one needs into .state, a plain KEY=value file next to this one).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.state"
touch "$STATE_FILE"

# Every service's base URL — override any of these as env vars if you're
# running on non-default ports (see docs/local-development-without-docker.md).
CORE_API_URL="${CORE_API_URL:-http://127.0.0.1:8000}"
LOCATION_URL="${LOCATION_URL:-http://127.0.0.1:8081}"
DISPATCH_URL="${DISPATCH_URL:-http://127.0.0.1:8082}"
REALTIME_URL="${REALTIME_URL:-http://127.0.0.1:8083}"
ADMIN_API_URL="${ADMIN_API_URL:-http://127.0.0.1:3001}"

BOLD=$'\033[1m'
DIM=$'\033[2m'
CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
RESET=$'\033[0m'

# --- state persistence -------------------------------------------------

# save KEY value — writes/overwrites KEY in .state (also exports it into
# the current shell so later commands in the same script can use it).
save() {
  local key="$1" value="$2"
  grep -v "^${key}=" "$STATE_FILE" > "${STATE_FILE}.tmp" 2>/dev/null || true
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
  # %q shell-quotes the value — Sanctum tokens contain a literal `|`,
  # which `source` would otherwise parse as a pipe on reload.
  printf '%s=%q\n' "$key" "$value" >> "$STATE_FILE"
  export "${key}=${value}"
}

# load — sources every saved value into the current shell. Call this at
# the top of any script that depends on a previous one's output.
load() {
  # shellcheck disable=SC1090
  set -a; source "$STATE_FILE"; set +a
}

# require VAR1 VAR2 ... — fails with a clear message (and which script to
# run first) instead of a confusing curl error against an empty URL/token.
require() {
  local missing=()
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then missing+=("$name"); fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "${RED}Missing: ${missing[*]}${RESET}" >&2
    echo "${DIM}Run the earlier numbered script that saves ${missing[*]}, or check $STATE_FILE${RESET}" >&2
    exit 1
  fi
}

# --- output ---------------------------------------------------------------

# step "title" "path/to/SourceFile.php:method" — the banner every script
# starts with. The second argument is deliberate: open that file in
# another window before running the curl below it.
step() {
  echo
  echo "${BOLD}${CYAN}== $1 ==${RESET}"
  if [ -n "${2:-}" ]; then
    echo "${DIM}   code: $2${RESET}"
  fi
}

note() {
  echo "${DIM}   $1${RESET}"
}

ok() {
  echo "${GREEN}$1${RESET}"
}

warn() {
  echo "${YELLOW}$1${RESET}"
}

fail() {
  echo "${RED}$1${RESET}" >&2
}

# pretty RESPONSE_BODY — jq-formatted with syntax highlighting when a
# terminal is attached, otherwise plain (safe for piping/redirecting).
pretty() {
  if [ -t 1 ]; then jq -C . 2>/dev/null || cat; else jq . 2>/dev/null || cat; fi
}

# req METHOD URL [curl-args...] — curl wrapper that always prints the
# HTTP status on its own line before the body, and always shows the
# method + URL being called so you can see exactly what a "black box"
# request looked like.
req() {
  local method="$1" url="$2"
  shift 2
  echo "${DIM}   -> ${method} ${url}${RESET}"
  local tmp
  tmp="$(mktemp)"
  local status
  status="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$url" "$@" || echo "curl_failed")"
  if [ "$status" = "curl_failed" ]; then
    fail "   connection failed — is the service running? (see docs/local-development-without-docker.md)"
    rm -f "$tmp"
    return 1
  fi
  if [[ "$status" =~ ^2 ]]; then
    echo "   ${GREEN}${status}${RESET}"
  else
    echo "   ${RED}${status}${RESET}"
  fi
  cat "$tmp" | pretty
  # Body is left in $RESPONSE for the caller to jq out of.
  RESPONSE="$(cat "$tmp")"
  rm -f "$tmp"
}
