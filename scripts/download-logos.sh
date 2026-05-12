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
orf2t_hd.png
orf_iii_hd.png
orf_sport+_hd.png
servustv_hd_oesterreich.png
atv_hd.png
puls_24_hd.png
prosieben_austria.png
sat1_a.png
rtl_austria.png
vox_austria.png
arte_hd.png
kika_hd.png
bbc_world_news_hd.png
al_jazeera_english_hd.png
france_24_hd.png
cnbc_hd.png
nhk_worldjpn.png
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
