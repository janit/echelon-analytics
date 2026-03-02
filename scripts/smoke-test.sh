#!/usr/bin/env bash
# =============================================================================
# Echelon Analytics — Deploy-time Smoke + Fuzz + Performance Regression Test
#
# Usage: scripts/smoke-test.sh <base_url> [--secret <token>] [--fast]
#
#   base_url   Required. e.g. http://127.0.0.1:19470
#   --secret   ECHELON_SECRET value (for /api/* auth). Falls back to $ECHELON_SECRET.
#   --fast     Skip fuzz / perf regression; run structural checks only.
#
# Exit codes:
#   0  All required checks passed (warnings may still be printed)
#   1  One or more required checks failed
#
# Performance baseline is persisted in data/perf-baseline.json relative to the
# project root (the directory containing scripts/). On first run the file is
# created from observed timings; subsequent runs compare against it.
# =============================================================================

set -euo pipefail

# ── Argument parsing ─────────────────────────────────────────────────────────

BASE_URL=""
SECRET="${ECHELON_SECRET:-}"
FAST=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --secret)  SECRET="$2"; shift 2 ;;
    --fast)    FAST=true;   shift   ;;
    http*|https*) BASE_URL="$1";   shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$BASE_URL" ]]; then
  echo "Usage: $0 <base_url> [--secret <token>] [--fast]" >&2
  exit 1
fi

# Strip trailing slash
BASE_URL="${BASE_URL%/}"

# ── Locate project root (scripts/../) ────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASELINE_FILE="$PROJECT_ROOT/data/perf-baseline.json"

# ── Colour helpers ───────────────────────────────────────────────────────────

_PASS='\033[1;32m'
_FAIL='\033[1;31m'
_WARN='\033[1;33m'
_INFO='\033[1;34m'
_RESET='\033[0m'

pass() { printf "${_PASS}  PASS${_RESET}  %s\n" "$*"; }
fail() { printf "${_FAIL}  FAIL${_RESET}  %s\n" "$*"; FAILURES=$((FAILURES + 1)); }
warn() { printf "${_WARN}  WARN${_RESET}  %s\n" "$*"; }
info() { printf "${_INFO}  ----${_RESET}  %s\n" "$*"; }
section() { echo ""; printf "${_INFO}=== %s ===${_RESET}\n" "$*"; }

FAILURES=0

# ── Default UA (curl is in BOT_UA_PATTERNS — use a realistic browser UA) ────

SMOKE_UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 EchelonSmokeTest/1.0"

# ── curl helper ──────────────────────────────────────────────────────────────

# http_check <label> <expected_status> <curl_args...>
# Returns the HTTP status code in HTTP_STATUS and response body in HTTP_BODY.
HTTP_STATUS=""
HTTP_BODY=""
http_check() {
  local label="$1"
  local expected="$2"
  shift 2

  # Write body to a temp file to capture it without subprocess complexity
  local tmpfile
  tmpfile=$(mktemp)

  HTTP_STATUS=$(curl -s -o "$tmpfile" -w '%{http_code}' \
    -A "$SMOKE_UA" --max-time 10 --connect-timeout 5 "$@" 2>/dev/null) || HTTP_STATUS="000"
  HTTP_BODY=$(cat "$tmpfile")
  rm -f "$tmpfile"

  if [[ "$HTTP_STATUS" == "$expected" ]]; then
    pass "$label (HTTP $HTTP_STATUS)"
    return 0
  else
    fail "$label — expected HTTP $expected, got $HTTP_STATUS"
    return 1
  fi
}

# http_check_range <label> <min_status> <max_status> <curl_args...>
# Passes if status is in [min, max] inclusive.
http_check_range() {
  local label="$1"
  local min="$2"
  local max="$3"
  shift 3

  local tmpfile
  tmpfile=$(mktemp)
  HTTP_STATUS=$(curl -s -o "$tmpfile" -w '%{http_code}' \
    -A "$SMOKE_UA" --max-time 10 --connect-timeout 5 "$@" 2>/dev/null) || HTTP_STATUS="000"
  HTTP_BODY=$(cat "$tmpfile")
  rm -f "$tmpfile"

  if [[ "$HTTP_STATUS" -ge "$min" ]] && [[ "$HTTP_STATUS" -le "$max" ]]; then
    pass "$label (HTTP $HTTP_STATUS)"
    return 0
  else
    fail "$label — expected HTTP ${min}–${max}, got $HTTP_STATUS"
    return 1
  fi
}

