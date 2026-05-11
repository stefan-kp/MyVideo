# FRITZ!Box Live-TV Integration — Design

**Datum:** 2026-05-11
**Status:** Design akzeptiert, bereit für Implementierungsplan
**Scope:** Live-TV-Streams direkt von der FRITZ!Box als Primärquelle für den MyVideo Alexa-Skill, einschließlich Source-Abstraktion, die spätere Quellen (z. B. kuratiertes YouTube) ohne Handler-Änderungen ermöglicht.

---

## 1. Ziel

Der MyVideo-Skill soll Live-TV-Sender, die heute über öffentliche HLS-Streams kommen (ARD/ZDF/3sat/etc.) sowie weitere kuratierte österreichische und internationale Sender (ORF, Pro7/SAT.1/RTL Austria, ATV, ServusTV, BBC World News etc.) **primär über die FRITZ!Box** des Anwenders abrufen können.

**Konkrete Ziele:**
- ORF 1/2/III, ATV, ServusTV, PULS 24 nutzbar machen (heute mangels öffentlichem HLS unmöglich)
- Höhere Qualität (HD statt SD) für ARD/ZDF/etc. durch FRITZ!Box-DVB-C-Tuner
- Keine Geo-Block-Probleme (ZDF-HLS ist in AT geo-blockiert; FRITZ!Box-DVB-C nicht)
- Architektur, die spätere Sources (YouTube, IPTV) ohne Eingriffe in Handler/Voice-Model erlaubt
- Vollautomatischer Betrieb, kein manuelles SID-Update durch den Anwender

**Nicht-Ziele:**
- Live-TV von unterwegs (Server und FRITZ!Box sind im selben LAN, Echo Show ist zu Hause)
- Vollständige Senderliste aller ~70 DVB-C-Sender (explizit kuratiert)
- EPG/TV-Guide, Aufnahme-Funktion (separate Features, nicht Teil dieses Specs)
- Skill öffentlich vermarkten (bleibt Single-User Self-Hosted)

---

## 2. Kontext

**Heutiger Stand:** Live-TV-Sender liegen als Map in [`streams.json`](../../../streams.json), werden in [`lib/channels.js`](../../../lib/channels.js) zu einer Lookup-Tabelle aufgebaut, und der [`PlayChannelHandler`](../../../skill/handlers/PlayChannelHandler.js) baut beim Sprachbefehl eine signierte Proxy-URL auf den HLS-Stream. Der Server hat bereits einen funktionalen Legacy-Pfad ([`scripts/start-stream.sh`](../../../scripts/start-stream.sh)) für RTSP-zu-HLS-Transcoding via FFmpeg, der jedoch nur manuell und für einen einzelnen Sender startbar ist und in der `.env` als "Phase 2, noch nicht implementiert" markiert ist.

**FRITZ!Box-Stream-Setup:**
- HTTP-Endpoint `http://${HOST}/dvb/m3u/<tunerId>.m3u?sid=<SID>` liefert eine M3U-Playlist mit einer `rtsp://...`-URL (SAT>IP-Stream)
- Senderliste (HD): `http://${HOST}/dvb/tvhd.lua` (HTML)
- Login: `/login_sid.lua?version=2` mit PBKDF2-HMAC-SHA256-Challenge-Response
- SID läuft nach ~30 Min Inaktivität ab (HTTP 403 als Trigger für Re-Login)

**Architektur-Annahmen:**
- Server (Docker/Pi) läuft im selben LAN wie FRITZ!Box, kann `192.168.0.1` und die ausgelieferten RTSP-URLs (typisch `224.0.0.x`-Multicast oder unicast in 192.168.0.x) direkt erreichen
- Echo Show ist ebenfalls zu Hause und ruft den HLS-Output via Cloudflare-Tunnel ab (oder direkt im LAN, wenn `BASE_URL` so konfiguriert)

---

## 3. Architektur-Übersicht

