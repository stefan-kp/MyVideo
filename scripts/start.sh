#!/bin/bash
# Usage: ./scripts/start.sh [local|remote]
# Default: remote (pull from GHCR)
# local: build from current directory

MODE=${1:-remote}

if [ "$MODE" = "local" ]; then
  echo "Building and starting locally..."
  docker compose up --build
else
  echo "Starting with remote image..."
  docker compose pull
  docker compose up
fi
