#!/bin/bash
# deploy.sh — Pull latest code from GitHub and rebuild
# Usage: ./deploy.sh
# Run on server: ssh deploy@76.13.2.74 "cd /var/www/dam && ./deploy.sh"

set -e

echo "[Deploy] Pulling latest from GitHub..."
git pull origin main

echo "[Deploy] Rebuilding Docker image..."
docker compose up --build -d

echo "[Deploy] Done. Container status:"
docker ps --filter "name=dam-asset-library" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