```
                                                  ┌─────────────────────┐
   ┌───────────┐      ┌─────────────────┐         │   FRITZ!Box (LAN)   │
   │ Echo Show │◀─────│  MyVideo Server │◀───────▶│ /login_sid.lua      │
   │           │ HLS  │                 │ HTTP/   │ /dvb/tvhd.lua       │
   └───────────┘      │  ┌───────────┐  │ RTSP    │ /dvb/m3u/<tid>.m3u  │
                      │  │ Handlers  │  │         │ rtsp://...          │
                      │  └─────┬─────┘  │         └─────────────────────┘
                      │        │        │
                      │  ┌─────▼─────┐  │
                      │  │ Channel-  │  │
                      │  │ Registry  │  │
                      │  └─────┬─────┘  │
                      │   resolveStream │
                      │     ┌──┴──┐     │
                      │     │     │     │
                      │  ┌──▼──┐ ┌▼───┐ │
                      │  │ HLS │ │FB! │ │   ← Source-Adapter
                      │  └─────┘ └─┬──┘ │
                      │            │    │
                      │  ┌─────────▼──┐ │
                      │  │ FFmpeg     │ │  ← single slot
                      │  │ RTSP→HLS   │ │
                      │  └────────────┘ │
                      └─────────────────┘
```

Drei Schichten:
1. **Source-Abstraktion** — einheitliches Channel-Interface mit `resolveStream()`
2. **FRITZ!Box-Adapter** — Login/SID, Channel-Discovery, M3U-Resolver
3. **FFmpeg-Pipeline** — single-slot State-Machine, smart codec choice

---

## 4. Komponenten-Design

### 4.1 Source-Abstraktion (`lib/sources/`)

**Channel-Interface (logisch, JS hat kein Interface-Keyword):**

```js
interface Channel {
  id: string;                   // stabile interne ID (slug): "orf1", "dasErsteHd"
  displayName: string;          // "ORF 1", "Das Erste"
  synonyms: string[];           // ["orf eins", "orf1"] für Voice
  logoUrl: string;              // Server-Logo-URL
  group: string;                // "ORF", "Privat AT", "Öffentlich DE", "International"
  source: 'hls' | 'fritzbox' | 'youtube';
  resolveStream(): Promise<{
    url: string;                // HLS-URL, signiert, an Alexa weitergebbar
    mimeType: string;           // 'application/vnd.apple.mpegurl'
    isLive: boolean;
  }>;
}
```

**Konkrete Implementierungen:**

- **`HlsSource`** (`lib/sources/hlsSource.js`)
  - Wickelt heutige Sender aus `streams.json`
  - `resolveStream()` ruft `checkStreamAvailable()`, baut die `${BASE_URL}/proxy/live/${id}/master.m3u8?token=${jwt}`-URL wie heute, returns
  - Bei 403/Timeout/Unreachable: wirft Error mit Grund

- **`FritzboxSource`** (`lib/sources/fritzboxSource.js`)
  - `resolveStream()` ruft `fritzboxStreamer.start(channel)` → wartet auf erstes Segment → returns `${BASE_URL}/stream/fritzbox/index.m3u8?token=${jwt}`
  - Bei FFmpeg-Failure: wirft Error

- **`YoutubeSource`** (später, `lib/sources/youtubeSource.js`, nicht Teil dieses Specs)
  - `resolveStream()` würde `yt-dlp` aufrufen, neuste Episode einer Playlist holen, ggf. repackagen

**Channel-Registry (`lib/channels.js` Update):**

Die heutige `loadChannels()`-Funktion wird umgebaut zu einer Multi-Source-Registry. Jeder finale Channel-Eintrag hat eine stabile **interne ID** (Slug), die nicht mit FRITZ!Box-TunerIDs oder den heutigen Keys aus `streams.json` zu verwechseln ist.

Das Merge-Mapping wird in einer Mapping-Tabelle in `lib/channels.js` explizit deklariert:

