#!/bin/bash
# ngrok Tunnel starten fuer den MyVideo Alexa Skill
#
# Verwendung:
#   ./scripts/start-ngrok.sh              # Standard Port 3000
#   ./scripts/start-ngrok.sh 8080         # Eigener Port
#
# Voraussetzungen:
#   - ngrok installiert (brew install ngrok)
#   - ngrok Account + Authtoken konfiguriert (ngrok config add-authtoken YOUR_TOKEN)
#
# Nach dem Start:
#   1. Die HTTPS-URL aus der ngrok-Ausgabe kopieren
#   2. In .env als BASE_URL eintragen
#   3. In Alexa Developer Console als Endpoint eintragen: <URL>/alexa

set -e

PORT="${1:-3000}"

echo "=== MyVideo ngrok Tunnel ==="
echo "Starte ngrok Tunnel auf Port $PORT..."
echo ""
echo "WICHTIG: Nach dem Start:"
echo "  1. Kopiere die 'Forwarding' HTTPS-URL (z.B. https://xxxx.ngrok-free.app)"
echo "  2. Trage sie in .env als BASE_URL ein"
echo "  3. Trage <URL>/alexa als Endpoint in der Alexa Developer Console ein"
echo ""

ngrok http "$PORT"