# timed_get <url> — sets ELAPSED_MS, HTTP_STATUS, HTTP_BODY
ELAPSED_MS=0
timed_get() {
  local url="$1"
  shift
  local tmpfile tmptime
  tmpfile=$(mktemp)
  tmptime=$(mktemp)

  local start end
  start=$(date +%s%3N)
  HTTP_STATUS=$(curl -s -o "$tmpfile" -w '%{http_code}' \
    -A "$SMOKE_UA" --max-time 15 --connect-timeout 5 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$url" "$@" 2>/dev/null) || HTTP_STATUS="000"
  end=$(date +%s%3N)

  HTTP_BODY=$(cat "$tmpfile")
  ELAPSED_MS=$((end - start))
  rm -f "$tmpfile" "$tmptime"
}

# ── Auth header helper ────────────────────────────────────────────────────────

AUTH_HEADER=()
if [[ -n "$SECRET" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer $SECRET")
fi

# ── Valid test fixtures ───────────────────────────────────────────────────────

# A valid base64-encoded path ("/") for b.gif
VALID_PATH_B64=$(printf '/' | base64 | tr -d '\n')
# A valid base64-encoded referrer (https://example.com)
VALID_REF_B64=$(printf 'https://example.com' | base64 | tr -d '\n')
# A plausible interaction time in ms
VALID_V="1200"
# A valid UUID v4 for batch_id / session_id / event_id
UUID_1="a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5"
UUID_2="b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6"
UUID_3="c3d4e5f6-a7b8-4c9d-0e1f-a2b3c4d5e6f7"

# Minimal valid ingest batch
VALID_BATCH=$(cat <<'JSON'
{
  "v": 1,
  "batch_id": "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
  "sent_at": "2026-03-01T00:00:00.000Z",
  "context": {
    "session_id": "b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6",
    "viewport_width": 1280,
    "viewport_height": 720,
    "screen_width": 1920,
    "screen_height": 1080,
    "device_pixel_ratio": 1,
    "device_class": "desktop",
    "user_agent": "smoke-test/1.0",
    "language": "en-US",
    "timezone_offset_min": 0,
    "connection_type": null
  },
  "events": [
    {
      "event_id": "c3d4e5f6-a7b8-4c9d-0e1f-a2b3c4d5e6f7",
      "type": "scroll_depth",
      "ts": "2026-03-01T00:00:00.000Z",
      "data": {"depth": 50}
    }
  ]
}
JSON
)

# ── 1. Startup / health ───────────────────────────────────────────────────────

section "Startup + Health"

http_check "GET /api/health returns 200" 200 "$BASE_URL/api/health"

# Verify response shape — must contain {"status":"ok"}
if echo "$HTTP_BODY" | grep -q '"status"'; then
  pass "/api/health response contains status field"
else
  fail "/api/health response missing status field (body: $HTTP_BODY)"
fi

# ── 2. Static assets ──────────────────────────────────────────────────────────

section "Static Assets"

http_check "GET /ea.js returns 200" 200 "$BASE_URL/ea.js"

if echo "$HTTP_BODY" | grep -q 'b\.gif\|/e\|echelon\|beacon'; then
  pass "/ea.js body looks like a tracker script"
else
  warn "/ea.js body does not contain expected tracker identifiers"
fi

# Content-Type must be JavaScript
CTJS=$(curl -s -o /dev/null -w '%{content_type}' --max-time 5 "$BASE_URL/ea.js" 2>/dev/null)
if echo "$CTJS" | grep -qi 'javascript'; then
  pass "/ea.js Content-Type is JavaScript ($CTJS)"
else
  fail "/ea.js Content-Type is not JavaScript (got: $CTJS)"
fi

# ── 3. CORS / preflight ───────────────────────────────────────────────────────

section "CORS Preflight"

CORS_RESP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
  -X OPTIONS \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  "$BASE_URL/e" 2>/dev/null) || CORS_RESP="000"

if [[ "$CORS_RESP" == "204" ]]; then
  pass "OPTIONS /e preflight returns 204"
else
  fail "OPTIONS /e preflight — expected 204, got $CORS_RESP"
fi

# CORS headers must be present on /e responses
CORS_HEADERS=$(curl -s -I --max-time 5 \
  -X OPTIONS \
  -H "Origin: https://example.com" \
  "$BASE_URL/e" 2>/dev/null)
if echo "$CORS_HEADERS" | grep -qi 'access-control-allow-origin'; then
  pass "CORS headers present on OPTIONS /e"
else
  fail "CORS headers missing on OPTIONS /e"
fi

# ── 4. Pixel beacon — valid requests ─────────────────────────────────────────

section "Pixel Beacon /b.gif — Valid Requests"

# Valid pageview: path + valid interaction time + screen dims
http_check "GET /b.gif valid pageview" 200 \
  -H "Accept-Language: en-US" \
  -H "Sec-CH-UA: smoke" \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=smoke-test&sw=1920&sh=1080"

# Verify content-type is image/gif
GIFCT=$(curl -s -o /dev/null -w '%{content_type}' -A "$SMOKE_UA" --max-time 5 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=smoke-test" 2>/dev/null)
if echo "$GIFCT" | grep -qi 'image/gif'; then
  pass "/b.gif Content-Type is image/gif"
else
  fail "/b.gif Content-Type is wrong (got: $GIFCT)"
fi

# Cookie-mode beacon (ck=1) — should set _ev cookie
COOKIE_RESP=$(curl -s -D - -o /dev/null -A "$SMOKE_UA" --max-time 5 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=smoke-test&ck=1" 2>/dev/null)
if echo "$COOKIE_RESP" | grep -qi 'set-cookie.*_ev'; then
  pass "/b.gif ck=1 sets _ev cookie"
else
  warn "/b.gif ck=1 did not set _ev cookie (may be behind HTTPS-only Secure flag)"
fi

# With referrer param
http_check "GET /b.gif with ref param" 200 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=smoke-test&ref=${VALID_REF_B64}"

# PWA mode
http_check "GET /b.gif pwa=1" 200 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=smoke-test&pwa=1"

# ── 5. Pixel beacon — boundary / malformed inputs ────────────────────────────

section "Pixel Beacon /b.gif — Boundary + Fuzz"

# No params at all — should still return 200 (empty pixel, not recorded)
http_check "GET /b.gif no params returns 200" 200 "$BASE_URL/b.gif"

# Missing _v — interaction proof absent, view should be silently dropped
http_check "GET /b.gif missing _v returns 200" 200 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&s=smoke-test"

# _v=0 — below 800ms threshold, should be silently dropped
http_check "GET /b.gif _v=0 returns 200" 200 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=0&s=smoke-test"

# _v=999999999 — exceeds 1h ceiling, should be dropped
http_check "GET /b.gif _v=999999999 returns 200" 200 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=999999999&s=smoke-test"

# Malformed base64 path — should return 200 (graceful fallback, not recorded)
http_check "GET /b.gif malformed base64 path returns 200" 200 \
  "$BASE_URL/b.gif?p=!!!NOT_BASE64!!!&_v=${VALID_V}&s=smoke-test"

# p param that decodes to a non-path string (doesn't start with /)
NONPATH_B64=$(printf 'javascript:alert(1)' | base64 | tr -d '\n')
http_check "GET /b.gif path=javascript:alert() returns 200 (not recorded)" 200 \
  "$BASE_URL/b.gif?p=${NONPATH_B64}&_v=${VALID_V}&s=smoke-test"

# Extremely long siteId (512 chars)
LONG_SITE=$(python3 -c "print('x'*512)" 2>/dev/null || printf '%0.s' {1..512} | tr ' ' 'x')
http_check "GET /b.gif very long siteId returns 200" 200 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=${LONG_SITE}"

# Unicode in siteId
http_check "GET /b.gif unicode siteId returns 200" 200 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=$(python3 -c "import urllib.parse; print(urllib.parse.quote('测试/site'))" 2>/dev/null || echo '%E6%B5%8B%E8%AF%95%2Fsite')"

# SQL injection attempt in siteId
SQL_SITE="smoke%27%20OR%20%271%27%3D%271"
http_check "GET /b.gif SQL injection in siteId returns 200" 200 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=${SQL_SITE}"

# XSS payload in siteId
XSS_SITE=$(python3 -c "import urllib.parse; print(urllib.parse.quote('<script>alert(1)</script>'))" 2>/dev/null || echo '%3Cscript%3Ealert%281%29%3C%2Fscript%3E')
http_check "GET /b.gif XSS in siteId returns 200" 200 \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=${XSS_SITE}"

# Path traversal in decoded path
TRAVERSAL_B64=$(printf '../../../etc/passwd' | base64 | tr -d '\n')
http_check "GET /b.gif path traversal in p param returns 200 (not recorded)" 200 \
  "$BASE_URL/b.gif?p=${TRAVERSAL_B64}&_v=${VALID_V}&s=smoke-test"

# Known bot UA — should return 200 (pixel) but not record
http_check "GET /b.gif known bot UA returns 200" 200 \
  -H "User-Agent: Googlebot/2.1 (+http://www.google.com/bot.html)" \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=smoke-test"

# Spoof X-Forwarded-For with reserved/private IP
http_check "GET /b.gif spoofed X-Forwarded-For" 200 \
  -H "X-Forwarded-For: 10.0.0.1, 192.168.1.1" \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=smoke-test"

# Null byte in path (percent-encoded)
NULL_PATH_B64=$(printf '/smoke\x00path' | base64 | tr -d '\n')
http_check "GET /b.gif null byte in path returns 200" 200 \
  "$BASE_URL/b.gif?p=${NULL_PATH_B64}&_v=${VALID_V}&s=smoke-test"

# ── 6. Events endpoint /e — valid ────────────────────────────────────────────

section "Events Endpoint /e — Valid Requests"

http_check "POST /e valid bounce event returns 204" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Accept-Language: en-US" \
  -H "Origin: https://example.com" \
  -d '{"siteId":"smoke-test","events":[{"type":"bounce","data":{"duration":1500}}]}' \
  "$BASE_URL/e"

http_check "POST /e scroll_depth event returns 204" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"siteId":"smoke-test","events":[{"type":"scroll_depth","data":{"depth":75}}]}' \
  "$BASE_URL/e"

http_check "POST /e session_end event returns 204" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"siteId":"smoke-test","events":[{"type":"session_end","data":{"duration":30000}}]}' \
  "$BASE_URL/e"

http_check "POST /e custom event returns 204" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"siteId":"smoke-test","events":[{"type":"custom","data":{"name":"cta_click"}}]}' \
  "$BASE_URL/e"

# 20 events (max batch) — should accept all
MAX_EVENTS='{"siteId":"smoke-test","events":['
for i in $(seq 1 20); do
  [[ $i -gt 1 ]] && MAX_EVENTS+=','
  MAX_EVENTS+="{\"type\":\"click\",\"data\":{\"i\":$i}}"
done
MAX_EVENTS+=']}'

http_check "POST /e 20 events (max batch) returns 204" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$MAX_EVENTS" \
  "$BASE_URL/e"

# ── 7. Events endpoint /e — boundary + fuzz ──────────────────────────────────

section "Events Endpoint /e — Boundary + Fuzz"

# Empty body
http_check "POST /e empty body returns 400" 400 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '' \
  "$BASE_URL/e"

# Empty JSON object
http_check "POST /e {} body returns 204 (no events)" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "$BASE_URL/e"

# events array is empty
http_check "POST /e empty events array returns 204" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"siteId":"smoke-test","events":[]}' \
  "$BASE_URL/e"

