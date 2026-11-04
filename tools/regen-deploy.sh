#!/usr/bin/env bash
# Daily regenerate-and-deploy for ericminish.com, run by a systemd user timer.
#
# Exports the latest origin/main, regenerates the auto: blocks, and copies the
# result INTO the live document root (never swapping the directory: the web
# server's bind mount follows the inode). Fails closed: any generator or API
# error aborts before anything is copied.
#
# Host details are not in this public repo. Required environment (the timer
# reads it from a private EnvironmentFile):
#   SITE_SSH   ssh destination of the web host
#   SITE_ROOT  live document root on that host
#   REPO       path to a local clone/worktree of this repo
# Optional: REF (default origin/main), DRY_RUN=1 (build and show the diff, deploy nothing).
set -euo pipefail
: "${SITE_SSH:?}" "${SITE_ROOT:?}" "${REPO:?}"
REF=${REF:-origin/main}
KEEP=5

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git -C "$REPO" fetch -q origin
git -C "$REPO" archive "$REF" | tar -x -C "$work"
python3 -I "$work/tools/gen-gitstrip.py" --root "$work"
# Fill each Now-page card's generated facts; on an API error the committed facts ship unchanged.
python3 -I "$work/tools/gen-now.py" --write --root "$work" || true
# Refuse to ship a stale writing index/feed or a broken internal link; report copy-rule findings.
python3 -I "$work/tools/gen-writing.py" --check
python3 -I "$work/tools/lint-copy.py" --warn | tail -1
# Warn (never block) when a Now-page card is stale; keeps one GitHub issue in step with the warnings.
python3 -I "$work/tools/gen-now.py" --check --issue --root "$work" || true

# Ship only the site: no docs, tooling or dotfiles.
rm -rf "$work/tools" "$work"/.[!.]* "$work"/*.md
find "$work" -type d -exec chmod 755 {} + && find "$work" -type f -exec chmod 644 {} +
mapfile -t entries < <(cd "$work" && ls -A)

if [[ "${DRY_RUN:-0}" == 1 ]]; then
  mkdir "$work.live"
  ssh "$SITE_SSH" "tar -C '$SITE_ROOT' -cf - ." | tar -x -C "$work.live"
  diff -rq "$work.live" "$work" || true
  rm -rf "$work.live"
  echo "dry run: nothing deployed"
  exit 0
fi

stamp=$(date +%Y%m%d-%H%M%S)
ssh "$SITE_SSH" "cp -a '$SITE_ROOT' '$SITE_ROOT.bak-auto-$stamp'"
tar -C "$work" -cf - "${entries[@]}" | ssh "$SITE_SSH" "tar -x --no-same-owner -C '$SITE_ROOT'"
# Prune only the backups this job made; hand-made backups are left alone.
ssh "$SITE_SSH" "ls -1d '$SITE_ROOT'.bak-auto-* | sort | head -n -$KEEP | xargs -r rm -rf"

code=$(curl -s -o "$work/live.html" -w '%{http_code}' "https://www.ericminish.com/?cb=$stamp")
today="$(date +%-d) $(date +'%B %Y')"
if [[ "$code" != 200 ]] || ! grep -q "API on" "$work/live.html" || ! tr -s ' \n' ' ' < "$work/live.html" | grep -q "$today"; then
  echo "deploy check FAILED: / returned $code or lacks today's regeneration date ($today)." >&2
  echo "rollback: copy '$SITE_ROOT.bak-auto-$stamp' back into '$SITE_ROOT' on the host" >&2
  exit 1
fi
echo "deployed $(git -C "$REPO" rev-parse --short "$REF") + regenerated blocks; / is 200 and dated $today"
