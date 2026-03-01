#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# ── Prevent concurrent deploys ───────────────────────────────────────────────
LOCK_FILE="/tmp/echelon-deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "ERROR: Another deploy is already running (lock: $LOCK_FILE)" >&2
  exit 1
fi

IMAGE="echelon"
CONTAINER_PREFIX="echelon"
PORT="1947"
BIND_ADDRESS="127.0.0.1"
ALLOWED_IPS=""
KEEP_IMAGES=3
SMOKE_TIMEOUT=15

# ── Helpers ──────────────────────────────────────────────────────────────────

red()   { printf '\033[1;31m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info()  { printf '\033[1;34m→ %s\033[0m\n' "$*"; }

die() { prune_images; red "ERROR: $*" >&2; exit 1; }

prune_images() {
  info "Pruning unused Docker images"
  # Remove dangling images (untagged layers from builds)
  docker image prune -f >/dev/null 2>&1 || true
  # Remove stopped containers older than 1h (stale smoke tests, old deploys)
  docker container prune -f --filter "until=1h" >/dev/null 2>&1 || true
  # Remove unused images older than 1h not referenced by any container
  docker image prune -a -f --filter "until=1h" >/dev/null 2>&1 || true
}

# ── Validate ─────────────────────────────────────────────────────────────────

VERSION=""
DEPLOY_LATEST=false
REDEPLOY=false
CPU_CORES=1
NETWORK=""

# Load defaults from .env if present
if [[ -f .env ]]; then
  env_cores=$(grep -E '^CPU_CORES=' .env | cut -d= -f2 | tr -d '[:space:]' || true)
  [[ -n "$env_cores" ]] && CPU_CORES="$env_cores"
  env_bind=$(grep -E '^BIND_ADDRESS=' .env | cut -d= -f2 | tr -d '[:space:]' || true)
  [[ -n "$env_bind" ]] && BIND_ADDRESS="$env_bind"
  env_ips=$(grep -E '^ALLOWED_IPS=' .env | cut -d= -f2 | tr -d '[:space:]' || true)
  [[ -n "$env_ips" ]] && ALLOWED_IPS="$env_ips"
  env_net=$(grep -E '^DOCKER_NETWORK=' .env | cut -d= -f2 | tr -d '[:space:]' || true)
  [[ -n "$env_net" ]] && NETWORK="$env_net"
fi

show_help() {
  echo "Usage: $0 [<tag>] [OPTIONS]"
  echo ""
  echo "Build, smoke-test, and deploy an Echelon Analytics Docker container."
  echo ""
  echo "Arguments:"
  echo "  <tag>                   Git tag to deploy (e.g. v26-03-01)"
  echo ""
  echo "Options:"
  echo "  --deploy-latest         Deploy the most recent git tag"
  echo "  --cpucores N            Limit container to N CPU cores (default from .env or 1)"
  echo "  --redeploy              Fast-track redeploy of an existing image (skip build + smoke)"
  echo "  --network NAME          Join Docker network (for Postgres connectivity)"
  echo "  --help                  Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0 v26-03-01                     Deploy specific tag"
  echo "  $0 --deploy-latest               Deploy latest tag"
  echo "  $0 --deploy-latest --cpucores 2  Latest tag, 2 cores"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) show_help ;;
    --deploy-latest) DEPLOY_LATEST=true; shift ;;
    --redeploy) REDEPLOY=true; shift ;;
    --cpucores) CPU_CORES="$2"; shift 2 ;;
    --network) NETWORK="$2"; shift 2 ;;
    *) VERSION="$1"; shift ;;
  esac
done

if ! [[ "$CPU_CORES" =~ ^[0-9]+$ ]] || [[ "$CPU_CORES" -lt 1 ]]; then
  die "--cpucores must be a positive integer"
fi

# Enforce main-only deploys
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  die "Production deploys must run from the main branch (current: $CURRENT_BRANCH)"
fi

# Pull latest code and tags
info "Pulling latest changes"
git pull --tags

if [[ "$DEPLOY_LATEST" == "true" ]]; then
  VERSION=$(set +o pipefail; git tag -l --sort=-version:refname | head -1)
  if [[ -z "$VERSION" ]]; then
    die "No tags found. Create one first with scripts/tag-release.sh"
  fi
  info "Selected latest tag: $VERSION"
fi

if [[ -z "$VERSION" ]]; then
  echo "Latest 5 tags:"
  echo ""
  (set +o pipefail; git tag -l --sort=-version:refname | head -5) | while read -r tag; do
    msg=$(git tag -l -n1 "$tag" | sed "s/^$tag\s*//")
    printf "  %-16s %s\n" "$tag" "$msg"
  done
  echo ""
  echo "Usage: $0 <tag> [--deploy-latest] [--redeploy] [--cpucores N]"
  exit 0