# events is not an array
http_check "POST /e events is a string returns 204" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"siteId":"smoke-test","events":"boom"}' \
  "$BASE_URL/e"

# Payload exceeds 16 KB limit (17000 chars of data)
OVERSIZE_DATA=$(python3 -c "print('x'*17000)" 2>/dev/null || printf '%*s' 17000 '' | tr ' ' 'x')
http_check "POST /e oversized payload (>16KB) returns 413" 413 \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"siteId\":\"smoke-test\",\"events\":[{\"type\":\"custom\",\"data\":{\"x\":\"${OVERSIZE_DATA}\"}}]}" \
  "$BASE_URL/e"

# Unknown event type — should be silently dropped (204)
http_check "POST /e unknown event type returns 204" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"siteId":"smoke-test","events":[{"type":"__UNKNOWN__"}]}' \
  "$BASE_URL/e"

# Malformed JSON
http_check_range "POST /e malformed JSON returns 4xx" 400 499 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{bad json}' \
  "$BASE_URL/e"

# Wrong content-type
http_check_range "POST /e wrong Content-Type (text/plain) returns 2xx or 4xx" 200 499 \
  -X POST \
  -H "Content-Type: text/plain" \
  -d '{"siteId":"smoke-test","events":[{"type":"bounce"}]}' \
  "$BASE_URL/e"

# XSS in event data — must be accepted (stored as-is) but not cause 5xx
XSS_PAYLOAD='{"siteId":"smoke-test","events":[{"type":"custom","data":{"xss":"<script>alert(\"xss\")<\/script>"}}]}'
http_check "POST /e XSS in event data returns 204 (stored safely)" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$XSS_PAYLOAD" \
  "$BASE_URL/e"

