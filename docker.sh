#!/bin/bash
# Asset Library — Docker startup helper
# Adds Docker Desktop CLI to PATH and manages the container

export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

CMD=${1:-"up"}

case "$CMD" in
  up)
    echo "Starting Asset Library container..."
    docker compose up -d
    echo "Waiting for server to initialize..."
    sleep 12
    echo ""
    echo "=== Health Check ==="
    curl -s 'http://localhost:3010/api/raw/assets?limit=1' \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✓ Raw Files: {d[\"total\"]} assets')" \
      || echo "✗ Server not yet ready — try: docker compose logs"
    curl -s 'http://localhost:3010/api/ads/assets?limit=1' \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'✓ Final Assets: {d[\"total\"]} assets')" \
      || echo "✗ Ads API not yet ready"
    echo ""
    echo "Open: http://localhost:3010/raw/library"
    ;;
  down)
    docker compose down
    ;;
  logs)
    docker compose logs -f
    ;;
  build)
    docker compose build
    ;;
  restart)
    docker compose restart
    ;;
  *)
    echo "Usage: ./docker.sh [up|down|logs|build|restart]"
    ;;
esac
