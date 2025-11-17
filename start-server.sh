#!/bin/bash

# Quick start script for signaling server

echo "🚀 Starting IndexerChain Signaling Server..."
echo ""

# Check if ws is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if ws package exists
if [ ! -d "node_modules/ws" ]; then
    echo "📦 Installing ws package..."
    npm install ws
fi

# Start the server
echo "✅ Starting server on ws://localhost:8080"
echo "   Press Ctrl+C to stop the server"
echo ""
node signaling-server-example.js

