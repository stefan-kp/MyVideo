#!/bin/sh
set -e

LOGO_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/logos"
BASE_URL="https://tv.avm.de/tvapp/logos/hd"

LOGOS="
das_erste_hd.png
one_hd.png
ard_alpha_hd.png
tagesschau24_hd.png
zdf_hd.png
zdf_neo_hd.png
zdf_info_hd.png
3sat_hd.png
phoenix_hd.png
orf1_hd.png
orf2o_hd.png
"

mkdir -p "$LOGO_DIR"

echo "Lade Logos nach $LOGO_DIR ..."

for logo in $LOGOS; do
  if [ -f "$LOGO_DIR/$logo" ]; then
    echo "  Bereits vorhanden: $logo"
  else
    echo "  Lade: $logo"
    curl -sSfL "$BASE_URL/$logo" -o "$LOGO_DIR/$logo" || echo "  WARNUNG: $logo konnte nicht geladen werden"
  fi
done

echo "Fertig. $(ls "$LOGO_DIR"/*.png 2>/dev/null | wc -l | tr -d ' ') Logos vorhanden."
