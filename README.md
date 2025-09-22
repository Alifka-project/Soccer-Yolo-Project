# Soccer Tracking Dashboard - Phase 1

AI-powered soccer tracking and analysis dashboard with zero monthly cost.

## Features

- **Real-time Tracking**: YOLO11 detector + ByteTrack tracker
- **Ephemeral Design**: All data in-memory, no persistence
- **Free Hosting**: Vercel Hobby + local GPU via Cloudflare Tunnel
- **AGPL Compliance**: Open-source mode with full source access
- **Analysis Tools**: Player metrics, team shape, heatmaps, pass networks

## Quick Start

### 1. Setup Worker (Python Backend)

```bash
cd worker
pip install -r requirements.txt

# Set environment variables
export MODEL_PREVIEW=yolo11s
export MODEL_PUBLISH=yolo11m
export SESSION_TTL_SECONDS=1800

# Run the worker
python server.py
```

### 2. Setup Cloudflare Tunnel

```bash
# Install cloudflared
# Create tunnel to expose local worker
cloudflared tunnel --url http://localhost:8000
```

### 3. Setup Web Frontend

```bash
cd apps/web
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your tunnel URL

# Run development server
pnpm dev
```

### 4. Deploy to Vercel

```bash
cd apps/web
vercel deploy
```

## Architecture

```
Frontend (Next.js) → API Proxy → Worker (FastAPI)
    ↓                              ↓
  Vercel Hobby              Local GPU + Tunnel
```

## License

AGPL-3.0 (due to YOLO11 usage)

## Compliance

When running as a public service, enable "Open-Source mode" to provide source access as required by AGPL.
