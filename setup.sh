#!/bin/bash
# =============================================================================
# MyVideo Alexa Skill - Interaktives Setup
#
# Fuehrt das komplette Setup durch:
#   1. Voraussetzungen pruefen (Node.js, ASK CLI)
#   2. .env Konfiguration (interaktiv)
#   3. Alexa Skill erstellen/deployen
#
# Verwendung:
#   ./setup.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"

# Farben
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# --- Hilfsfunktionen --------------------------------------------------------

print_header() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  $1${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

print_step() {
  echo -e "${GREEN}[$1/$TOTAL_STEPS]${NC} ${BOLD}$2${NC}"
}

print_ok() {
  echo -e "  ${GREEN}✓${NC} $1"
}

print_warn() {
  echo -e "  ${YELLOW}!${NC} $1"
}

print_error() {
  echo -e "  ${RED}✗${NC} $1"
}

# Fragt einen Wert ab. Parameter: Variablenname, Beschreibung, Default, Pflicht (ja/nein)
ask_value() {
  local var_name="$1"
  local description="$2"
  local default_value="$3"
  local required="$4"

  local prompt_text="  $description"
  if [ -n "$default_value" ]; then
    prompt_text="$prompt_text [${default_value}]"
  fi
  prompt_text="$prompt_text: "

  while true; do
    read -r -p "$prompt_text" input
    local value="${input:-$default_value}"

    if [ "$required" = "ja" ] && [ -z "$value" ]; then
      print_error "Dieses Feld ist erforderlich."
      continue
    fi

    eval "$var_name='$value'"
    break
  done
}

# Fragt Ja/Nein. Parameter: Frage, Default (j/n)
ask_yes_no() {
  local question="$1"
  local default="$2"

  local hint="j/N"
  [ "$default" = "j" ] && hint="J/n"

  while true; do
    read -r -p "  $question [$hint]: " input
    input="${input:-$default}"
    case "$input" in
      [jJyY]*) return 0 ;;
      [nN]*) return 1 ;;
      *) echo "  Bitte j oder n eingeben." ;;
    esac
  done
}

# Schreibt eine Variable in die .env Datei
set_env_value() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    # Existierenden Wert ersetzen (plattformunabhaengig)
    local tmp_file
    tmp_file=$(mktemp)
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ "$line" =~ ^${key}= ]]; then
        echo "${key}=${value}"
      else
        echo "$line"
      fi
    done < "$ENV_FILE" > "$tmp_file"
    mv "$tmp_file" "$ENV_FILE"
  elif grep -q "^# *${key}=" "$ENV_FILE" 2>/dev/null; then
    # Auskommentierte Zeile aktivieren und Wert setzen
    local tmp_file
    tmp_file=$(mktemp)
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ "$line" =~ ^#\ *${key}= ]]; then
        echo "${key}=${value}"
      else
        echo "$line"
      fi
    done < "$ENV_FILE" > "$tmp_file"
    mv "$tmp_file" "$ENV_FILE"
  else
    # Neue Zeile anhaengen
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

# Liest einen Wert aus der bestehenden .env Datei
get_env_value() {
  local key="$1"
  if [ -f "$ENV_FILE" ]; then
    grep "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2-
  fi
}

TOTAL_STEPS=3

# =============================================================================
# BANNER
# =============================================================================

echo ""
echo -e "${CYAN}  __  __     __     ___    _           ${NC}"
echo -e "${CYAN} |  \/  |_   \ \   / (_)__| | ___  ___ ${NC}"
echo -e "${CYAN} | |\/| | | | \ \ / /| / _\` |/ _ \/ _ \\${NC}"
echo -e "${CYAN} | |  | | |_| |\ V / | \__,_|  __/ (_) |${NC}"
echo -e "${CYAN} |_|  |_|\__, | \_/  |_\__,_|\___|\___/${NC}"
echo -e "${CYAN}         |___/                          ${NC}"
echo ""
echo -e " ${BOLD}Alexa Video Skill - Interaktives Setup${NC}"
echo ""

# =============================================================================
# SCHRITT 1: Voraussetzungen
# =============================================================================

print_header "Schritt 1 von $TOTAL_STEPS: Voraussetzungen pruefen"

# --- Node.js ---
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  print_ok "Node.js gefunden: $NODE_VERSION"

  # Mindestversion pruefen (v18+)
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d'.' -f1)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    print_warn "Node.js v18+ empfohlen (aktuell: $NODE_VERSION)"
  fi
else
  print_error "Node.js nicht gefunden."
  echo ""
  echo "  Node.js v18+ wird benoetigt."
  echo "  Installation: https://nodejs.org/"
  echo ""
  exit 1
