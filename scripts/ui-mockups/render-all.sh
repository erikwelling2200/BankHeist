#!/usr/bin/env bash
# Renders every image of the UI mockups (docs/ui-mockups) from the game itself:
#   1. exports the example bank's level for the Python rules,
#   2. builds the game and serves the build,
#   3. stages each scene (scenes.py cast), renders its world with the game (capture.mjs) and draws the UI over it
#      (scenes.py compose), then the legends and the HUD icons and portraits,
#   4. copies the results into docs/ui-mockups/canvas/project/img.
# Usage, from the repo root: scripts/ui-mockups/render-all.sh [scene ...]     (needs Python 3 with Pillow)
set -euo pipefail
cd "$(dirname "$0")/../.."
here=scripts/ui-mockups
work=docs/ui-mockups/out/frames
img=docs/ui-mockups/canvas/project/img
port=${MOCKUP_PORT:-4176}
mkdir -p "$work" "$img"

npx vitest run --config "$here/vitest.export.config.ts" > /dev/null
npm run build > /dev/null
npx vite preview --port "$port" --strictPort > /dev/null 2>&1 &
server=$!
trap 'kill $server' EXIT
until curl -s "http://localhost:$port" > /dev/null; do sleep 0.5; done

python3 "$here/scenes.py" cast "$work" "$@"
BASE="http://localhost:$port" node "$here/capture.mjs" "$work" "$@"
python3 "$here/scenes.py" compose "$work" "$@"
python3 "$here/legend.py" "$work"
python3 "$here/icons.py" "$img"
for f in "$work"/*.png; do
    case "$(basename "$f")" in *-world.png|*-floor.png|*-ghosts.png|.*) ;; *) cp "$f" "$img/" ;; esac
done
echo "mockup images in $img"