# SQL injection in siteId
http_check "POST /e SQL injection in siteId returns 204" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"siteId":"smoke'"'"' OR '"'"'1'"'"'='"'"'1","events":[{"type":"bounce"}]}' \
  "$BASE_URL/e"

# Unicode / RTL / zero-width chars in event type and data
UNICODE_PAYLOAD='{"siteId":"smoke-test","events":[{"type":"custom","data":{"u":"\u200b\u202e\u0041\ufe0f\ud83d\ude00"}}]}'
http_check "POST /e unicode payload returns 204" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$UNICODE_PAYLOAD" \
  "$BASE_URL/e"

# 21 events (one over the MAX_EVENTS_PER_REQUEST limit of 20) — extra silently dropped
OVER_EVENTS='{"siteId":"smoke-test","events":['
for i in $(seq 1 21); do
  [[ $i -gt 1 ]] && OVER_EVENTS+=','
  OVER_EVENTS+="{\"type\":\"click\",\"data\":{\"i\":$i}}"
done
OVER_EVENTS+=']}'

http_check "POST /e 21 events (over limit) returns 204 (truncated)" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$OVER_EVENTS" \
  "$BASE_URL/e"

# Per-event data > 2 KB — that specific event should be silently skipped
BIG_DATA=$(python3 -c "print('y'*2100)" 2>/dev/null || printf '%*s' 2100 '' | tr ' ' 'y')
http_check "POST /e per-event data >2KB returns 204 (event skipped)" 204 \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"siteId\":\"smoke-test\",\"events\":[{\"type\":\"custom\",\"data\":{\"big\":\"${BIG_DATA}\"}}]}" \
  "$BASE_URL/e"

# GET is not handled — expect 405 or 404
http_check_range "GET /e returns 4xx (method not allowed)" 400 499 \
  "$BASE_URL/e"

# ── 8. /api/* auth enforcement ────────────────────────────────────────────────

section "API Auth Enforcement"

# /api/health is exempt from auth — must return 200 without token
http_check "GET /api/health no-auth returns 200" 200 \
  "$BASE_URL/api/health"

# Detect PUBLIC_MODE — in public mode, /api/stats/vitals returns 403 {"error":"redacted"}
# without auth, whereas in normal auth mode it returns 401.
PUBLIC_MODE_DETECTED=false
_PM_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time 10 "$BASE_URL/api/stats/vitals" 2>/dev/null) || _PM_STATUS="000"
_PM_BODY=$(curl -s --max-time 10 "$BASE_URL/api/stats/vitals" 2>/dev/null) || _PM_BODY=""
if [[ "$_PM_STATUS" == "403" ]] && echo "$_PM_BODY" | grep -q '"redacted"'; then
  PUBLIC_MODE_DETECTED=true
  info "PUBLIC_MODE detected — adjusting auth expectations"
fi

# All other /api/* endpoints must reject requests without auth
# We test with no auth header. If SECRET is empty the app runs in open mode and
# these will pass — that is a known deployment risk, not a test failure.
for ENDPOINT in \
  "/api/stats/summary" \
  "/api/stats/overview?site_id=smoke-test" \
  "/api/bots/suspicious" \
  "/api/bots/excluded" \
  "/api/experiments" \
  "/api/perf" \
  "/api/perf/trends" \
  "/api/stats/vitals" \
  "/api/stats/realtime?site_id=smoke-test" \
  "/api/stats/experiments"
do
  STATUS_NO_AUTH=$(curl -s -o /dev/null -w '%{http_code}' \
    --max-time 10 "$BASE_URL${ENDPOINT}" 2>/dev/null) || STATUS_NO_AUTH="000"

  if [[ "$PUBLIC_MODE_DETECTED" == true ]]; then
    # PUBLIC_MODE: GET requests bypass auth; /api/stats/vitals returns 403 (redacted)
    if [[ "$ENDPOINT" == "/api/stats/vitals" ]]; then
      if [[ "$STATUS_NO_AUTH" == "403" ]]; then
        pass "GET ${ENDPOINT} PUBLIC_MODE returns 403 (redacted)"
      else
        fail "GET ${ENDPOINT} PUBLIC_MODE — expected 403, got $STATUS_NO_AUTH"
      fi
    else
      if [[ "$STATUS_NO_AUTH" -ge 200 ]] && [[ "$STATUS_NO_AUTH" -lt 300 ]]; then
        pass "GET ${ENDPOINT} PUBLIC_MODE returns $STATUS_NO_AUTH (read-only access)"
      elif [[ "$STATUS_NO_AUTH" -ge 500 ]]; then
        fail "GET ${ENDPOINT} PUBLIC_MODE returned 5xx ($STATUS_NO_AUTH)"
      else
        pass "GET ${ENDPOINT} PUBLIC_MODE returns $STATUS_NO_AUTH"
      fi
    fi
  elif [[ -n "$SECRET" ]]; then
    # Auth is configured — unauthenticated request must get 401
    if [[ "$STATUS_NO_AUTH" == "401" ]]; then
      pass "GET ${ENDPOINT} no-auth returns 401"
    else
      fail "GET ${ENDPOINT} no-auth returned $STATUS_NO_AUTH (expected 401)"
    fi
  else
    # No secret configured — open mode, just check it doesn't 5xx
    if [[ "$STATUS_NO_AUTH" -ge 500 ]] 2>/dev/null; then
      fail "GET ${ENDPOINT} open-mode returned 5xx ($STATUS_NO_AUTH)"
    else
      warn "GET ${ENDPOINT} open-mode returned $STATUS_NO_AUTH (no SECRET set — admin is world-accessible)"
    fi
  fi
done