fi

GIT_TAG="$VERSION"
[[ "$VERSION" != v* ]] && GIT_TAG="v$VERSION"

if ! git rev-parse "$GIT_TAG" >/dev/null 2>&1; then
  die "Git tag $GIT_TAG not found. Create one first with scripts/tag-release.sh"
fi

DEPLOY_START=$SECONDS

# ── Redeploy check ──────────────────────────────────────────────────────────

if [[ "$REDEPLOY" == "true" ]]; then
  if ! docker image inspect "$IMAGE:$GIT_TAG" >/dev/null 2>&1; then
    die "Image $IMAGE:$GIT_TAG not found. Cannot --redeploy without an existing image."
  fi
  info "Fast-track redeploy — skipping build and smoke test"
fi

info "Deploying $IMAGE:$GIT_TAG"

# ── Build ────────────────────────────────────────────────────────────────────

if [[ "$REDEPLOY" == "true" ]]; then
  info "Skipping Docker build (--redeploy)"
else
  info "Building Docker image (checks run inside build stage)"
  DOCKER_BUILDKIT=0 docker build \
    -f confs/Dockerfile \
    --build-arg "VERSION=$GIT_TAG" \
    --build-arg "GIT_HASH=$(git rev-parse --short HEAD)" \
    -t "$IMAGE:$GIT_TAG" \
    .
  green "Build succeeded"
fi

# ── Load env vars from .env ─────────────────────────────────────────────────

ENV_ARGS=()
if [[ -f .env ]]; then
  info "Loading env vars from .env"
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

# ── Docker network ──────────────────────────────────────────────────────────

NETWORK_ARGS=()
if [[ -n "$NETWORK" ]]; then
  info "Docker network: $NETWORK"
  NETWORK_ARGS=(--network "$NETWORK")
fi

# ── Smoke test ───────────────────────────────────────────────────────────────

CONTAINER="${CONTAINER_PREFIX}-${GIT_TAG}_cpu-${CPU_CORES}"

# Ensure data directory exists and is writable by the container user (UID 1001)
mkdir -p data
chown 1001:1001 data

if [[ "$REDEPLOY" == "true" ]]; then
  info "Skipping smoke test (--redeploy)"
else
  info "Running smoke test"
  SMOKE_NAME="${CONTAINER_PREFIX}-smoke-$$"

  docker run -d \
    --name "$SMOKE_NAME" \
    -p "127.0.0.1:0:$PORT" \
    -v "$(pwd)/data:/app/data" \
    --add-host=host.docker.internal:host-gateway \
    --cpuset-cpus="0-$((CPU_CORES - 1))" \
    "${NETWORK_ARGS[@]+"${NETWORK_ARGS[@]}"}" \
    "${ENV_ARGS[@]+"${ENV_ARGS[@]}"}" \
    "$IMAGE:$GIT_TAG" >/dev/null

  SMOKE_PORT=$(docker port "$SMOKE_NAME" "$PORT/tcp" | head -1 | cut -d: -f2)

  smoke_cleanup() {
    docker rm -f "$SMOKE_NAME" >/dev/null 2>&1 || true
  }
  trap smoke_cleanup EXIT

  passed=false
  for i in $(seq 1 "$SMOKE_TIMEOUT"); do
    http_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/api/health" 2>/dev/null) || http_code="000"
    if [[ "$http_code" == "200" ]]; then
      passed=true
      break
    fi
    if (( i % 5 == 0 )); then
      container_status=$(docker inspect -f '{{.State.Status}}' "$SMOKE_NAME" 2>/dev/null || echo "unknown")
      printf '  [%2d/%ds] status=%s http=%s\n' "$i" "$SMOKE_TIMEOUT" "$container_status" "$http_code"
      if [[ "$container_status" == "exited" ]]; then
        red "Container exited prematurely!"
        break
      fi
    fi
    sleep 1
  done

  if [[ "$passed" != "true" ]]; then
    red "Smoke test failed — /api/health did not return 200 within ${SMOKE_TIMEOUT}s"
    red "Container logs (last 50 lines):"
    docker logs "$SMOKE_NAME" --tail 50 2>&1 || true
    smoke_cleanup
    trap - EXIT
    exit 1
  fi

  # ── Full smoke + fuzz + perf test suite ────────────────────────────────────
  info "Running full smoke test suite"
  SMOKE_SECRET=""
  if [[ -f .env ]]; then
    SMOKE_SECRET=$(grep -E '^ECHELON_SECRET=' .env | cut -d= -f2 | tr -d '[:space:]' || true)
  fi

  SMOKE_ARGS=("http://127.0.0.1:${SMOKE_PORT}")
  [[ -n "$SMOKE_SECRET" ]] && SMOKE_ARGS+=(--secret "$SMOKE_SECRET")

  if ! ECHELON_SECRET="$SMOKE_SECRET" bash "$(dirname "$0")/smoke-test.sh" "${SMOKE_ARGS[@]}"; then
    red "Smoke test suite FAILED"
    red "Container logs (last 30 lines):"
    docker logs "$SMOKE_NAME" --tail 30 2>&1 || true
    smoke_cleanup
    trap - EXIT
    exit 1
  fi

  green "Smoke test suite passed"

  smoke_cleanup
  trap - EXIT
