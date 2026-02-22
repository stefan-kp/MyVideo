#!/bin/bash
# Startet Cloudflare Tunnel fuer MyVideo
#
# Voraussetzungen:
#   - cloudflared installiert (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
#   - TUNNEL_TOKEN in .env gesetzt (aus Cloudflare Zero Trust Dashboard)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../.env" 2>/dev/null || true

if [ -z "$TUNNEL_TOKEN" ]; then
  echo "FEHLER: TUNNEL_TOKEN nicht gesetzt. Bitte in .env konfigurieren."
  exit 1
fi

echo "Starte Cloudflare Tunnel..."
exec cloudflared tunnel run --token "$TUNNEL_TOKEN"
