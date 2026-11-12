#!/usr/bin/env bash
# Commits one county's validation results to the `validation-results` branch and pushes it.
# Run by each leg of .github/workflows/county-validation.yml right after validation, so results
# reach the branch over plain git even when the Actions artifact service is down. See
# validation/README.md, "Where results live".
#
# Usage (from inside a clone whose `origin` is the repository):
#   COUNTY=kootenai RESULTS_DIR=validation-results RUN_ID=123 bash scripts/publish-validation-results.sh
#
# Environment:
#   COUNTY       county file name (required, lowercase letters, digits and dashes)
#   RESULTS_DIR  directory holding <county>.json, .md, -changes.md, -alert.json, -discovered.json
#   RUN_ID       GitHub Actions run id (required, digits)
#   BRANCH       results branch (default validation-results). Any other branch is refused unless
#                PUBLISH_TEST_MODE=1 (tests only); main and master are always refused.
#   REMOTE       git remote (default origin)
#   DATE         UTC date for history/ (default today)
#   ATTEMPTS     push attempts (default 5)
#   RETRY_SECONDS base pause between attempts in seconds (default 5; attempt n waits n*base plus
#                up to 4 s of jitter, or nothing when 0)
#
# Each attempt rebuilds the commit on top of the branch as the remote has it right now and only
# touches this county's files, so a push rejected because another leg or run pushed first always
# succeeds on a later attempt (no merge, no --force). A missing report is a warning, not a failure.
set -euo pipefail

: "${COUNTY:?COUNTY is required}"
: "${RESULTS_DIR:?RESULTS_DIR is required}"
: "${RUN_ID:?RUN_ID is required}"
BRANCH=${BRANCH:-validation-results}
REMOTE=${REMOTE:-origin}
DATE=${DATE:-$(date -u +%F)}
ATTEMPTS=${ATTEMPTS:-5}
RETRY_SECONDS=${RETRY_SECONDS:-5}

case "$BRANCH" in
  main|master) echo "::error::Refusing to publish to $BRANCH." >&2; exit 1 ;;
  validation-results) ;;
  *)
    if [ "${PUBLISH_TEST_MODE:-}" != "1" ]; then
      echo "::error::Refusing to publish to $BRANCH (only validation-results is allowed)." >&2; exit 1
    fi ;;
esac
case "$COUNTY" in *[!a-z0-9-]*|'') echo "::error::Invalid county name." >&2; exit 1 ;; esac
case "$RUN_ID" in *[!0-9]*|'') echo "::error::RUN_ID must be digits." >&2; exit 1 ;; esac
case "$DATE" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) echo "::error::DATE must be YYYY-MM-DD." >&2; exit 1 ;; esac

SRC=$(cd "$RESULTS_DIR" 2>/dev/null && pwd) || SRC=''
if [ -z "$SRC" ] || [ ! -f "$SRC/$COUNTY.json" ]; then
  echo "::warning::No results for $COUNTY (its validation step failed before writing a report); nothing published."
  exit 0
fi

git config user.name >/dev/null || git config user.name 'github-actions[bot]'
git config user.email >/dev/null || git config user.email '41898282+github-actions[bot]@users.noreply.github.com'

WORK=$(mktemp -d)
TREE="$WORK/tree"
cleanup() {
  git worktree remove --force "$TREE" >/dev/null 2>&1 || true
  git worktree prune
  git branch -D "$BRANCH-new-$RUN_ID-$COUNTY" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

failed=$(jq -r '.summary.failed // "unknown"' "$SRC/$COUNTY.json")
discovered=$(jq -r '.discovered // false' "$SRC/$COUNTY.json")

# Builds one commit for this county on top of the remote branch. Sets $made to 0 or 1.
build() {
  cleanup
  mkdir -p "$WORK"
  set +e; git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null; exists=$?; set -e
  if [ "$exists" -eq 0 ]; then
    git fetch -q --depth=1 "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"
    git worktree add -q --detach "$TREE" "$REMOTE/$BRANCH"
  elif [ "$exists" -eq 2 ]; then
    echo "No $BRANCH branch yet; starting it as an orphan."
    git worktree add -q --detach "$TREE" HEAD
    git -C "$TREE" checkout -q --orphan "$BRANCH-new-$RUN_ID-$COUNTY"
    git -C "$TREE" rm -rfq --ignore-unmatch .
  else
    echo "::error::Could not list remote branches (git ls-remote exit $exists)."
    return 1
  fi
  mkdir -p "$TREE/latest" "$TREE/history/$DATE"
  if [ "$discovered" = "true" ]; then
    # Discovery output never replaces latest/<county>.json: that file is the saved-parcel baseline
    # the next scheduled run compares with.
    cp "$SRC/$COUNTY.json" "$TREE/latest/$COUNTY-discover-report.json"
    if [ -f "$SRC/$COUNTY.md" ]; then cp "$SRC/$COUNTY.md" "$TREE/latest/$COUNTY-discover-report.md"; fi
    if [ -f "$SRC/$COUNTY-discovered.json" ]; then cp "$SRC/$COUNTY-discovered.json" "$TREE/latest/"; fi
    cp "$SRC/$COUNTY.json" "$TREE/history/$DATE/$COUNTY-$RUN_ID-discover.json"
    message="Validation $COUNTY $DATE run $RUN_ID (discover): $failed failed"
  else
    cp "$SRC/$COUNTY.json" "$TREE/latest/"
    for extra in "$COUNTY.md" "$COUNTY-changes.md" "$COUNTY-alert.json"; do
      if [ -f "$SRC/$extra" ]; then cp "$SRC/$extra" "$TREE/latest/"; fi
    done
    cp "$SRC/$COUNTY.json" "$TREE/history/$DATE/$COUNTY-$RUN_ID.json"
    message="Validation $COUNTY $DATE run $RUN_ID: $failed failed"
  fi
  git -C "$TREE" add -A latest history
  made=0
  if git -C "$TREE" diff --cached --quiet; then return 0; fi
  git -C "$TREE" commit -q -m "$message"
  made=1
}

for attempt in $(seq 1 "$ATTEMPTS"); do
  build
  if [ "$made" -eq 0 ]; then echo "$COUNTY: nothing new to commit."; exit 0; fi
  if git -C "$TREE" push -q "$REMOTE" "HEAD:refs/heads/$BRANCH"; then
    echo "$COUNTY: pushed results to $BRANCH (attempt $attempt)."
    exit 0
  fi
  echo "$COUNTY: push rejected (attempt $attempt of $ATTEMPTS); another leg or run probably pushed first. Retrying."
  if [ "$RETRY_SECONDS" -gt 0 ] && [ "$attempt" -lt "$ATTEMPTS" ]; then sleep $((attempt * RETRY_SECONDS + RANDOM % 5)); fi
done
echo "::error::Could not push $COUNTY results to $BRANCH after $ATTEMPTS attempts."
exit 1
