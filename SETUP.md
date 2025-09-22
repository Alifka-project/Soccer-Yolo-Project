# Soccer Tracking Dashboard - Setup Guide

This guide will help you run both the frontend and backend services together.

## Quick Start

### Option 1: Using the Startup Script (Recommended)
```bash
./start.sh
```

### Option 2: Using npm commands
```bash
# Install all dependencies (run once)
npm run install:all

# Start both services
npm run dev
```

### Option 3: Manual startup
```bash
# Terminal 1 - Backend
cd worker
source venv/bin/activate
python server.py

# Terminal 2 - Frontend  
cd apps/web
npm run dev
```

## Services

Once started, you can access:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs

## Available Commands

### Root Level Commands
- `npm run dev` - Start both frontend and backend in development mode
- `npm run start` - Start both frontend and backend in production mode
- `npm run install:all` - Install all dependencies for both frontend and backend
- `npm run clean` - Clean all node_modules and Python cache files

### Frontend Only Commands
- `npm run dev:frontend` - Start only the frontend
- `npm run start:frontend` - Start only the frontend in production mode

### Backend Only Commands  
- `npm run dev:backend` - Start only the backend
- `npm run start:backend` - Start only the backend in production mode

## Prerequisites

Make sure you have:
- Node.js 18+ installed
- Python 3.12+ installed
- All Python dependencies installed in the virtual environment

## Troubleshooting

### Backend Issues
- Ensure the Python virtual environment is activated
- Check that all requirements are installed: `pip install -r requirements.txt`
- Verify YOLO models are downloaded (yolo11s.pt should be in worker/ directory)

### Frontend Issues  
- Clear Next.js cache: `rm -rf apps/web/.next`
- Reinstall dependencies: `cd apps/web && rm -rf node_modules && npm install`

### Port Conflicts
- Backend runs on port 8000
- Frontend runs on port 3000
- If these ports are in use, you'll need to modify the configuration files

## Development Notes

- The backend uses FastAPI with WebSocket support for real-time video streaming
- The frontend is built with Next.js 14 and React 18
- Both services support hot reloading during development
- The `concurrently` package manages running both services together
