#!/bin/bash
# Deploy oder erstelle den Alexa Skill
#
# Verwendung:
#   ./scripts/deploy-skill.sh          # Update oder Create
#   ./scripts/deploy-skill.sh create   # Immer neu anlegen
#
# Voraussetzungen:
#   - ASK CLI installiert (npm install -g ask-cli)
#   - ASK CLI konfiguriert (ask configure)
#   - BASE_URL in .env gesetzt

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"
MODEL_FILE="$PROJECT_DIR/skill/model/de-DE.json"
MANIFEST_FILE="$PROJECT_DIR/skill/manifest.json"

# Farben
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# .env laden
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^\s*$' | xargs)
fi

# Voraussetzungen pruefen
if ! command -v ask &> /dev/null; then
  echo -e "${RED}ASK CLI nicht gefunden. Installiere mit: npm install -g ask-cli${NC}"
  echo "Danach: ask configure"
  exit 1
fi

if [ -z "$BASE_URL" ]; then
  echo -e "${RED}BASE_URL nicht gesetzt. Bitte in .env konfigurieren.${NC}"
  exit 1
fi

# Manifest mit BASE_URL vorbereiten
MANIFEST_CONTENT=$(sed "s|__BASE_URL__|$BASE_URL|g" "$MANIFEST_FILE")

# Skill-ID aus .env oder Argument
FORCE_CREATE="${1:-}"

if [ -n "$SKILL_ID" ] && [ "$FORCE_CREATE" != "create" ]; then
  # --- UPDATE ---
  echo -e "${GREEN}Skill gefunden: $SKILL_ID${NC}"
  echo "Aktualisiere Interaction Model..."

  ask smapi set-interaction-model \
    --skill-id "$SKILL_ID" \
    --stage development \
    --locale de-DE \
    --interaction-model "$(cat "$MODEL_FILE")"

  echo "Aktualisiere Manifest..."
  ask smapi update-skill-manifest \
    --skill-id "$SKILL_ID" \
    --stage development \
    --manifest "$MANIFEST_CONTENT"

  echo ""
  echo -e "${GREEN}Skill aktualisiert!${NC}"
  echo "Warte auf Build..."

  # Auf Build warten
  sleep 5
  for i in $(seq 1 12); do
    STATUS=$(ask smapi get-skill-status --skill-id "$SKILL_ID" --resource interactionModel 2>&1 \
      | grep -o '"status": "[A-Z_]*"' | tail -1 | grep -o '[A-Z_]*')
    if [ "$STATUS" = "SUCCEEDED" ]; then
      echo -e "${GREEN}Build erfolgreich!${NC}"
      break
    elif [ "$STATUS" = "FAILED" ]; then
      echo -e "${RED}Build fehlgeschlagen!${NC}"
      ask smapi get-skill-status --skill-id "$SKILL_ID" --resource interactionModel
      exit 1
    fi
    echo "  Build laeuft... ($i/12)"
    sleep 5
  done

else
  # --- CREATE ---
  echo -e "${YELLOW}Kein SKILL_ID gefunden. Erstelle neuen Skill...${NC}"
  echo ""

  RESULT=$(ask smapi create-skill-for-vendor \
    --manifest "$MANIFEST_CONTENT" 2>&1)

  NEW_SKILL_ID=$(echo "$RESULT" | grep -o 'amzn1\.ask\.skill\.[a-f0-9\-]*')

  if [ -z "$NEW_SKILL_ID" ]; then
    echo -e "${RED}Skill-Erstellung fehlgeschlagen:${NC}"
    echo "$RESULT"
    exit 1
  fi

  echo -e "${GREEN}Neuer Skill erstellt: $NEW_SKILL_ID${NC}"

  # SKILL_ID in .env speichern
  if grep -q '^SKILL_ID=' "$ENV_FILE" 2>/dev/null; then
    sed -i '' "s|^SKILL_ID=.*|SKILL_ID=$NEW_SKILL_ID|" "$ENV_FILE"
  else
    echo "" >> "$ENV_FILE"
    echo "SKILL_ID=$NEW_SKILL_ID" >> "$ENV_FILE"
  fi
  echo "SKILL_ID in .env gespeichert."

  # Warten bis Skill bereit ist
  echo "Warte auf Skill-Erstellung..."
  sleep 10

  # Interaction Model setzen
  echo "Setze Interaction Model..."
  ask smapi set-interaction-model \
    --skill-id "$NEW_SKILL_ID" \
    --stage development \
    --locale de-DE \
    --interaction-model "$(cat "$MODEL_FILE")"

  echo ""
  echo -e "${GREEN}Skill erstellt und konfiguriert!${NC}"
  echo ""
  echo "Naechste Schritte:"
  echo "  1. Skill testen: ask smapi get-skill-status --skill-id $NEW_SKILL_ID"
  echo "  2. Im Browser: https://developer.amazon.com/alexa/console/ask"
  echo "  3. Sage: Alexa, oeffne mein Video"
fi

echo ""
echo "Skill ID:  ${SKILL_ID:-$NEW_SKILL_ID}"
echo "Endpoint:  $BASE_URL/alexa"
