#!/bin/sh
# Build, then restart the production server — in that order, and only if the
# build actually succeeded. Chaining these with && the other way round leaves a
# stale server on 3000 serving the previous build while npm start dies quietly
# with EADDRINUSE, and every screenshot after that is a photograph of old code.
# It has cost two debugging sessions. It costs none now.
set -e
cd "$(dirname "$0")/.."
npm run build 2>&1 | tail -3
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true
sleep 1
npm start >/tmp/selora-server.log 2>&1 &
for i in $(seq 1 40); do
  sleep 0.5
  if curl -sf -o /dev/null http://localhost:3000/; then echo "serving $(date +%T)"; exit 0; fi
done
echo "server did not come up"; tail -20 /tmp/selora-server.log; exit 1