```js
// Channel-Slug → { primary: Source-Definition, fallback?: Source-Definition }
const CHANNEL_DEFINITIONS = {
  // Sender mit FRITZ!Box-Primary + HLS-Fallback
  dasErsteHd:     { primary: { src: 'fritzbox', id: 'dasErsteHd' },     fallback: { src: 'hls', id: 'Das_Erste' } },
  zdfHd:          { primary: { src: 'fritzbox', id: 'zdfHd' },          fallback: { src: 'hls', id: 'ZDF_HD' } },
  3satHd:         { primary: { src: 'fritzbox', id: '3satHd' },         fallback: { src: 'hls', id: '3sat_HD' } },
  phoenixHd:      { primary: { src: 'fritzbox', id: 'phoenixHd' },      fallback: { src: 'hls', id: 'Phoenix_HD' } },
  tagesschau24Hd: { primary: { src: 'fritzbox', id: 'tagesschau24Hd' }, fallback: { src: 'hls', id: 'Tagesschau24' } },
  ardAlphaHd:     { primary: { src: 'fritzbox', id: 'ardAlphaHd' },     fallback: { src: 'hls', id: 'ARD_alpha' } },
  oneHd:          { primary: { src: 'fritzbox', id: 'oneHd' },          fallback: { src: 'hls', id: 'ONE' } },
  zdfinfoHd:      { primary: { src: 'fritzbox', id: 'zdfinfoHd' },      fallback: { src: 'hls', id: 'ZDFinfo_HD' } },

  // Sender nur FRITZ!Box (kein HLS-Pendant)
  orf1:    { primary: { src: 'fritzbox', id: 'orf1' } },
  orf2t:   { primary: { src: 'fritzbox', id: 'orf2t' } },
  // ...weitere ORF/Privat/International
};
```

Channel mit Fallback hat eine kleine Wrapper-Klasse `ChannelWithFallback` die `resolveStream()` auf primary versucht und bei Fehler auf fallback umschwenkt. Sender ohne Fallback werfen den Original-Error.

`findChannel()`, `findChannelById()`, `listChannels()` behalten ihre Signatur — keine Änderung an Aufrufern außer dem PlayChannelHandler.

### 4.2 FRITZ!Box-Adapter (`lib/fritzbox/`)

**`lib/fritzbox/session.js` — Login & SID:**

```js
class FritzboxSession {
  async getSid(): Promise<string>;             // cached, lazy-fetch
  async invalidate(): void;                    // forciert neuen Login
  async withSid<T>(fn: (sid: string) => Promise<T>): Promise<T>;
                                               // Wrapper mit 1x Retry bei 403
}
```

- Login: Challenge holen → SHA256-PBKDF2-Hash → SID einsacken
- SID im Memory cached (keine Persistenz nötig — eine Re-Login-Latenz pro Server-Start ist OK)
- `invalidate()` wird automatisch aufgerufen, wenn ein Downstream-Call (`m3uResolver`, `channels.verify`) HTTP 403 liefert
- `withSid()` retried genau einmal — schlägt es ein zweites Mal fehl, wird der Fehler propagiert

**`lib/fritzbox/channels.json` — Kuratierte Liste (eingecheckt):**

26 Sender, jeder Eintrag `{ tunerId, displayName, synonyms, group }`. Inhalt:

| ID | TunerID | DisplayName | Group |
|---|---|---|---|
| orf1 | 40200_1010 | ORF 1 | ORF |
| orf2t | 40200_1020 | ORF 2 Tirol | ORF |
| orf3 | 41800_3020 | ORF III | ORF |
| servustv | 41000_2010 | ServusTV | Privat AT |
| atv | 40200_1030 | ATV | Privat AT |
| puls24 | 45000_7010 | PULS 24 | Privat AT |
| pro7at | 42600_4040 | ProSieben | Privat DE |
| sat1at | 42600_4020 | SAT.1 | Privat DE |
| rtlat | 42600_4030 | RTL | Privat DE |
| voxat | 43400_5030 | VOX | Privat DE |
| dasErsteHd | 41000_2020 | Das Erste | Öffentlich DE |
| zdfHd | 41000_2030 | ZDF | Öffentlich DE |
| 3satHd | 42600_4010 | 3sat | Öffentlich DE |
| arteHd | 44200_6030 | arte | Öffentlich DE |
| phoenixHd | 46600_9040 | Phoenix | Öffentlich DE |
| tagesschau24Hd | 49000_12010 | Tagesschau 24 | Öffentlich DE |
| zdfinfoHd | 57000_22040 | ZDFinfo | Öffentlich DE |
| ardAlphaHd | 58600_24010 | ARD alpha | Öffentlich DE |
| oneHd | 49000_12030 | ONE | Öffentlich DE |
| kikaHd | 45800_8030 | KiKA | Öffentlich DE |
| orfSport | 45000_7030 | ORF SPORT+ | Sport |
| bbcWorld | 53000_17010 | BBC World News | International |
| aljazeera | 60200_26030 | Al Jazeera English | International |
| france24 | 53000_17040 | France 24 | International |
| cnbc | 53000_17020 | CNBC | International |
| nhk | 58600_24030 | NHK World | International |

