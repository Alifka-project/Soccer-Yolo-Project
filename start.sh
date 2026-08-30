#!/bin/bash

echo "Starting Soccer Tracking Dashboard..."
echo ""

PYTHON_BIN="${PYTHON:-python3.12}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  PYTHON_BIN="python3"
fi

if [ ! -d "worker/venv" ]; then
    echo "Creating Python virtual environment..."
    "$PYTHON_BIN" -m venv worker/venv
    ./worker/venv/bin/pip install -r worker/requirements.txt
fi

if [ ! -d "apps/web/node_modules" ]; then
    echo "Installing frontend dependencies..."
    (cd apps/web && npm install)
fi

if [ ! -d "node_modules" ]; then
    echo "Installing root dependencies..."
    npm install
fi

if [ ! -f "apps/web/.env.local" ]; then
    cp apps/web/.env.example apps/web/.env.local
fi

echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:8000"
echo ""

npm run dev
