#!/bin/bash

echo "🚀 Deploying Soccer Tracking Dashboard to Vercel..."

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Installing..."
    npm install -g vercel
fi

# Build the project
echo "📦 Building project..."
cd apps/web && npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please fix errors before deploying."
    exit 1
fi

echo "✅ Build successful!"

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
cd ../../
vercel --prod

echo "🎉 Deployment complete!"
echo "📱 Your dashboard is now live on Vercel!"
echo "🔗 Share the URL with your client for testing and demo."