**`lib/fritzbox/discovery.js` — Verifikation der TunerIDs:**

```js
async function verifyOnStart(): Promise<{ ok: string[], missing: string[] }>;
```

Beim Server-Start (oder lazy beim ersten Request, falls Start-Verify fehlschlägt):
1. `GET /dvb/tvhd.lua` (FRITZ!Box-HTML der HD-Senderliste)
2. Parse alle `<a title="..." href="dvb/m3u/(\d+_\d+)\.m3u">` Einträge
3. Vergleiche mit `channels.json` — pro Eintrag: ist die TunerID noch in der FRITZ!Box vorhanden?
4. Fehlende IDs werden als Warning geloggt, betroffene Sender deaktiviert (resolveStream wirft "Sender derzeit nicht verfügbar")
5. Lazy-Recovery: Nächster `resolveStream()` versucht erneut

**`lib/fritzbox/m3uResolver.js` — RTSP-URL holen:**

```js
async function getRtspUrl(tunerId: string): Promise<string>;
```

- `GET http://${HOST}/dvb/m3u/${tunerId}.m3u?sid=${sid}`
- Antwort ist plaintext M3U; eine Zeile beginnt mit `rtsp://...`, das ist die Ziel-URL
- Cached pro TunerID für 1h (RTSP-URLs ändern sich selten; Refresh ist günstig)
- Bei 403: SID invalidieren, einmal retry

### 4.3 FFmpeg-Pipeline (`lib/fritzbox/streamer.js`)

**Public API:**

```js
async function start(channel: Channel): Promise<string>;   // returns HLS-URL-Pfad
async function stop(): Promise<void>;
function getCurrent(): { channelId, startedAt, status } | null;
```

**State-Maschine (single slot):**

States: `IDLE`, `STARTING(channel)`, `PLAYING(channel)`, `STOPPING(channel)`

Übergänge:
- `IDLE`     + `start(A)`  → `STARTING(A)` — FFmpeg spawn, Output nach `stream/fritzbox/`
- `STARTING` + erstes Segment auf Platte → `PLAYING(A)`, Promise resolve
- `STARTING` + Timeout 10s ODER FFmpeg-Exit → `IDLE`, Promise reject mit Grund
- `PLAYING`  + `start(A)` → no-op, return aktuelle URL
- `PLAYING`  + `start(B)` → `STOPPING(A)` → nach Exit `STARTING(B)`
- `PLAYING`  + `stop()`   → `STOPPING(A)` → `IDLE`
- `PLAYING`  + FFmpeg crashed → 1× Auto-Restart desselben Senders, dann `IDLE` mit Error-Event

**Concurrency-Garantien:**
- Mehrere `start(A)`-Calls währenddessen `STARTING(A)` läuft → alle warten auf dieselbe Promise
- `start(B)` während `STARTING(A)` → A wird abgebrochen, B startet
- Keine zwei FFmpeg-Prozesse parallel, niemals

**Codec-Strategie (`lib/fritzbox/codecProbe.js`):**

Beim allerersten `start()` eines Senders wird `ffprobe` gegen die RTSP-URL ausgeführt (max. 3s, `-analyzeduration 2000000`). Ergebnis pro TunerID in `.cache/codec-probe.json` gecached (persistent über Restart):

```json
{
  "40200_1010": { "video": "h264", "audio": "ac3", "pipeline": "copy", "probedAt": "2026-05-11T18:00:00Z" },
  "44200_6030": { "video": "mpeg2video", "audio": "mp2", "pipeline": "transcode", "probedAt": "2026-05-11T18:01:00Z" }
}
```

