# MyVideo - Alexa Video Skill fuer Echo Show

Ein selbst gehosteter Alexa Skill fuer News-Junkies: Aktuelle Nachrichten aus den oeffentlich-rechtlichen Mediatheken (ARD, ZDF, ORF) direkt auf dem Echo Show - per Sprache oder Touch.

## Was kann dieser Skill?

- **Nachrichten auf einen Blick** - Beim Oeffnen zeigt der Skill die aktuellsten Nachrichtensendungen aus AT und DE: ZIB 1, ZIB 2, Spaet-ZIB, ZIB Flash, Tagesschau, heute journal
- **Kategorie-Schnellzugriff** - "Nachrichten Oesterreich", "Nachrichten Deutschland", "Sport" oder "Kultur" - eine Kategorie sagen und sofort die passenden Sendungen sehen
- **Mediathek-Suche** - Freitextsuche ueber alle oeffentlich-rechtlichen Mediatheken (ARD, ZDF, ORF, 3sat, Phoenix, ...)
- **Live-TV** - Oeffentliche Livestreams von Das Erste, ZDF, ZDFneo, ZDFinfo, 3sat, Phoenix, Tagesschau24 und mehr
- **Touch-Bedienung** - Ergebnislisten mit Senderlogos, antippen zum Abspielen, Schnellwahl-Buttons auf der Startseite
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
| `SKILL_ID` | Nein | Alexa Skill ID (fuer Validierung) |

### Cloudflare Tunnel (empfohlen)

Der einfachste Weg, den Server oeffentlich erreichbar zu machen, ist ein [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Im Container ist `cloudflared` bereits installiert - einfach `TUNNEL_TOKEN` in der `.env` setzen und der Tunnel startet automatisch.

## Alexa Skill einrichten

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
| "Nachrichten Oesterreich" | ZIB 1, ZIB 2, Spaet-ZIB, ZIB Flash |
| "Nachrichten Deutschland" | Tagesschau, heute journal, heute Xpress |
| "Sport" | Sportschau und mehr |
| "Kultur" | Kulturzeit und mehr |
| "Tagesschau" / "ZIB" | Bestimmte Nachrichtenquelle direkt |
| "Suche \<Begriff\>" | Freitextsuche in der Mediathek |
| "Nummer 1" / "Nummer 2" | Ergebnis aus der Liste abspielen |
| "Schalte auf ZDF" | Live-TV Sender starten |
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
