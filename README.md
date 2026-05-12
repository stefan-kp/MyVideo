# MyVideo - Alexa Video Skill fuer Echo Show

Ein selbst gehosteter Alexa Skill fuer News-Junkies: Aktuelle Nachrichten aus den oeffentlich-rechtlichen Mediatheken (ARD, ZDF, ORF) direkt auf dem Echo Show - per Sprache oder Touch.

## Was kann dieser Skill?

- **Nachrichten auf einen Blick** - Beim Oeffnen zeigt der Skill die aktuellsten Nachrichtensendungen aus AT und DE: ZIB 1, ZIB 2, Spaet-ZIB, ZIB Flash, Tagesschau, heute journal
- **Kategorie-Schnellzugriff** - "Nachrichten", "Sport", "Kultur" oder "Comedy" - eine Kategorie sagen und sofort die passenden Sendungen sehen
- **Mediathek-Suche** - Freitextsuche ueber alle oeffentlich-rechtlichen Mediatheken (ARD, ZDF, ORF, 3sat, Phoenix, ...)
- **Live-TV (FRITZ!Box + Oeffentlich)** - ORF 1/2/III, ServusTV, ATV, ProSieben, Das Erste, ZDF und viele mehr direkt von deiner FRITZ!Box (HD, kein Geo-Block). Sender ohne FRITZ!Box-Verbindung laufen ueber oeffentliche HLS-Streams.
- **Touch-Bedienung** - Ergebnislisten mit Senderlogos, antippen zum Abspielen, Schnellwahl-Buttons auf der Startseite
- **AI-Zusammenfassung** - Untertitel der letzten Nachrichtensendungen werden per AI zusammengefasst und vorgelesen (optional, benoetigt OpenRouter API Key)
- **Selbst gehostet** - Laeuft auf einem Raspberry Pi oder jedem Server mit Docker. Deine Daten, dein Server

## Warum ein eigener Skill?

Amazon bietet keine native Moeglichkeit, Mediathek-Inhalte auf dem Echo Show abzuspielen. Dieser Skill schliesst diese Luecke: Du erstellst einen eigenen Alexa Custom Skill in deinem Amazon Developer Account und verbindest ihn mit deinem selbst gehosteten Server. Der Skill ist dann nur fuer dich verfuegbar - keine Veroeffentlichung im Alexa Skill Store noetig.

## Voraussetzungen