# Wrong Bearer token must return 401 when SECRET is set
if [[ -n "$SECRET" ]] && [[ "$PUBLIC_MODE_DETECTED" != true ]]; then
  STATUS_WRONG=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
    -H "Authorization: Bearer wrong-token-xxxxxxxx" \
    "$BASE_URL/api/stats/summary" 2>/dev/null) || STATUS_WRONG="000"
  if [[ "$STATUS_WRONG" == "401" ]]; then
    pass "GET /api/stats/summary wrong token returns 401"
  else
    fail "GET /api/stats/summary wrong token returned $STATUS_WRONG (expected 401)"
  fi
elif [[ "$PUBLIC_MODE_DETECTED" == true ]]; then
  info "Skipping wrong-token test (PUBLIC_MODE bypasses token auth for GET)"
fi

# ── 9. Authenticated API endpoints — structural checks ───────────────────────

section "API Endpoints — Authenticated Structural Checks"

if [[ ${#AUTH_HEADER[@]} -gt 0 ]] || [[ -z "$SECRET" ]] || [[ "$PUBLIC_MODE_DETECTED" == true ]]; then
  # /api/stats/summary — must return JSON with buffers and last_24h keys
  http_check "GET /api/stats/summary returns 200" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/stats/summary"
  if [[ "$PUBLIC_MODE_DETECTED" == true ]]; then
    # PUBLIC_MODE redacts the buffers key — verify it's absent
    if echo "$HTTP_BODY" | grep -q '"buffers"'; then
      fail "/api/stats/summary PUBLIC_MODE should redact buffers but found it"
    else
      pass "/api/stats/summary PUBLIC_MODE correctly redacts buffers"
    fi
  else
    if echo "$HTTP_BODY" | grep -q '"buffers"'; then
      pass "/api/stats/summary response contains buffers"
    else
      fail "/api/stats/summary response missing buffers key"
    fi
  fi

  # /api/stats/overview — missing site_id must return 400
  http_check "GET /api/stats/overview without site_id returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/stats/overview"

  # /api/stats/overview — valid site_id, various days values
  for DAYS in 1 7 30 90; do
    http_check "GET /api/stats/overview days=$DAYS returns 200" 200 \
      "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
      "$BASE_URL/api/stats/overview?site_id=smoke-test&days=${DAYS}"
  done

  # /api/stats/realtime — missing site_id must return 400
  http_check "GET /api/stats/realtime without site_id returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/stats/realtime"

  http_check "GET /api/stats/realtime with site_id returns 200" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/stats/realtime?site_id=smoke-test"

  # /api/bots/suspicious
  http_check "GET /api/bots/suspicious returns 200 JSON array" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/bots/suspicious"
  if echo "$HTTP_BODY" | grep -qE '^\['; then
    pass "/api/bots/suspicious returns a JSON array"
  else
    fail "/api/bots/suspicious does not return a JSON array (body: ${HTTP_BODY:0:100})"
  fi

  # /api/bots/suspicious — boundary params
  http_check "GET /api/bots/suspicious min_score=0 returns 200" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/bots/suspicious?min_score=0"

  http_check "GET /api/bots/suspicious limit=1 returns 200" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/bots/suspicious?limit=1"

  # /api/bots/excluded
  http_check "GET /api/bots/excluded returns 200" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/bots/excluded"

  # /api/experiments
  http_check "GET /api/experiments returns 200 JSON array" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/experiments"

  # /api/stats/experiments
  http_check "GET /api/stats/experiments returns 200" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/stats/experiments"

  # /api/stats/vitals — returns 403 in PUBLIC_MODE (redacted)
  if [[ "$PUBLIC_MODE_DETECTED" == true ]]; then
    http_check "GET /api/stats/vitals PUBLIC_MODE returns 403" 403 \
      "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
      "$BASE_URL/api/stats/vitals"
  else
    http_check "GET /api/stats/vitals returns 200" 200 \
      "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
      "$BASE_URL/api/stats/vitals"
  fi

  # /api/perf
  http_check "GET /api/perf returns 200 JSON array" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/perf"

  # /api/perf/trends
  http_check "GET /api/perf/trends returns 200" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    "$BASE_URL/api/perf/trends"
else
  warn "No --secret provided and ECHELON_SECRET is unset — skipping authenticated endpoint checks"
fi

# ── 10. /api/ingest — valid batch ────────────────────────────────────────────

section "API Ingest /api/ingest — Valid Batch"

if [[ ${#AUTH_HEADER[@]} -gt 0 ]] || [[ -z "$SECRET" ]]; then
  http_check "POST /api/ingest valid batch returns 200" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$VALID_BATCH" \
    "$BASE_URL/api/ingest"

  if echo "$HTTP_BODY" | grep -q '"accepted"'; then
    pass "/api/ingest response contains accepted field"
  else
    fail "/api/ingest response missing accepted field (body: $HTTP_BODY)"
  fi
else
  warn "Skipping /api/ingest auth-required test (no secret)"
fi

# ── 11. /api/ingest — malformed batches ──────────────────────────────────────

section "API Ingest /api/ingest — Malformed Batches"

if [[ ${#AUTH_HEADER[@]} -gt 0 ]] || [[ -z "$SECRET" ]]; then

  # Empty body
  http_check "POST /api/ingest empty body returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '' "$BASE_URL/api/ingest"

  # Wrong protocol version
  http_check "POST /api/ingest v=99 returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '{"v":99,"batch_id":"a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5","context":{"session_id":"b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6"},"events":[{"event_id":"c3d4e5f6-a7b8-4c9d-0e1f-a2b3c4d5e6f7","type":"click","ts":"2026-03-01T00:00:00Z"}]}' \
    "$BASE_URL/api/ingest"

  # Invalid batch_id (not UUID)
  http_check "POST /api/ingest invalid batch_id returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '{"v":1,"batch_id":"not-a-uuid","context":{"session_id":"b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6"},"events":[{"event_id":"c3d4e5f6-a7b8-4c9d-0e1f-a2b3c4d5e6f7","type":"click","ts":"2026-03-01T00:00:00Z"}]}' \
    "$BASE_URL/api/ingest"

  # Missing context
  http_check "POST /api/ingest missing context returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '{"v":1,"batch_id":"a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5","events":[]}' \
    "$BASE_URL/api/ingest"

  # Empty events array
  http_check "POST /api/ingest empty events array returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '{"v":1,"batch_id":"a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5","context":{"session_id":"b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6"},"events":[]}' \
    "$BASE_URL/api/ingest"

  # 101 events (one over max 100)
  BATCH_101='{"v":1,"batch_id":"a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5","context":{"session_id":"b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6"},"events":['
  for i in $(seq 1 101); do
    [[ $i -gt 1 ]] && BATCH_101+=','
    BATCH_101+="{\"event_id\":\"a1b2c3d4-e5f6-4a7b-8c9d-$(printf '%012d' $i)\",\"type\":\"click\",\"ts\":\"2026-03-01T00:00:00Z\"}"
  done
  BATCH_101+=']}'
  http_check "POST /api/ingest 101 events returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d "$BATCH_101" "$BASE_URL/api/ingest"

  # Event with invalid event_id
  http_check "POST /api/ingest invalid event_id returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '{"v":1,"batch_id":"a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5","context":{"session_id":"b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6"},"events":[{"event_id":"BAD-ID","type":"click","ts":"2026-03-01T00:00:00Z"}]}' \
    "$BASE_URL/api/ingest"

  # Event missing type
  http_check "POST /api/ingest event missing type returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '{"v":1,"batch_id":"a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5","context":{"session_id":"b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6"},"events":[{"event_id":"c3d4e5f6-a7b8-4c9d-0e1f-a2b3c4d5e6f7","ts":"2026-03-01T00:00:00Z"}]}' \
    "$BASE_URL/api/ingest"

  # XSS in event type
  http_check "POST /api/ingest XSS in event type returns 400 (fails UUID check)" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '{"v":1,"batch_id":"a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5","context":{"session_id":"b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6"},"events":[{"event_id":"BAD","type":"<script>alert(1)<\/script>","ts":"2026-03-01T00:00:00Z"}]}' \
    "$BASE_URL/api/ingest"

  # Deeply nested JSON object in event data
  DEEP_JSON='{"v":1,"batch_id":"a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5","context":{"session_id":"b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6"},"events":[{"event_id":"c3d4e5f6-a7b8-4c9d-0e1f-a2b3c4d5e6f7","type":"custom","ts":"2026-03-01T00:00:00Z","data":{"a":{"b":{"c":{"d":{"e":{"f":{"g":"deep"}}}}}}}}]}'
  http_check "POST /api/ingest deeply nested event data returns 200" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d "$DEEP_JSON" "$BASE_URL/api/ingest"

  # SQL injection in event type
  SQL_BATCH='{"v":1,"batch_id":"a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5","context":{"session_id":"b2c3d4e5-f6a7-4b8c-9d0e-f1a2b3c4d5e6"},"events":[{"event_id":"BAD","type":"click'"'"'; DROP TABLE semantic_events;--","ts":"2026-03-01T00:00:00Z"}]}'
  # This will fail UUID check for event_id and return 400 — that is correct
  http_check_range "POST /api/ingest SQL injection in event type returns 4xx" 400 499 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d "$SQL_BATCH" "$BASE_URL/api/ingest"

else
  warn "Skipping /api/ingest fuzz tests (no secret)"
fi

# ── 12. /api/perf ingest ──────────────────────────────────────────────────────

section "API Perf Ingest /api/perf"

if [[ ${#AUTH_HEADER[@]} -gt 0 ]] || [[ -z "$SECRET" ]]; then

  # Valid metric insert
  http_check "POST /api/perf valid metric returns 200" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '[{"category":"smoke","metric":"test_latency","value":42.5,"unit":"ms","commit_hash":"abc1234","branch":"smoke"}]' \
    "$BASE_URL/api/perf"

  if echo "$HTTP_BODY" | grep -q '"inserted"'; then
    pass "/api/perf insert response contains inserted field"
  else
    fail "/api/perf insert response missing inserted field"
  fi

  # Not an array
  http_check "POST /api/perf non-array body returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '{"category":"smoke","metric":"x","value":1,"unit":"ms"}' \
    "$BASE_URL/api/perf"

  # Missing required fields
  http_check "POST /api/perf missing unit returns 400" 400 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '[{"category":"smoke","metric":"x","value":1}]' \
    "$BASE_URL/api/perf"

  # Empty array
  http_check "POST /api/perf empty array returns 200 (0 inserted)" 200 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d '[]' "$BASE_URL/api/perf"

else
  warn "Skipping /api/perf ingest tests (no secret)"
fi

# ── 13. Admin panel ───────────────────────────────────────────────────────────

section "Admin Panel"

# Login page must serve HTML
STATUS_LOGIN=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
  "$BASE_URL/admin/login" 2>/dev/null) || STATUS_LOGIN="000"
if [[ "$STATUS_LOGIN" == "200" ]]; then
  pass "GET /admin/login returns 200"
else
  fail "GET /admin/login returned $STATUS_LOGIN (expected 200)"
fi

# Login page must contain the form
LOGIN_BODY=$(curl -s --max-time 10 "$BASE_URL/admin/login" 2>/dev/null)
if echo "$LOGIN_BODY" | grep -qi 'form\|username\|password\|authenticate'; then
  pass "/admin/login HTML contains form elements"
else
  fail "/admin/login HTML does not contain form elements"
fi

# Unauthenticated access to /admin must redirect to login (or be open if unconfigured)
ADMIN_REDIRECT=$(curl -s -o /dev/null -w '%{http_code}' \
  -A "$SMOKE_UA" --max-time 10 --max-redirs 0 \
  "$BASE_URL/admin" 2>/dev/null) || ADMIN_REDIRECT="000"
if [[ "$ADMIN_REDIRECT" == "303" ]] || [[ "$ADMIN_REDIRECT" == "302" ]]; then
  pass "GET /admin unauthenticated redirects to login ($ADMIN_REDIRECT)"
elif [[ "$ADMIN_REDIRECT" == "200" ]]; then
  warn "GET /admin returned 200 without auth — admin is fully open (no SECRET or USERNAME set)"
else
  fail "GET /admin returned unexpected $ADMIN_REDIRECT"
fi

# Wrong credentials must return 200 with error (not redirect)
if [[ -n "${ECHELON_USERNAME:-}" ]] || [[ -n "$SECRET" ]]; then
  WRONG_LOGIN=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "username=wrong&password=wrongpass" \
    "$BASE_URL/admin/login" 2>/dev/null) || WRONG_LOGIN="000"
  if [[ "$WRONG_LOGIN" == "200" ]]; then
    pass "POST /admin/login wrong credentials stays on login page (200)"
  else
    warn "POST /admin/login wrong credentials returned $WRONG_LOGIN (expected 200)"
  fi
fi

# ── 14. XSS reflection — unknown API routes ─────────────────────────────────

section "XSS Reflection Check"

# Unknown /api/* paths should return 404 without reflecting the path unsanitized
XSS_NAME="<script>alert(1)</script>"
XSS_NAME_ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${XSS_NAME}'))" 2>/dev/null || echo '%3Cscript%3Ealert%281%29%3C%2Fscript%3E')

XSS_REFLECT_BODY=$(curl -s -A "$SMOKE_UA" --max-time 5 \
  "$BASE_URL/api/${XSS_NAME_ENC}" 2>/dev/null)

if echo "$XSS_REFLECT_BODY" | grep -q '<script>'; then
  fail "[security] GET /api/<script> reflects unescaped XSS payload in body"
else
  pass "[security] GET /api/<script> does not reflect raw XSS"
fi

# ── 15. Rate limit behavior ───────────────────────────────────────────────────

section "Rate Limiting"

# The rate limiter is IP-based; in smoke test we are 127.0.0.1.
# The default window is 100 req/60s. We send 5 rapid requests and verify
# none fail with 5xx. A 429 at low count would indicate a misconfiguration.
RL_FAIL=0
for i in $(seq 1 5); do
  RL_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -A "$SMOKE_UA" --max-time 5 \
    "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=smoke-rl" 2>/dev/null) \
    || RL_STATUS="000"
  if [[ "$RL_STATUS" -ge 500 ]] 2>/dev/null; then
    RL_FAIL=$((RL_FAIL + 1))
  fi
done
if [[ $RL_FAIL -eq 0 ]]; then
  pass "Rate limiter: 5 rapid requests did not produce 5xx"
else
  fail "Rate limiter: $RL_FAIL of 5 rapid requests returned 5xx"
fi

# Spoofed X-Forwarded-For should not cause 5xx
http_check "Rate limit: spoofed X-Forwarded-For does not 5xx" 200 \
  -H "X-Forwarded-For: 10.0.0.1" \
  "$BASE_URL/b.gif?p=${VALID_PATH_B64}&_v=${VALID_V}&s=smoke-rl-spoof"

# ── 16. Performance regression testing ───────────────────────────────────────

if [[ "$FAST" == "true" ]]; then
  echo ""
  warn "Fast mode — skipping performance regression tests"
else

section "Performance Regression"

# Thresholds (milliseconds). These are conservative upper bounds for a
# newly-started container with an empty or small database.
# They exist to catch runaway queries (e.g. unbounded days param, missing index).
declare -A THRESHOLDS
THRESHOLDS["/api/health"]=200
THRESHOLDS["/api/stats/summary"]=500
THRESHOLDS["/api/stats/overview?site_id=smoke-test&days=30"]=1000
THRESHOLDS["/api/stats/overview?site_id=smoke-test&days=90"]=1500
THRESHOLDS["/api/stats/overview?site_id=smoke-test&days=365"]=2000
THRESHOLDS["/api/bots/suspicious"]=1000
THRESHOLDS["/api/bots/excluded"]=500
THRESHOLDS["/api/experiments"]=300
THRESHOLDS["/api/stats/experiments"]=1000
THRESHOLDS["/api/perf"]=300
THRESHOLDS["/api/perf/trends"]=500
THRESHOLDS["/b.gif"]=300
THRESHOLDS["/ea.js"]=200

# Also exercise some extreme days values to confirm no query explosion
THRESHOLDS["/api/stats/overview?site_id=smoke-test&days=9999"]=3000

declare -A OBSERVED

for ENDPOINT in "${!THRESHOLDS[@]}"; do
  # Build the full URL
  FULL_URL="${BASE_URL}${ENDPOINT}"

  # Choose correct auth
  CURL_ARGS=()
  if echo "$ENDPOINT" | grep -q '^/api/' && ! echo "$ENDPOINT" | grep -q '^/api/health'; then
    CURL_ARGS=("${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}")
  fi

  timed_get "$FULL_URL" "${CURL_ARGS[@]+"${CURL_ARGS[@]}"}"

  OBSERVED["$ENDPOINT"]=$ELAPSED_MS
  THRESHOLD="${THRESHOLDS[$ENDPOINT]}"

  if [[ "$HTTP_STATUS" -ge 500 ]] 2>/dev/null; then
    fail "PERF ${ENDPOINT} returned 5xx (${HTTP_STATUS}) — skipping timing check"
  elif [[ "$ELAPSED_MS" -le "$THRESHOLD" ]]; then
    pass "PERF ${ENDPOINT} ${ELAPSED_MS}ms <= ${THRESHOLD}ms threshold"
  else
    warn "PERF ${ENDPOINT} ${ELAPSED_MS}ms EXCEEDS ${THRESHOLD}ms threshold"
  fi
done

# ── Baseline file management ──────────────────────────────────────────────────

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
GIT_HASH=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")

if [[ ! -f "$BASELINE_FILE" ]]; then
  info "Creating initial performance baseline at $BASELINE_FILE"
  mkdir -p "$(dirname "$BASELINE_FILE")"

  echo "{" > "$BASELINE_FILE"
  echo "  \"created_at\": \"${TIMESTAMP}\"," >> "$BASELINE_FILE"
  echo "  \"commit\": \"${GIT_HASH}\"," >> "$BASELINE_FILE"
  echo "  \"note\": \"Initial baseline — generated by smoke-test.sh. Values are observed timings in ms. Edit thresholds manually if needed.\"," >> "$BASELINE_FILE"
  echo "  \"endpoints\": {" >> "$BASELINE_FILE"

  FIRST=true
  for EP in "${!OBSERVED[@]}"; do
    [[ "$FIRST" == "false" ]] && echo "," >> "$BASELINE_FILE"
    printf '    "%s": %d' "$EP" "${OBSERVED[$EP]}" >> "$BASELINE_FILE"
    FIRST=false
  done
  echo "" >> "$BASELINE_FILE"
  echo "  }" >> "$BASELINE_FILE"
  echo "}" >> "$BASELINE_FILE"

  pass "Performance baseline created ($BASELINE_FILE)"
else
  # Compare against stored baseline — warn on regressions >= 2x
  info "Comparing against baseline ($BASELINE_FILE, commit: $GIT_HASH)"

  REGRESSION_COUNT=0
  for EP in "${!OBSERVED[@]}"; do
    CURRENT="${OBSERVED[$EP]}"
    # Use python3 to parse JSON portably (jq may not be installed)
    BASELINE_VAL=$(python3 -c "
import json, sys
with open('${BASELINE_FILE}') as f:
    d = json.load(f)
val = d.get('endpoints', {}).get('${EP}')
if val is not None:
    print(val)
else:
    print(-1)
" 2>/dev/null || echo "-1")

    if [[ "$BASELINE_VAL" == "-1" ]]; then
      info "PERF ${EP} — no baseline entry yet (current: ${CURRENT}ms)"
    else
      # Regression threshold: current > baseline * 2.0
      REGRESSION_THRESHOLD=$(python3 -c "print(int(${BASELINE_VAL} * 2.0))")
      if [[ "$CURRENT" -gt "$REGRESSION_THRESHOLD" ]]; then
        warn "PERF REGRESSION ${EP}: ${CURRENT}ms vs baseline ${BASELINE_VAL}ms (${REGRESSION_THRESHOLD}ms limit, 2x factor)"
        REGRESSION_COUNT=$((REGRESSION_COUNT + 1))
      else
        pass "PERF regression check ${EP}: ${CURRENT}ms vs baseline ${BASELINE_VAL}ms"
      fi
    fi
  done

  if [[ "$REGRESSION_COUNT" -gt 0 ]]; then
    warn "$REGRESSION_COUNT endpoint(s) show performance regression (>2x baseline)"
    warn "Update $BASELINE_FILE if regression is intentional."
  else
    pass "No performance regressions detected"
  fi

  # Write a new datapoint into the perf_metrics table via the API
  # so the admin perf chart accumulates smoke test timings over time.
  if [[ ${#AUTH_HEADER[@]} -gt 0 ]] || [[ -z "$SECRET" ]]; then
    METRICS_JSON="["
    FIRST=true
    for EP in "${!OBSERVED[@]}"; do
      [[ "$FIRST" == "false" ]] && METRICS_JSON+=","
      METRIC_NAME=$(echo "$EP" | tr '/?=&' '_' | sed 's/^_//')
      METRICS_JSON+="{\"category\":\"smoke\",\"metric\":\"${METRIC_NAME}\",\"value\":${OBSERVED[$EP]},\"unit\":\"ms\",\"commit_hash\":\"${GIT_HASH}\",\"branch\":\"smoke\"}"
      FIRST=false
    done
    METRICS_JSON+="]"

    PERF_POST=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
      "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
      -X POST -H "Content-Type: application/json" \
      -d "$METRICS_JSON" \
      "$BASE_URL/api/perf" 2>/dev/null) || PERF_POST="000"

    if [[ "$PERF_POST" == "200" ]]; then
      pass "Smoke test timings recorded to /api/perf for trend tracking"
    else
      warn "Could not record timings to /api/perf (HTTP $PERF_POST)"
    fi
  fi
fi

fi  # end $FAST check

# ── 17. Error message leak check ─────────────────────────────────────────────

section "Error Message / Info Leak Checks"

# 404 responses must not leak stack traces or internal paths
NOT_FOUND_BODY=$(curl -s --max-time 5 "$BASE_URL/this/path/does/not/exist" 2>/dev/null)
if echo "$NOT_FOUND_BODY" | grep -qiE 'at Object\.|TypeError|Error:|stack:|\.ts:[0-9]|/app/'; then
  fail "[security] 404 response leaks internal error details"
else
  pass "[security] 404 response does not leak stack traces or internal paths"
fi

# 5xx responses on auth endpoints must not leak internals
if [[ ${#AUTH_HEADER[@]} -gt 0 ]] || [[ -z "$SECRET" ]]; then
  BAD_BODY=$(curl -s --max-time 5 \
    "${AUTH_HEADER[@]+"${AUTH_HEADER[@]}"}" \
    -X POST -H "Content-Type: application/json" \
    -d 'NOT JSON AT ALL ////' \
    "$BASE_URL/api/ingest" 2>/dev/null)
  if echo "$BAD_BODY" | grep -qiE 'at Object\.|stack:|\.ts:[0-9]|/app/echelon'; then
    fail "[security] /api/ingest bad JSON response leaks internal error details"
  else
    pass "[security] /api/ingest bad JSON error response is clean"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "=============================================="
if [[ "$FAILURES" -eq 0 ]]; then
  printf "${_PASS}  ALL CHECKS PASSED${_RESET}\n"
  echo "=============================================="
  exit 0
else
  printf "${_FAIL}  $FAILURES CHECK(S) FAILED${_RESET}\n"
  echo "=============================================="
  exit 1
fi
