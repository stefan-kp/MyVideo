# MyVideo - Alexa Video Skill fuer Echo Show

Alexa Skill zum Streamen von oeffentlich-rechtlichen Mediathek-Inhalten und Live-TV auf dem Echo Show.

## Features

- **Nachrichten** - ZIB, Tagesschau, heute journal und mehr aus den Mediatheken
- **Kategorie-Schnellzugriff** - "Nachrichten Oesterreich", "Sport", "Kultur" etc.
- **Mediathek-Suche** - Freitextsuche in ARD/ZDF/ORF Mediatheken
- **Live-TV** - DVB-C Sender ueber Fritz!Box Proxy (Das Erste, ZDF, ORF, 3sat, ...)
- **Touch-Display** - APL-Oberflaeche mit Senderlogos und Ergebnislisten auf Echo Show
- **Cloudflare Tunnel** - Integrierter Tunnel fuer sicheren Zugriff ohne Portfreigabe

## Voraussetzungen

- **Amazon Echo Show** (oder anderes Alexa-Geraet mit Display)
- **Amazon Developer Account** (kostenlos) fuer den Custom Skill
- **Docker** oder **Node.js >= 18**
- Optional: Fritz!Box mit DVB-C fuer Live-TV

## Schnellstart mit Docker Compose

```bash
git clone https://github.com/stefan-kp/MyVideo.git
cd MyVideo

cp .env.example .env
# Werte anpassen: BASE_URL, JWT_SECRET, ...

docker compose up -d
```

Logos werden beim ersten Start heruntergeladen und im `logos`-Volume gespeichert, sodass sie bei Neustarts nicht erneut geladen werden muessen.

Alternativ ohne Compose:

```bash
docker run -d --name myvideo \
  --env-file .env \
  -p 3000:3000 \
  -v myvideo-logos:/app/public/logos \
  ghcr.io/stefan-kp/myvideo:latest
```

## Manuelle Installation

```bash
git clone https://github.com/stefan-kp/MyVideo.git
cd MyVideo
npm install

cp .env.example .env
# .env Datei anpassen

npm start
```

## Environment Variables

| Variable | Pflicht | Beschreibung |
|----------|---------|--------------|
| `PORT` | Nein | Server-Port (Standard: 3000) |
| `BASE_URL` | Ja | Oeffentliche URL (z.B. `https://tv.example.de`) |
| `JWT_SECRET` | Ja | Secret fuer Proxy-Token (min. 32 Zeichen) |
| `TUNNEL_TOKEN` | Nein | Cloudflare Tunnel Token (startet Tunnel automatisch) |
| `TUNNEL_HOSTNAME` | Nein | Cloudflare Tunnel Hostname |
| `TUNNEL_CNAME` | Nein | Cloudflare Tunnel CNAME |
| `SKILL_ID` | Nein | Alexa Skill ID |
| `STREAM_URL` | Nein | Fritz!Box DVB-C Stream URL |

`JWT_SECRET` generieren:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Alexa Skill einrichten

1. Auf [developer.amazon.com](https://developer.amazon.com/alexa/console/ask) neuen Custom Skill erstellen
2. Invocation Name: `mein video`
3. Interaction Model: Inhalt von `skill/model/de-DE.json` ins JSON-Editor-Feld kopieren
4. Endpoint: HTTPS, URL `https://<deine-domain>/alexa`
5. Interfaces: "Video App" aktivieren
6. Build & Test

## Sprachbefehle

| Befehl | Beschreibung |
|--------|--------------|
| "Alexa, oeffne mein Video" | Skill starten, zeigt alle Nachrichten |
| "Nachrichten" | Aktuelle Nachrichten anzeigen |
| "Tagesschau" / "ZIB" | Bestimmte Nachrichtenquelle |
| "Nachrichten Oesterreich" | Kategorie: AT-Nachrichten |
| "Nachrichten Deutschland" | Kategorie: DE-Nachrichten |
| "Sport" | Kategorie: Sport |
| "Kultur" | Kategorie: Kultur |
| "Suche \<Begriff\>" | Mediathek durchsuchen |
| "Nummer 1" / "Nummer 2" | Ergebnis aus Liste abspielen |
| "Schalte auf ZDF" | Live-TV Sender |
| "Welche Sender gibt es" | Senderliste anzeigen |

## Lizenz

MIT
