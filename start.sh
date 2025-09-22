#!/bin/bash

# Soccer Tracking Dashboard Startup Script
echo "🚀 Starting Soccer Tracking Dashboard..."
echo ""

# Check if Python virtual environment exists
if [ ! -d "worker/venv" ]; then
    echo "❌ Python virtual environment not found. Please run: cd worker && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# Check if Node.js dependencies are installed
if [ ! -d "apps/web/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    cd apps/web && npm install && cd ../..
fi

if [ ! -d "node_modules" ]; then
    echo "📦 Installing root dependencies..."
    npm install
fi

echo "✅ All dependencies are ready!"
echo ""
echo "🎯 Starting both services..."
echo "   - Frontend: http://localhost:3000"
echo "   - Backend:  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop both services"
echo ""

# Start both services concurrently
npm run dev