- **Amazon Echo Show** (oder anderes Alexa-Geraet mit Video-Unterstuetzung)
- **Amazon Developer Account** (kostenlos unter [developer.amazon.com](https://developer.amazon.com))
- **Server mit Docker** (Raspberry Pi, NAS, VPS, ...)
- **Oeffentliche URL** fuer den Server (z.B. via Cloudflare Tunnel - ist im Container integriert)

## Schnellstart mit Docker

```bash
# docker-compose.yml und .env.example herunterladen
curl -O https://raw.githubusercontent.com/stefan-kp/MyVideo/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/stefan-kp/MyVideo/main/.env.example

# Konfiguration anlegen
cp .env.example .env
# .env anpassen (mindestens BASE_URL und JWT_SECRET setzen)

# Starten
docker compose up -d
```

Beim ersten Start werden die Senderlogos heruntergeladen und im `logos`-Volume gespeichert. Bei Neustarts sind sie sofort da.

### JWT Secret generieren

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Oder: `openssl rand -hex 32`

## Manuelle Installation (ohne Docker)

```bash
git clone https://github.com/stefan-kp/MyVideo.git
cd MyVideo
npm install

cp .env.example .env
# .env anpassen

npm start
```

## Konfiguration

| Variable | Pflicht | Beschreibung |
|----------|---------|--------------|
| `BASE_URL` | Ja | Oeffentliche URL des Servers (z.B. `https://tv.example.de`) |
| `JWT_SECRET` | Ja | Secret fuer Stream-Token-Absicherung (min. 32 Zeichen) |
| `PORT` | Nein | Interner Server-Port (Standard: `3000`) |
| `PORT_EXTERNAL` | Nein | Externer Port im Docker Compose (Standard: `3377`) |
| `REGION` | Nein | `AT` oder `DE` - bestimmt regionale Inhalte (Standard: `AT`) |
| `TUNNEL_TOKEN` | Nein | Cloudflare Tunnel Token - startet Tunnel automatisch im Container |
| `OPENROUTER_API_KEY` | Nein | OpenRouter API Key fuer AI-Zusammenfassung |
| `OPENROUTER_MODEL` | Nein | LLM Model fuer Zusammenfassung (Standard: `google/gemini-2.5-flash-lite`) |
| `SKILL_ID` | Nein | Alexa Skill ID (fuer Validierung) |
| `FRITZBOX_HOST` | Nein | IP/Hostname der FRITZ!Box (Standard: `192.168.0.1`). Aktiviert FRITZ!Box-Live-TV. |
| `FRITZBOX_USER` | Nein | FRITZ!Box-Benutzername (empfohlen: eigener User "tv" mit minimalen Rechten) |
| `FRITZBOX_PASSWORD` | Nein | Passwort dieses Benutzers |

### Cloudflare Tunnel (empfohlen)

Der einfachste Weg, den Server oeffentlich erreichbar zu machen, ist ein [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Im Container ist `cloudflared` bereits installiert - einfach `TUNNEL_TOKEN` in der `.env` setzen und der Tunnel startet automatisch.

### FRITZ!Box Live-TV (optional)

Wenn dein Server im selben Netz wie eine FRITZ!Box mit DVB-C-Funktion steht, kannst du Live-TV direkt darueber beziehen (HD, kein Geo-Block, mehr Sender - ORF 1/2/III, ServusTV, ATV usw.).

**Setup:**

1. **FRITZ!Box-Benutzer anlegen:** FRITZ!Box-Web-UI -> *System* -> *FRITZ!Box-Benutzer* -> *Neuer Benutzer*
   - Name: `tv` (oder beliebig)
   - Berechtigungen: nur **"FRITZ!Box-Einstellungen"** (alles andere abwaehlen - kein VPN, kein Smart Home, keine Anrufliste)
   - Passwort generieren und sicher merken

2. **Variablen in `.env` setzen:**
   ```
   FRITZBOX_HOST=192.168.0.1
   FRITZBOX_USER=tv
   FRITZBOX_PASSWORD=<dein-passwort>
   ```

3. **Server neu starten.** Beim Start wird die Senderliste verifiziert:
   ```
   FRITZ!Box: 26/26 Sender verifiziert (FRITZ!Box hat 69 Sender insgesamt)
   ```

**Hinweise:**
- `ffmpeg` muss installiert sein (im Docker-Image bereits enthalten; lokal: `brew install ffmpeg`)
- Bei Senderwechsel dauert das erste Segment ~1-2s (H.264-Sender) bis ~3-5s (MPEG-2)
- Sender mit oeffentlichem HLS (ARD, ZDF, 3sat, Phoenix, Tagesschau24, ARD alpha, ONE, ZDFinfo) fallen automatisch auf den oeffentlichen Stream zurueck, wenn die FRITZ!Box offline ist
- Sender ohne oeffentliche Quelle (ORF 1/2/III, ServusTV, ATV, RTL/Pro7/SAT.1, BBC World News, ...) sind dann kurz nicht verfuegbar

## Alexa Skill einrichten

### Automatisch (empfohlen)

```bash
# ASK CLI installieren und konfigurieren (einmalig)
npm install -g ask-cli
ask configure

# Skill erstellen oder aktualisieren
./scripts/deploy-skill.sh
```

Das Script erkennt automatisch, ob bereits ein Skill existiert (`SKILL_ID` in `.env`). Falls nicht, wird ein neuer erstellt und die ID gespeichert. Nach Aenderungen am Interaction Model (z.B. neue Sprachbefehle) einfach erneut ausfuehren - das Script aktualisiert Manifest und Model automatisch.

### Manuell

1. Auf [developer.amazon.com/alexa/console/ask](https://developer.amazon.com/alexa/console/ask) einloggen
2. **Create Skill** > Name: `Mein Video` > Language: `German (DE)` > Type: `Custom` > Hosting: `Provision your own`
3. **Interaction Model** > JSON Editor > Inhalt von `skill/model/de-DE.json` einfuegen > **Save** > **Build Model**
4. **Endpoint** > HTTPS > Default Region: `https://<deine-domain>/alexa` > SSL: "My development endpoint has a certificate from a trusted certificate authority"
5. **Interfaces** > **Video App** aktivieren > **Save**
6. **Test** Tab > Skill Testing: `Development` > "alexa, oeffne mein video" eingeben

Der Skill ist sofort auf allen Alexa-Geraeten verfuegbar, die mit deinem Amazon-Account verbunden sind. Eine Veroeffentlichung im Skill Store ist nicht noetig.

## Sprachbefehle

| Befehl | Beschreibung |
|--------|--------------|
| "Alexa, oeffne mein Video" | Skill starten - zeigt aktuelle Nachrichten mit Schnellwahl |
| "Thema Nachrichten" | ZIB, Tagesschau je nach Region |
| "Thema Sport" | Sport Aktuell, Bundesliga (AT) / Sportschau (DE) |
| "Thema Kultur" | kulturMONTAG (AT) / Kulturzeit (DE) |
| "Thema Comedy" | Willkommen Oesterreich (AT) / heute-show (DE) |
| "Tagesschau" / "ZIB" | Bestimmte Nachrichtenquelle direkt |
| "Suche \<Begriff\>" | Freitextsuche in der Mediathek |
| "Nummer 1" / "Nummer 2" | Ergebnis aus der Liste abspielen |
| "Schalte auf ZDF" | Live-TV Sender starten (FRITZ!Box bevorzugt, oeffentliches HLS als Fallback) |
| "Zusammenfassung" | AI-Zusammenfassung der letzten Nachrichten (benoetigt OpenRouter Key) |
| "Welche Sender gibt es" | Alle verfuegbaren Sender anzeigen |

Auf dem Echo Show koennen Ergebnisse auch per Touch angetippt werden.

## Architektur

```
Echo Show  <-->  Alexa Cloud  <-->  Dein Server (Docker)
                                      |
                                      +-- /alexa     (Skill Endpoint)
                                      +-- /proxy     (HLS Stream Proxy)
                                      +-- /logos     (Senderlogos)
                                      +-- /health    (Health Check)
```

Der Server fungiert als Proxy zwischen den Mediathek-/Livestream-Quellen und dem Echo Show. Alle Streams werden ueber JWT-gesicherte Proxy-URLs ausgeliefert.

## Entwicklung

Fuer lokale Entwicklung mit eigenem Build:

```bash
docker compose -f docker-compose.dev.yml up --build
```

## Lizenz

MIT
