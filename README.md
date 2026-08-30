# Soccer Tracking Dashboard - Phase 1

AI-powered soccer tracking and analysis dashboard with YOLO26.

## Features

- **Real-time Tracking**: YOLO26 detector + ByteTrack tracker
- **Ephemeral Design**: All data in-memory, no persistence
- **Hosting**: Vercel dashboard + local/GPU worker
- **AGPL Compliance**: Open-source mode with full source access
- **Analysis Tools**: Player metrics, team shape, heatmaps, pass networks

## Architecture

YOLO cannot run on Vercel. The Next.js app is the UI. Real detection runs on the Python worker.

```
Frontend (Next.js on Vercel)  →  Worker (FastAPI + YOLO26)
```

On Vercel without a worker URL, the dashboard still works in demo mode (upload, playback, analytics preview).

## Quick Start

### 1. Setup Worker (Python Backend)

```bash
cd worker
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

export MODEL_PREVIEW=yolo26s
export MODEL_PUBLISH=yolo26m
export SESSION_TTL_SECONDS=1800

python server.py
```

The worker listens on http://localhost:8000. First run downloads YOLO26 weights.

### 2. Setup Web Frontend

```bash
cd apps/web
npm install
cp .env.example .env.local
npm run dev
```

### 3. Deploy the UI to Vercel

Set the Vercel root directory to `apps/web`. For real YOLO in production, also set:

```
NEXT_PUBLIC_WORKER_HTTP_BASE=https://your-tunnel-or-gpu-host
NEXT_PUBLIC_WORKER_WS_BASE=wss://your-tunnel-or-gpu-host
WORKER_URL=https://your-tunnel-or-gpu-host
```

## License

AGPL-3.0 (due to YOLO26 / Ultralytics usage)
