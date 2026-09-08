#!/bin/bash
# Starts both halves of the local stack: the YOLO26 worker and the dashboard.
#
# The worker is what gives accurate detection. Without it the dashboard falls
# back to a lighter in-browser model, which is why detection can look poor when
# only the web app is running.
set -e
cd "$(dirname "$0")"

if [ ! -x worker/venv/bin/python ]; then
  echo "worker/venv missing - create it with:"
  echo "  cd worker && python3.12 -m venv venv && ./venv/bin/pip install -r requirements.txt"
  exit 1
fi

echo "Starting YOLO26 worker on :8000 ..."
(cd worker && nohup ./venv/bin/python server.py > /tmp/soccer-worker.log 2>&1 &)

for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://localhost:8000/health >/dev/null 2>&1; then break; fi
  sleep 2
done
if curl -fsS --max-time 3 http://localhost:8000/health >/dev/null 2>&1; then
  echo "  worker ready: $(curl -fsS http://localhost:8000/health)"
else
  echo "  worker did not come up - see /tmp/soccer-worker.log (the dashboard still runs, on the in-browser model)"
fi

echo "Starting dashboard on :3000 ..."
(cd apps/web && nohup npx next dev -p 3000 > /tmp/soccer-web.log 2>&1 &)

for _ in $(seq 1 90); do
  if curl -fsS --max-time 5 -o /dev/null http://localhost:3000/workspace 2>/dev/null; then break; fi
  sleep 3
done
echo
echo "Dashboard: http://localhost:3000/workspace"
echo "Logs: /tmp/soccer-web.log  /tmp/soccer-worker.log"
