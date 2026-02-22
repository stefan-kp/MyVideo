#!/bin/sh
set -e

# Start Cloudflare Tunnel in background if token is set
if [ -n "$TUNNEL_TOKEN" ]; then
  echo "Starte Cloudflare Tunnel im Hintergrund..."
  cloudflared tunnel run --token "$TUNNEL_TOKEN" &
  TUNNEL_PID=$!
  echo "Cloudflare Tunnel gestartet (PID: $TUNNEL_PID)"
fi

# Download channel logos (skips existing ones)
echo "Lade Sender-Logos..."
sh /app/scripts/download-logos.sh

# Start Node.js application
echo "Starte MyVideo Server..."
exec node server.js