**Pipeline "copy"** (H.264-Sender — der Normalfall bei HD):
```
ffmpeg -rtsp_transport udp -i <rtsp> \
  -map 0:v:0 -map 0:a:0 \
  -c:v copy \
  -c:a aac -b:a 128k -ac 2 \
  -hls_time 4 -hls_list_size 3 -hls_flags delete_segments+append_list \
  -hls_segment_type mpegts \
  -hls_segment_filename "stream/fritzbox/seg_%03d.ts" \
  -f hls "stream/fritzbox/index.m3u8"
```

**Pipeline "transcode"** (MPEG-2-Sender):
Wie [`scripts/start-stream.sh`](../../../scripts/start-stream.sh) — `libx264 main level 3.1 veryfast`, 1500k, 540p, AAC 128k.

Bei Pipeline-Fehler (z. B. Sender ändert tatsächlich Codec): Cache-Eintrag invalidieren, nächster `start()` re-probed.

**Lifecycle-Garantien:**
- `SIGTERM`/`SIGINT` auf Node-Prozess → FFmpeg sauber beenden (`process.on('exit', ...)`)
- Inaktivitäts-Timeout: 4h kein neuer `start()` → FFmpeg stoppen, FRITZ!Box-Tuner freigeben
- Stop schickt zuerst `SIGTERM`, nach 2s `SIGKILL` (FFmpeg hängt manchmal auf RTSP-Sockets)

**Output-Schutz:**
Der heutige `/stream/`-Endpoint in [`server.js`](../../../server.js) wird beibehalten, aber JWT-geschützt (heute ist er offen — das ist ein Cleanup-Punkt). Token enthält Channel-ID, sodass nur die *aktuelle* Sender-URL gültig ist. Bei Senderwechsel werden alte Tokens ungültig.

### 4.4 Alexa-Integration

**`PlayChannelHandler` — minimal-invasive Änderung:**

```js
// Vorher
const channel = channels.findChannel(channelName);
const check = await checkStreamAvailable(channel.url);
if (!check.available) return /* error */;
const token = generateStreamToken(channel.id);
const streamUrl = `${BASE_URL}/proxy/live/${channel.id}/master.m3u8?token=${token}`;

// Nachher
const channel = channels.findChannel(channelName);
let stream;
try {
  stream = await channel.resolveStream();
} catch (err) {
  return /* "Sender derzeit nicht verfügbar" */;
}
// stream.url wird an Alexa weitergereicht
```

`checkStreamAvailable()`-Logik wandert in `HlsSource.resolveStream()`. `generateStreamToken()`-Logik wandert in beide Source-Implementierungen.

**Voice-Model (`skill/model/de-DE.json`):**

Der `CHANNEL_NAME`-Slot wird um alle 26 Sender-Werte erweitert. Synonyme aus `lib/fritzbox/channels.json` werden direkt eingetragen. Update via `./scripts/deploy-skill.sh`.

**LaunchHandler / APL — Live-TV-Quickbar als erste Reihe:**

Reihenfolge auf der Startseite:
1. **Live-TV-Quickbar** (8 Logos, antippbar): ORF 1, ORF 2 Tirol, ORF III, ServusTV, ATV, ProSieben, Das Erste, ZDF
2. Mediathek-Nachrichten (heutige Layout)

Touch-Event auf Logo → existierender `TouchEventHandler` empfängt `APL.UserEvent` mit `{ action: 'playChannel', channelId: 'orf1' }`, ruft `PlayChannelHandler`-Logik mit der Channel-ID statt Voice-Slot.

**Kategorie-Quick-Actions (`PlayCategoryHandler`):**

- `Thema Sport` → zusätzliche Live-Kachel **ORF SPORT+** mit Logo, antippbar
- `Thema Kultur` → zusätzliche Live-Kachel **ORF III** mit Logo, antippbar
- Voice-Output am Ende ergänzt: "...oder sage 'ORF Sport plus' für den Livestream."

**`ListChannelsIntent`:**

Kein Code-Change nötig — `channels.listChannels()` liefert automatisch die erweiterte Liste, gruppiert nach `group`-Feld.

---

## 5. Konfiguration

**Neue `.env`-Variablen:**

