#!/bin/bash
# Fritz!Box DVB-C Stream -> HLS Konvertierung
#
# Die Fritz!Box liefert eine .m3u Playlist mit einer RTSP-URL (SAT>IP).
# Dieses Script liest die M3U-Datei, extrahiert die RTSP-URL und
# konvertiert den Stream mit FFmpeg zu HLS fuer den Echo Show.
#
# Verwendung:
#   ./scripts/start-stream.sh                    # Verwendet .env STREAM_URL
#   ./scripts/start-stream.sh "http://192.168.100.1/dvb/m3u/..."  # Direkte M3U-URL
#   ./scripts/start-stream.sh "rtsp://..."       # Direkte RTSP-URL
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

# Wenn die URL eine M3U-Playlist ist, RTSP-URL daraus extrahieren
if echo "$INPUT_URL" | grep -qi '\.m3u'; then
  echo "M3U-Playlist erkannt, lade Inhalt..."
  M3U_CONTENT=$(curl -s "$INPUT_URL")

  if [ -z "$M3U_CONTENT" ]; then
    echo "FEHLER: Konnte M3U-Playlist nicht laden: $INPUT_URL"
    echo "Pruefen ob die Fritz!Box erreichbar ist und die Session-ID (sid) gueltig ist."
    exit 1
  fi

  echo "Playlist-Inhalt:"
  echo "$M3U_CONTENT"
  echo ""

  # RTSP-URL aus der M3U extrahieren
  RTSP_URL=$(echo "$M3U_CONTENT" | grep -i '^rtsp://')

  if [ -z "$RTSP_URL" ]; then
    echo "FEHLER: Keine RTSP-URL in der M3U-Playlist gefunden."
    echo "Playlist-Inhalt:"
    echo "$M3U_CONTENT"
    exit 1
  fi

  FINAL_URL="$RTSP_URL"
  echo "RTSP-URL extrahiert: $FINAL_URL"
else
  FINAL_URL="$INPUT_URL"
fi

# Stream-Verzeichnis vorbereiten
mkdir -p "$STREAM_DIR"
rm -f "$STREAM_DIR"/*.ts "$STREAM_DIR"/*.m3u8

echo ""
echo "=== MyVideo Stream Konverter ==="
echo "M3U:    $INPUT_URL"
echo "Stream: $FINAL_URL"
echo "Output: $STREAM_DIR/index.m3u8"
echo ""
echo "Starte FFmpeg... (Ctrl+C zum Beenden)"
echo ""

# FFmpeg: RTSP (SAT>IP) -> HLS
# -rtsp_transport tcp = TCP statt UDP (stabiler hinter NAT/Firewall)
# -c:v copy           = Video durchreichen (H.264 fuer HD Sender)
# -c:a aac            = Audio zu AAC konvertieren (Echo Show Kompatibilitaet)
# -hls_time 4         = 4-Sekunden Segmente
# -hls_list_size 5    = Max 5 Segmente in Playlist
# -hls_flags delete_segments = Alte Segmente loeschen
#
# Falls SD-Sender (MPEG-2), ersetze "-c:v copy" durch:
#   -c:v libx264 -preset ultrafast -tune zerolatency -crf 23
ffmpeg \
  -rtsp_transport tcp \
  -i "$FINAL_URL" \
  -c:v copy \
  -c:a aac -b:a 128k -ac 2 \
  -hls_time 4 \
  -hls_list_size 5 \
  -hls_flags delete_segments+append_list \
  -hls_segment_type mpegts \
  -hls_segment_filename "$STREAM_DIR/segment_%03d.ts" \
  -f hls \
  "$STREAM_DIR/index.m3u8"
