#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

red()   { printf '\033[1;31m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }
info()  { printf '\033[1;34m→ %s\033[0m\n' "$*"; }

usage() {
  cat <<EOF
Usage: $0 [OPTIONS] [<comment>]

Create and push a semantic version git tag from the main branch.

By default, increments the patch version (e.g. v0.1.0 → v0.1.1).
For major/minor bumps, specify --major or --minor explicitly.

Options:
  --major                Bump the major version   (e.g. v0.1.1 → v1.0.0)
  --minor                Bump the minor version   (e.g. v0.1.1 → v0.2.0)
  --patch                Bump the patch version    (default)
  --tag <version>        Use an exact tag          (e.g. --tag v2.0.0)
  --latest-commit-msg    Use the latest commit's subject line as the comment
  --stay-in-main         Stay on the main branch after tagging
  -h, --help             Show this help message and exit

Examples:
  $0 "Fix CORS handling"                   # auto-increment patch
  $0 --minor "Add site selector"           # bump minor
  $0 --tag v1.0.0 "Initial stable release" # exact tag
EOF
}

# ── Argument parsing ─────────────────────────────────────────────────────────

STAY_IN_MAIN=false
COMMENT=""
BUMP="patch"
EXACT_TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)            usage; exit 0 ;;
    --stay-in-main)       STAY_IN_MAIN=true; shift ;;
    --latest-commit-msg)  COMMENT="$(git log -1 --format=%s)"; shift ;;
    --major)              BUMP="major"; shift ;;
    --minor)              BUMP="minor"; shift ;;
    --patch)              BUMP="patch"; shift ;;
    --tag)                BUMP="exact"; EXACT_TAG="${2:-}"; shift; shift ;;
    *)                    COMMENT="$1"; shift ;;
  esac
done

# For --tag without a comment, default to latest commit message
if [[ -z "$COMMENT" ]]; then
  if [[ "$BUMP" == "exact" ]]; then
    COMMENT="$(git log -1 --format=%s)"
  else
    usage; exit 1
  fi
fi

# ── Validate semver format ───────────────────────────────────────────────────

is_semver() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
}

# ── Only allow tagging from main ─────────────────────────────────────────────

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" != "main" ]] && {
  red "Error: releases can only be tagged from the main branch (current: $BRANCH)"
  exit 1
}

# ── Abort if tree is identical to latest tag ─────────────────────────────────

LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [[ -n "$LATEST_TAG" ]]; then
  LATEST_TAG_TREE=$(git rev-parse "${LATEST_TAG}^{tree}")
  CURRENT_TREE=$(git rev-parse HEAD^{tree})
  if [[ "$LATEST_TAG_TREE" == "$CURRENT_TREE" ]]; then
    red "Error: no file changes since tag $LATEST_TAG (tree hash: ${CURRENT_TREE:0:12})"
    exit 1
  fi
fi

# ── Determine next version ───────────────────────────────────────────────────

if [[ "$BUMP" == "exact" ]]; then
  [[ -z "$EXACT_TAG" ]] && { red "Error: --tag requires a version (e.g. --tag v1.0.0)"; exit 1; }
  is_semver "$EXACT_TAG" || { red "Error: '$EXACT_TAG' is not valid semver (expected vMAJOR.MINOR.PATCH)"; exit 1; }
  TAG="$EXACT_TAG"
else
  if [[ -z "$LATEST_TAG" ]]; then
    # No tags yet — start at v0.1.0
    TAG="v0.1.0"
    info "No existing tags found, starting at $TAG"
  elif ! is_semver "$LATEST_TAG"; then
    red "Error: latest tag '$LATEST_TAG' is not valid semver (expected vMAJOR.MINOR.PATCH)"
    red "Use --tag vX.Y.Z to set an explicit starting version"
    exit 1
  else
    # Parse current version
    version="${LATEST_TAG#v}"
    IFS='.' read -r major minor patch <<< "$version"

    case "$BUMP" in
      major) major=$((major + 1)); minor=0; patch=0 ;;
      minor) minor=$((minor + 1)); patch=0 ;;
      patch) patch=$((patch + 1)) ;;
    esac

    TAG="v${major}.${minor}.${patch}"
  fi
fi

# Check the tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  red "Error: tag $TAG already exists"
  exit 1
fi

MESSAGE="Release ${TAG} — ${COMMENT}"

# ── Run checks before tagging ────────────────────────────────────────────────

info "Running checks before tagging"
(cd echelon-analytics && deno task check) || { red "deno task check failed — fix before tagging"; exit 1; }
green "All checks passed"

# ── Tag and push ─────────────────────────────────────────────────────────────

info "Tagging $TAG"
git tag -a "$TAG" -m "$MESSAGE"
if ! git push origin "$TAG"; then
  git tag -d "$TAG"
  red "Push failed — local tag $TAG removed"
  exit 1
fi
green "Tagged and pushed: $TAG"
echo "  $MESSAGE"

if [[ "$STAY_IN_MAIN" == false ]]; then
  git checkout dev 2>/dev/null && green "Switched back to dev branch" || true
fi