```bash
# FRITZ!Box (optional - bei leerem User läuft Skill nur mit HLS-Fallback)
FRITZBOX_HOST=192.168.0.1
FRITZBOX_USER=tv
FRITZBOX_PASSWORD=<minimal-rechte-passwort>
```

**FRITZ!Box-User-Setup (Anwender-Dokumentation):**
- FRITZ!Box-Web-UI → System → FRITZ!Box-Benutzer
- Neuer User "tv" mit nur "FRITZ!Box-Einstellungen"-Berechtigung
- Kein VPN, kein Smart Home, keine Anrufliste — minimale Angriffsfläche

**Entfernte Konfiguration:**
- `STREAM_URL` aus `.env.example` (war Legacy für `start-stream.sh`)
- `STREAM_URL`-Hinweis aus README

---

## 6. Deployment

**Docker:**
- `Dockerfile` ergänzt: `RUN apk add --no-cache ffmpeg` (~50 MB Image-Wachstum)
- Default Bridge-Network reicht (Server kann FRITZ!Box-IP im LAN erreichen)

**Implementierungs-Phasen:**

Phase A — Source-Abstraktion ohne FRITZ!Box:
1. `lib/sources/hlsSource.js` mit Channel-Interface
2. `lib/channels.js` umstellen auf Registry mit Source-Pattern
3. `PlayChannelHandler` ruft `resolveStream()` statt URL-Build
4. Test: Alles funktioniert wie vorher

Phase B — FRITZ!Box:
5. `lib/fritzbox/session.js`
6. `lib/fritzbox/channels.json` (Daten) + `lib/fritzbox/discovery.js` (Verify)
7. `lib/fritzbox/m3uResolver.js`
8. `lib/fritzbox/codecProbe.js`
9. `lib/fritzbox/streamer.js`
10. `lib/sources/fritzboxSource.js`
11. Channel-Registry-Merge (Primary FRITZ!Box, Fallback HLS)
12. Bestehenden `/stream/`-Endpoint in `server.js` mit JWT-Auth absichern (heute offen — Cleanup)

Phase C — UI:
13. Voice-Model um neue Sender erweitern + deploy
14. Live-TV-Quickbar in `aplHelper` + `LaunchHandler`
15. Kategorie-Quickactions (ORF SPORT+, ORF III)
16. Logo-Download-Script um neue Logo-URLs erweitern

Phase D — Cleanup:
17. `STREAM_URL` und `scripts/start-stream.sh` entfernen
18. README-Update: FRITZ!Box ist First-Class-Feature

---

## 7. Testing

**Unit-Tests:**
- `lib/fritzbox/session.js` — Login-Flow mit mock-HTTP, Challenge-Response korrekt, Auto-Renew bei 403
- `lib/fritzbox/m3uResolver.js` — M3U-Parsing extrahiert RTSP-URL
- `lib/sources/hlsSource.js` und `fritzboxSource.js` — `resolveStream()`-Erfolg + Fehler-Pfade
- Channel-Registry-Merge: Primary + Fallback verhalten sich korrekt

**Integration-Test (manuell, lokal):**
- `npm run dev:test-fritzbox <channelId>` — Script startet einen Sender, wartet 10s, validiert erstes Segment per `ffprobe`, stoppt sauber. Loggt verwendete Pipeline (copy/transcode).

**End-to-End:**
- Mit Echo Show: "Schalte auf ORF 1" → Video läuft
- "Schalte auf ZDF" → bekommt FRITZ!Box-Version (HD), nicht öffentliches HLS
- FRITZ!Box im laufenden Betrieb ausschalten → nächster "Schalte auf ZDF" liefert HLS-Fallback
- Touch auf Live-TV-Logo auf Startseite → Stream startet

---

## 8. Risiken & Mitigationen

