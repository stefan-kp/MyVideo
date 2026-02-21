#!/bin/bash
# Fritz!Box DVB-C Stream -> HLS Konvertierung
#
# Verwendung:
#   ./scripts/start-stream.sh                    # Verwendet .env STREAM_URL
#   ./scripts/start-stream.sh "http://192.168.100.1/dvb/m3u/..."  # Direkte URL
#
# Voraussetzungen:
#   - ffmpeg installiert (brew install ffmpeg)
#   - Fritz!Box DVB-C Stream erreichbar

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
STREAM_DIR="$PROJECT_DIR/stream"

# .env laden falls vorhanden
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Stream-URL aus Argument oder .env
INPUT_URL="${1:-$STREAM_URL}"

if [ -z "$INPUT_URL" ]; then
  echo "FEHLER: Keine Stream-URL angegeben!"
  echo ""
  echo "Verwendung:"
  echo "  $0 \"http://192.168.100.1/dvb/m3u/51400_15030.m3u?sid=...\""
  echo ""
  echo "Oder STREAM_URL in .env setzen."
  exit 1
fi

# Stream-Verzeichnis vorbereiten
mkdir -p "$STREAM_DIR"
rm -f "$STREAM_DIR"/*.ts "$STREAM_DIR"/*.m3u8

echo "=== MyVideo Stream Konverter ==="
echo "Input:  $INPUT_URL"
echo "Output: $STREAM_DIR/index.m3u8"
echo ""
echo "Starte FFmpeg... (Ctrl+C zum Beenden)"
echo ""

# FFmpeg: MPEG-TS -> HLS
# -c:v copy        = Video durchreichen (fuer HD/H.264 Sender)
# -c:a aac         = Audio zu AAC konvertieren (Echo Show Kompatibilitaet)
# -hls_time 4      = 4-Sekunden Segmente
# -hls_list_size 5 = Max 5 Segmente in Playlist
# -hls_flags delete_segments = Alte Segmente loeschen
#
# Falls SD-Sender (MPEG-2), ersetze "-c:v copy" durch:
#   -c:v libx264 -preset ultrafast -tune zerolatency -crf 23
ffmpeg \
  -i "$INPUT_URL" \
  -c:v copy \
  -c:a aac -b:a 128k -ac 2 \
  -hls_time 4 \
  -hls_list_size 5 \
  -hls_flags delete_segments+append_list \
  -hls_segment_type mpegts \
  -hls_segment_filename "$STREAM_DIR/segment_%03d.ts" \
  -f hls \
  "$STREAM_DIR/index.m3u8"