fi

# ── Firewall (optional IP restriction) ──────────────────────────────────────

if [[ -n "$ALLOWED_IPS" ]]; then
  info "Configuring firewall rules for port $PORT"
  sudo iptables -D INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null || true
  IFS=',' read -ra IPS <<< "$ALLOWED_IPS"
  for ip in "${IPS[@]}"; do
    ip=$(echo "$ip" | tr -d '[:space:]')
    [[ -z "$ip" ]] && continue
    sudo iptables -I INPUT -p tcp --dport "$PORT" -s "$ip" -j ACCEPT
  done
  sudo iptables -A INPUT -p tcp --dport "$PORT" -j DROP
  green "Firewall: allowed ${#IPS[@]} IP(s), blocked all others on port $PORT"
fi

# ── Deploy: stop old, start new ─────────────────────────────────────────────

OLD=$(docker ps -q -f "name=^${CONTAINER_PREFIX}-v" | head -1)
OLD_NAME=""
if [[ -n "$OLD" ]]; then
  OLD_NAME=$(docker inspect --format '{{.Name}}' "$OLD" | sed 's|^/||')
  info "Stopping $OLD_NAME (30s grace period for buffer flush)"
  docker stop --time=30 "$OLD" >/dev/null
  docker rm "$OLD" >/dev/null
fi

info "Starting $CONTAINER"
docker run -d \
  --name "$CONTAINER" \
  -p "${BIND_ADDRESS}:${PORT}:${PORT}" \
  -v "$(pwd)/data:/app/data" \
  -e "VERSION=$GIT_TAG" \
  --add-host=host.docker.internal:host-gateway \
  --cpuset-cpus="0-$((CPU_CORES - 1))" \
  "${NETWORK_ARGS[@]+"${NETWORK_ARGS[@]}"}" \
  "${ENV_ARGS[@]+"${ENV_ARGS[@]}"}" \
  --restart unless-stopped \
  --log-driver json-file \
  --log-opt max-size=50m \
  --log-opt max-file=5 \
  --memory 512m \
  "$IMAGE:$GIT_TAG" >/dev/null

# ── Live health check ───────────────────────────────────────────────────────

info "Waiting for health check"
passed=false
for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    passed=true
    break
  fi
  sleep 1
done

if [[ "$passed" != "true" ]]; then
  red "Health check failed — automatic rollback"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

  if [[ -n "$OLD_NAME" ]]; then
    info "Restarting previous container: $OLD_NAME"
    docker start "$OLD_NAME" >/dev/null 2>&1 || true
    red "Rolled back to $OLD_NAME"
  else
    red "No previous container to rollback to"
  fi

  red "Deployment FAILED"
  docker logs "$CONTAINER" --tail 30 2>&1 || true
  exit 1
fi

green "Health check passed"

# ── Prune old images ────────────────────────────────────────────────────────

if [[ "$KEEP_IMAGES" -gt 0 ]]; then
  old_images=$(docker images "$IMAGE" --format '{{.Tag}}' \
    | grep -v '<none>' \
    | grep -v 'latest' \
    | sort -V \
    | head -n -"$KEEP_IMAGES" || true)

  for old_tag in $old_images; do
    info "Removing old image: $IMAGE:$old_tag"
    docker rmi "$IMAGE:$old_tag" >/dev/null 2>&1 || true
  done
fi

prune_images

# ── Summary ──────────────────────────────────────────────────────────────────

ELAPSED=$(( SECONDS - DEPLOY_START ))
echo ""
green "Deployment complete in ${ELAPSED}s"
echo "  Image:     $IMAGE:$GIT_TAG"
echo "  Container: $CONTAINER"
echo "  Port:      ${BIND_ADDRESS}:${PORT}"
echo "  CPU cores: $CPU_CORES"