fi

# --- npm ---
if command -v npm &> /dev/null; then
  NPM_VERSION=$(npm --version)
  print_ok "npm gefunden: v$NPM_VERSION"
else
  print_error "npm nicht gefunden."
  exit 1
fi

# --- ASK CLI ---
ASK_NEEDS_CONFIGURE=false

if command -v ask &> /dev/null; then
  ASK_VERSION=$(ask --version 2>/dev/null || echo "unbekannt")
  print_ok "ASK CLI gefunden: $ASK_VERSION"
else
  print_warn "ASK CLI nicht gefunden."
  echo ""
  if ask_yes_no "ASK CLI jetzt global installieren (npm install -g ask-cli)?" "j"; then
    echo ""
    echo "  Installiere ASK CLI..."
    npm install -g ask-cli
    if command -v ask &> /dev/null; then
      print_ok "ASK CLI erfolgreich installiert."
      ASK_NEEDS_CONFIGURE=true
    else
      print_error "ASK CLI Installation fehlgeschlagen."
      echo "  Bitte manuell installieren: npm install -g ask-cli"
      exit 1
    fi
  else
    print_warn "ASK CLI wird fuer die Skill-Erstellung benoetigt."
    echo "  Installiere spaeter mit: npm install -g ask-cli"
    echo ""
  fi
fi

# --- ASK CLI konfiguriert? ---
if command -v ask &> /dev/null; then
  ASK_CONFIG_DIR="${HOME}/.ask"
  if [ ! -d "$ASK_CONFIG_DIR" ] || [ "$ASK_NEEDS_CONFIGURE" = true ]; then
    print_warn "ASK CLI ist noch nicht konfiguriert."
    echo ""
    echo "  Es oeffnet sich gleich ein Browser-Fenster zur Anmeldung"
    echo "  bei deinem Amazon Developer Account."
    echo ""
    if ask_yes_no "ASK CLI jetzt konfigurieren?" "j"; then
      echo ""
      ask configure --no-browser 2>/dev/null || ask configure || true
      echo ""
      if [ -d "$ASK_CONFIG_DIR" ]; then
        print_ok "ASK CLI konfiguriert."
      else
        print_warn "ASK CLI Konfiguration uebersprungen. Skill-Erstellung spaeter manuell moeglich."
      fi
    else
      print_warn "ASK CLI Konfiguration uebersprungen."
    fi
  else
    print_ok "ASK CLI ist konfiguriert."
  fi
fi

# --- npm install ---
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  print_warn "Node-Module nicht gefunden."
  echo ""
  if ask_yes_no "npm install jetzt ausfuehren?" "j"; then
    echo ""
    echo "  Installiere Abhaengigkeiten..."
    cd "$SCRIPT_DIR" && npm install
    print_ok "Abhaengigkeiten installiert."
  fi
else
  print_ok "Node-Module vorhanden."
fi

# =============================================================================
# SCHRITT 2: Konfiguration (.env)
# =============================================================================

print_header "Schritt 2 von $TOTAL_STEPS: Konfiguration"

# .env Datei anlegen falls noetig
if [ -f "$ENV_FILE" ]; then
  print_ok ".env Datei vorhanden."
  echo ""
  if ask_yes_no "Bestehende .env Konfiguration anpassen?" "j"; then
    CONFIGURE_ENV=true
  else
    CONFIGURE_ENV=false
  fi
else
  echo "  Erstelle .env aus Vorlage..."
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  print_ok ".env Datei erstellt."
  CONFIGURE_ENV=true
fi

