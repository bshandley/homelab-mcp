#!/bin/bash
set -e

echo "Building Homelab MCP Server..."

# Install dependencies
echo "Installing dependencies..."
npm install

# Build TypeScript
echo "Compiling TypeScript..."
npm run build

# Build Docker image
echo "Building Docker image..."
docker compose build

echo "Build complete!"
echo ""
echo "Next steps:"
echo "1. Configure your .env file (copy from .env.example)"
echo "2. Run: docker compose up -d"
echo "3. Check logs: docker compose logs -f"
