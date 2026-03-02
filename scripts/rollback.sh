#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="echelon"
CONTAINER_PREFIX="echelon"
PORT="1947"
BIND_ADDRESS="127.0.0.1"

# Load BIND_ADDRESS from .env if present
if [[ -f .env ]]; then
  env_bind=$(grep -E '^BIND_ADDRESS=' .env | cut -d= -f2 | tr -d '[:space:]')
  [[ -n "$env_bind" ]] && BIND_ADDRESS="$env_bind"
fi

# ── Helpers ──────────────────────────────────────────────────────────────────

red()   { printf '\033[1;31m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info()  { printf '\033[1;34m→ %s\033[0m\n' "$*"; }

die() { red "ERROR: $*" >&2; exit 1; }

# ── List available versions ──────────────────────────────────────────────────

list_versions() {
  echo "Available $IMAGE versions:"
  echo ""
  docker images "$IMAGE" --format 'table {{.Tag}}\t{{.CreatedAt}}\t{{.Size}}' \
    | grep -v '<none>' \
    | grep -v 'latest'
  echo ""

  OLD=$(docker ps -q -f "name=^${CONTAINER_PREFIX}-v" | head -1)
  if [[ -n "$OLD" ]]; then
    OLD_NAME=$(docker inspect --format '{{.Name}}' "$OLD" | sed 's|^/||')
    echo "Currently running: $OLD_NAME"
  else
    echo "No $CONTAINER_PREFIX container is currently running."
  fi
}

# ── No argument: list and exit ───────────────────────────────────────────────

if [[ -z "${1:-}" ]]; then
  list_versions
  echo ""
  echo "Usage: $0 <version>  (e.g. $0 v26-03-01)"
  exit 0
fi

# ── Rollback to specified version ────────────────────────────────────────────

VERSION="$1"
[[ "$VERSION" != v* ]] && VERSION="v$VERSION"
CONTAINER="${CONTAINER_PREFIX}-${VERSION}"

if ! docker image inspect "$IMAGE:$VERSION" >/dev/null 2>&1; then
  die "Image $IMAGE:$VERSION not found. Run '$0' with no arguments to list available versions."
fi

if docker ps -q -f "name=^${CONTAINER}$" | grep -q .; then
  die "Already running $CONTAINER"
fi

info "Rolling back to $IMAGE:$VERSION"

OLD=$(docker ps -q -f "name=^${CONTAINER_PREFIX}-v" | head -1)
if [[ -n "$OLD" ]]; then
  OLD_NAME=$(docker inspect --format '{{.Name}}' "$OLD" | sed 's|^/||')
  info "Stopping $OLD_NAME (30s grace period)"
  docker stop --time=30 "$OLD" >/dev/null
  docker rm "$OLD" >/dev/null
fi

# Load env vars from .env (handles values containing =)
ENV_ARGS=()
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line// /}" || "$line" == \#* ]] && continue
    [[ "$line" != *"="* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    value="${value%\"}" ; value="${value#\"}"
    value="${value%\'}" ; value="${value#\'}"
    ENV_ARGS+=(-e "$key=$value")
  done < .env
fi

info "Starting $CONTAINER"
docker run -d \
  --name "$CONTAINER" \
  -p "${BIND_ADDRESS}:${PORT}:${PORT}" \
  -v "$(pwd)/data:/app/data" \
  -e "VERSION=$VERSION" \
  --add-host=host.docker.internal:host-gateway \
  "${ENV_ARGS[@]+"${ENV_ARGS[@]}"}" \
  --restart unless-stopped \
  "$IMAGE:$VERSION" >/dev/null

# Health check
info "Waiting for health check"
passed=false
for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    passed=true
    break
  fi
  sleep 1
done

if [[ "$passed" == "true" ]]; then
  green "Rollback to $CONTAINER complete — health check passed"
else
  red "WARNING: Health check did not pass within 15s"
  red "Container logs:"
  docker logs "$CONTAINER" --tail 20
fi