if [ "$CONFIGURE_ENV" = true ]; then
  echo ""
  echo -e "  ${BOLD}Pflichtfelder${NC}"
  echo -e "  ${CYAN}─────────────${NC}"
  echo ""

  # --- BASE_URL ---
  CURRENT_BASE_URL=$(get_env_value "BASE_URL")
  [ "$CURRENT_BASE_URL" = "https://tv.example.de" ] && CURRENT_BASE_URL=""

  echo "  Die BASE_URL ist die oeffentliche HTTPS-Adresse deines Servers."
  echo "  Beispiel: https://tv.meinserver.de"
  echo ""
  ask_value "NEW_BASE_URL" "BASE_URL" "$CURRENT_BASE_URL" "ja"
  set_env_value "BASE_URL" "$NEW_BASE_URL"
  print_ok "BASE_URL gesetzt: $NEW_BASE_URL"
  echo ""

  # --- JWT_SECRET ---
  CURRENT_JWT=$(get_env_value "JWT_SECRET")

  if [ -n "$CURRENT_JWT" ] && [ ${#CURRENT_JWT} -ge 32 ]; then
    print_ok "JWT_SECRET bereits gesetzt (${#CURRENT_JWT} Zeichen)."
    if ask_yes_no "Neues JWT_SECRET generieren?" "n"; then
      NEW_JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
      set_env_value "JWT_SECRET" "$NEW_JWT"
      print_ok "Neues JWT_SECRET generiert."
    fi
  else
    echo "  Das JWT_SECRET sichert die Stream-Proxy-URLs ab."
    if ask_yes_no "JWT_SECRET automatisch generieren? (empfohlen)" "j"; then
      NEW_JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
      set_env_value "JWT_SECRET" "$NEW_JWT"
      print_ok "JWT_SECRET generiert (64 Zeichen)."
    else
      ask_value "NEW_JWT" "JWT_SECRET (min. 32 Zeichen)" "" "ja"
      set_env_value "JWT_SECRET" "$NEW_JWT"
      print_ok "JWT_SECRET gesetzt."
    fi
  fi

  echo ""
  echo -e "  ${BOLD}Optionale Felder${NC}"
  echo -e "  ${CYAN}────────────────${NC}"
  echo ""

  # --- REGION ---
  CURRENT_REGION=$(get_env_value "REGION")
  CURRENT_REGION="${CURRENT_REGION:-AT}"

  echo "  Die Region bestimmt die Reihenfolge der Nachrichten und Sendungen."
  echo "  AT = Oesterreich (ZIB zuerst), DE = Deutschland (Tagesschau zuerst)"
  echo ""
  ask_value "NEW_REGION" "Region (AT/DE)" "$CURRENT_REGION" "nein"
  NEW_REGION=$(echo "$NEW_REGION" | tr '[:lower:]' '[:upper:]')
  if [ "$NEW_REGION" != "AT" ] && [ "$NEW_REGION" != "DE" ]; then
    print_warn "Unbekannte Region '$NEW_REGION', verwende AT."
    NEW_REGION="AT"
  fi
  set_env_value "REGION" "$NEW_REGION"
  print_ok "Region: $NEW_REGION"
  echo ""

  # --- Cloudflare Tunnel ---
  if ask_yes_no "Cloudflare Tunnel konfigurieren?" "n"; then
    echo ""
    CURRENT_TUNNEL_TOKEN=$(get_env_value "TUNNEL_TOKEN")
    ask_value "NEW_TUNNEL_TOKEN" "TUNNEL_TOKEN" "$CURRENT_TUNNEL_TOKEN" "nein"
    if [ -n "$NEW_TUNNEL_TOKEN" ]; then
      set_env_value "TUNNEL_TOKEN" "$NEW_TUNNEL_TOKEN"
      print_ok "TUNNEL_TOKEN gesetzt."
    fi

    CURRENT_TUNNEL_HOST=$(get_env_value "TUNNEL_HOSTNAME")
    ask_value "NEW_TUNNEL_HOST" "TUNNEL_HOSTNAME" "$CURRENT_TUNNEL_HOST" "nein"
    if [ -n "$NEW_TUNNEL_HOST" ]; then
      set_env_value "TUNNEL_HOSTNAME" "$NEW_TUNNEL_HOST"
      print_ok "TUNNEL_HOSTNAME gesetzt."
    fi
    echo ""
  else
    echo ""
  fi

  # --- Ports ---
  if ask_yes_no "Ports anpassen? (Standard: intern 3000, extern 3377)" "n"; then
    echo ""
    CURRENT_PORT=$(get_env_value "PORT")
    ask_value "NEW_PORT" "Interner Port" "${CURRENT_PORT:-3000}" "nein"
    set_env_value "PORT" "$NEW_PORT"

    CURRENT_PORT_EXT=$(get_env_value "PORT_EXTERNAL")
    ask_value "NEW_PORT_EXT" "Externer Port" "${CURRENT_PORT_EXT:-3377}" "nein"
    set_env_value "PORT_EXTERNAL" "$NEW_PORT_EXT"
    print_ok "Ports: intern=$NEW_PORT, extern=$NEW_PORT_EXT"
    echo ""
  else
    echo ""
  fi

  # --- OpenRouter (AI Summary) ---
  if ask_yes_no "AI-Zusammenfassung konfigurieren? (benoetigt OpenRouter API Key)" "n"; then
    echo ""
    CURRENT_OR_KEY=$(get_env_value "OPENROUTER_API_KEY")
    ask_value "NEW_OR_KEY" "OPENROUTER_API_KEY" "$CURRENT_OR_KEY" "nein"
    if [ -n "$NEW_OR_KEY" ]; then
      set_env_value "OPENROUTER_API_KEY" "$NEW_OR_KEY"
      print_ok "OPENROUTER_API_KEY gesetzt."

      CURRENT_OR_MODEL=$(get_env_value "OPENROUTER_MODEL")
      ask_value "NEW_OR_MODEL" "OPENROUTER_MODEL" "${CURRENT_OR_MODEL:-google/gemini-2.5-flash-lite}" "nein"
      if [ -n "$NEW_OR_MODEL" ]; then
        set_env_value "OPENROUTER_MODEL" "$NEW_OR_MODEL"
        print_ok "OPENROUTER_MODEL: $NEW_OR_MODEL"
      fi
    fi
    echo ""
  else
    echo ""
  fi

  print_ok "Konfiguration gespeichert in .env"
fi

# =============================================================================
# SCHRITT 3: Alexa Skill erstellen/deployen
# =============================================================================

print_header "Schritt 3 von $TOTAL_STEPS: Alexa Skill"

# .env neu laden
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^\s*$' | xargs)
fi

CURRENT_SKILL_ID=$(get_env_value "SKILL_ID")

if ! command -v ask &> /dev/null; then
  print_warn "ASK CLI nicht installiert - Skill-Erstellung uebersprungen."
  echo ""
  echo "  Um den Skill spaeter zu erstellen:"
  echo "    1. npm install -g ask-cli"
  echo "    2. ask configure"
  echo "    3. ./scripts/deploy-skill.sh"
  echo ""
elif [ -n "$CURRENT_SKILL_ID" ]; then
  print_ok "Skill bereits vorhanden: $CURRENT_SKILL_ID"
  echo ""
  if ask_yes_no "Skill jetzt aktualisieren (Manifest + Interaction Model)?" "j"; then
    echo ""
    echo "  Aktualisiere Skill..."
    bash "$SCRIPT_DIR/scripts/deploy-skill.sh"
    print_ok "Skill aktualisiert."
  fi
else
  echo "  Es wurde noch kein Skill erstellt (keine SKILL_ID in .env)."
  echo ""
  if ask_yes_no "Alexa Skill jetzt erstellen?" "j"; then
    echo ""
    echo "  Erstelle Skill..."
    bash "$SCRIPT_DIR/scripts/deploy-skill.sh"
    # SKILL_ID aus .env nachladen
    CURRENT_SKILL_ID=$(get_env_value "SKILL_ID")
    if [ -n "$CURRENT_SKILL_ID" ]; then
      print_ok "Skill erstellt: $CURRENT_SKILL_ID"
    fi
  else
    print_warn "Skill-Erstellung uebersprungen."
    echo ""
    echo "  Skill spaeter erstellen mit: ./scripts/deploy-skill.sh"
  fi
fi

# =============================================================================
# ZUSAMMENFASSUNG
# =============================================================================

print_header "Setup abgeschlossen"

# .env Werte nochmal laden
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^\s*$' | xargs)
fi

echo -e "  ${BOLD}Konfiguration:${NC}"
echo -e "  BASE_URL:      ${GREEN}${BASE_URL:-nicht gesetzt}${NC}"
echo -e "  JWT_SECRET:     ${GREEN}$([ -n "$JWT_SECRET" ] && echo "gesetzt (${#JWT_SECRET} Zeichen)" || echo "nicht gesetzt")${NC}"
echo -e "  REGION:         ${GREEN}${REGION:-AT}${NC}"
echo -e "  SKILL_ID:       ${GREEN}${SKILL_ID:-nicht gesetzt}${NC}"
[ -n "$TUNNEL_TOKEN" ] && echo -e "  TUNNEL:         ${GREEN}konfiguriert${NC}"
[ -n "$OPENROUTER_API_KEY" ] && echo -e "  AI-Summary:     ${GREEN}konfiguriert${NC}"
echo ""

echo -e "  ${BOLD}Naechste Schritte:${NC}"
echo ""

STEP=1

if [ -z "$SKILL_ID" ]; then
  echo "  $STEP. Alexa Skill erstellen:"
  echo "     ./scripts/deploy-skill.sh"
  ((STEP++))
  echo ""
fi

echo "  $STEP. Server starten:"
echo ""
echo "     Mit Docker:"
echo "       docker compose up -d"
echo ""
echo "     Ohne Docker:"
echo "       npm start"
echo ""
((STEP++))

echo "  $STEP. Testen:"
echo "     \"Alexa, oeffne mein Video\""
echo ""

echo -e "  ${CYAN}Dokumentation: README.md${NC}"
echo ""