| Risiko | Mitigation |
|---|---|
| FRITZ!Box-SID läuft nach ~30 Min ab | Auto-Renew bei 403 in `session.withSid()`, einmaliger Retry |
| FRITZ!Box-Suchlauf ändert TunerIDs | `verifyOnStart()` loggt fehlende IDs; betroffene Sender deaktiviert; manuelles Update von `channels.json` (DocReferenz im Code-Kommentar) |
| FFmpeg crasht mitten in Wiedergabe | 1× Auto-Restart desselben Senders, dann Error |
| Mehrere parallele Voice-Commands ("schalte auf X" hintereinander) | State-Maschine garantiert single slot, deterministisches Verhalten |
| ffprobe-Cache stale (Sender ändert Codec) | Bei Pipeline-Fehler: Cache-Eintrag invalidieren, neu proben |
| FRITZ!Box-Tuner alle belegt (~4 gleichzeitig) | Single-slot heißt nur 1 Tuner belegt; Inaktivitäts-Timeout 4h gibt Tuner frei |
| AC3-Audio (Echo Show unverträglich) | Beide Pipelines re-encoden Audio auf AAC |
| FRITZ!Box komplett offline beim Server-Start | `verifyOnStart()` fängt das ab, loggt, deaktiviert FRITZ!Box-Sender; HLS-Fallback aktiv; Lazy-Recovery beim ersten Request danach |
| `192.168.0.1` ist im Tunnel-Kontext nicht erreichbar | Server läuft per Spec im selben LAN; bei Cloudflare-Tunnel-Setup ist die FRITZ!Box trotzdem direkt erreichbar, weil Server *im LAN* steht und nur den HLS-Output durch den Tunnel schickt |
| Voice-Model nicht aktualisiert nach neuen Sendern | `deploy-skill.sh` läuft manuell, Doku im README |

---

## 9. YAGNI — Bewusst nicht gebaut

- Auto-Discovery aller ~70 FRITZ!Box-Sender (explizit kuratiert)
- Multi-Stream parallel (single slot reicht)
- EPG / "Was läuft jetzt?" (eigenes Feature)
- Aufnahme-Funktion (eigenes Feature)
- Live-TV von unterwegs (Tunnel zur FRITZ!Box wäre nötig)
- Web-UI zum Sender-Editieren (manuelle JSON-Pflege ist OK für Single-User-Skill)
- Real-time-Refresh des Voice-Models bei Channel-Änderungen (Deploy-Script läuft manuell)

---

## 10. Erweiterungs-Pfade (späteres Spec, nicht hier)

**Kuratiertes YouTube:** `YoutubeSource` mit `resolveStream()` ruft `yt-dlp` für die neueste Episode einer Playlist (z. B. Jimmy Kimmel). Channel-Eintrag wie heute, nur `source: 'youtube'`, plus `playlistUrl`. Handler unverändert.

**EPG-Integration:** Zusätzliches Modul `lib/fritzbox/epg.js` (FRITZ!Box hat EPG-Endpoints). Anzeige auf Startseite "Jetzt auf ORF 1: …". Kein Eingriff in Source-Abstraktion.

**Aufnahme:** FFmpeg-Pipeline könnte parallel zu HLS-Output auch eine MP4-Aufnahme schreiben. Eigene Handler, eigene Session-State.

---

## 11. Akzeptanz-Kriterien

- [ ] "Schalte auf ORF 1" startet ORF 1 in HD über FRITZ!Box auf Echo Show
- [ ] "Schalte auf ZDF" startet ZDF über FRITZ!Box (HD), nicht über öffentliches HLS
- [ ] Bei FRITZ!Box-Ausfall (Stromaus): "Schalte auf ZDF" fällt auf öffentliches HLS zurück; "Schalte auf ORF 1" sagt "derzeit nicht verfügbar"
- [ ] Startseite zeigt erste Reihe mit 8 Live-TV-Logos, Touch startet den Sender
- [ ] "Thema Sport" zeigt ORF SPORT+ als zusätzliche Live-Kachel
- [ ] "Thema Kultur" zeigt ORF III als zusätzliche Live-Kachel
- [ ] Senderwechsel von einem FRITZ!Box-Sender zu einem anderen funktioniert ohne Race-Condition (max. 1 FFmpeg-Prozess zu jeder Zeit)
- [ ] FRITZ!Box-SID-Ablauf wird automatisch erkannt und SID erneuert, ohne dass der User es merkt
- [ ] Mediathek-Funktionen (Search, Categories, Summary) bleiben unverändert funktionsfähig
- [ ] `npm test` bleibt grün
- [ ] README dokumentiert FRITZ!Box-User-Setup und neue `.env`-Variablen
