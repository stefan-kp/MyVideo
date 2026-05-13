# Lokale Inhalte (NAS-Filme & Serien) — Design

**Datum:** 2026-05-12
**Status:** Design akzeptiert, bereit für Implementierungsplan
**Scope:** Lokale Videodateien (Filme, Serien, eigene Aufnahmen) durchsuchbar und über Voice + Touch auf dem Echo Show abspielbar machen. YouTube-Integration ist explizit **nicht** Teil dieses Specs — wird als eigenständiges Folge-Feature gebaut, das nur Files in einen lokalen Pfad dropt, der dann von dieser Pipeline indiziert wird.

---

## 1. Ziel

Der MyVideo-Skill soll lokale Videodateien — typischerweise auf einem NAS gemountet als Bind-Volume — wie eine zusätzliche Mediathek behandeln:

- Konfigurierbare Pfade pro Setup (`Filme`, `Serien`, `Eigene` o. Ä.)
- Voice-Search ("suche Tatort", "spiele Better Call Saul")
- Touch-Navigation auf Echo Show
- "Was gibt's Neues" zeigt zuletzt hinzugefügte Files
- Direct-Play für kompatible Formate (H.264/AAC/MP4), Transcoding via existierendem FFmpeg-Streamer für alles andere
- Vollständige Wiederverwendung der Source-Abstraktion und FFmpeg-Pipeline aus dem FRITZ!Box-Feature

**Nicht-Ziele:**
- Watch-History / Resume-Funktion
- Plex/Jellyfin-Metadata-Integration
- Mehrere parallele Streams (Single-Slot bleibt)
- VOD-Modus mit unendlichem Buffer
- Automatisches Generieren des Voice-Slot-Modells aus der Pfad-Config
- Episode-Auto-Next ("nächste Folge nach Ende")

---

## 2. Kontext

**Heutige Architektur:**

- `lib/sources/Channel.js` definiert das Source-Interface (`resolveStream()` → `{url, mimeType, isLive}`)
- `lib/fritzbox/streamer.js` ist eine single-slot State-Machine für FFmpeg, aktuell auf RTSP-Quellen ausgelegt
- `lib/fritzbox/audioPicker.js` wählt die richtige Audio-Spur via ffprobe
- `lib/mediathek.js` macht Volltextsuche gegen MediathekViewWeb-API
- `skill/handlers/SearchMediathekHandler.js` ist das bestehende Suche-Pattern (Index in Session-Attribut, dann "Nummer N" zum Auswählen)
- Stream-Auslieferung in `server.js` mit JWT-Token und m3u8-Rewriting

Das Source-Abstraktions-Pattern war von Anfang an mit dieser Erweiterung im Hinterkopf entworfen — wir hängen jetzt eine neue Content-Quelle daneben.

**Annahmen:**

- NAS ist via SMB/NFS am Pi-Host gemountet (z. B. `/mnt/nas/videos`)
- Docker bekommt das Verzeichnis als read-only Bind-Mount nach `/content`
- Files sind nach gängiger Konvention benannt (eine Show pro Ordner, episodische Files mit `SxxEyy`-Markern oder ähnlich)
- `parse-torrent-name`-Heuristik deckt ~95 % der real existierenden Dateinamen ab
- Größenordnung: ~2000-3000 Files gesamt

---

## 3. Architektur-Übersicht

```
                                           ┌─────────────────────────┐
                                           │  NAS Bind-Mount         │
                                           │  /content/{Filme,TV,…}  │
                                           └──────────┬──────────────┘
                                                      │
   ┌──────────────────────────────────────────────────▼───────────────┐
   │  MyVideo Server                                                  │
   │                                                                  │
   │  ┌────────────────┐    ┌──────────────────┐    ┌─────────────┐   │
   │  │ ContentScanner │───►│ ContentIndex     │◄───│ Search      │   │
   │  │ (period. 30m)  │    │ (in-mem + JSON)  │    │ (voice/UI)  │   │
   │  └────────────────┘    └────────┬─────────┘    └─────────────┘   │
   │                                  │                                │
   │                       ┌──────────▼─────────┐                      │
   │                       │ ContentSource      │                      │
   │                       │ resolveStream(id)  │                      │
   │                       └──┬─────────────┬───┘                      │
   │                          │             │                          │
   │            direct-play  │             │  transcode                │
   │                          ▼             ▼                          │
   │                   ┌──────────┐  ┌──────────────────┐              │
   │                   │/content/ │  │ Streamer (reuse) │              │
   │                   │ <id>.mp4│  │  -i <local file> │              │
   │                   └──────────┘  └─────────┬────────┘              │
   │                                            ▼                      │
   │                                  /stream/fritzbox/index.m3u8      │
   │                                            ▼                      │
   └────────────────────────────────────────────┬──────────────────────┘
                                                ▼
                                        ┌───────────────┐
                                        │  Echo Show    │
                                        └───────────────┘
```

Drei Schichten:
1. **Scanner & Index** — kennt alle Files, persistiert in JSON
2. **Suche** — Voice + Touch, mischt mit Mediathek
3. **Wiedergabe** — Direct-Play oder Transcode via existierender FFmpeg-Pipeline

---

## 4. Komponenten-Design

### 4.1 Konfiguration

**`config/content-paths.example.json`** (eingecheckt, generisch):

```json
{
  "_comment": "Kopiere zu content-paths.json (in .gitignore) und passe die Pfade an.",
  "paths": [
    {
      "label": "Filme",
      "path": "/content/movies",
      "newerThanDays": 90,
      "recursive": true,
      "type": "movie"
    },
    {
      "label": "Serien",
      "path": "/content/tv",
      "newerThanDays": 60,
      "recursive": true,
      "type": "episode"
    },
    {
      "label": "Eigene",
      "path": "/content/home",
      "newerThanDays": null,
      "recursive": true,
      "type": "auto"
    }
  ],
  "extensions": {
    "directPlayCandidates": [".mp4", ".m4v"],
    "transcodeOnly":         [".mkv", ".avi", ".mov", ".ts", ".webm", ".wmv"]
  },
  "excludePatterns": ["sample", "trailer", "_UNPACK_", "@eaDir", ".partial", ".DS_Store"]
}
```

**Pfad-Felder:**
- `label`: Anzeigename in UI und Voice-Befehlen
- `path`: absoluter Container-Pfad
- `newerThanDays`: `null` = alles immer in "Was gibt's Neues", `N` = nur Files mit `mtime > now - N` werden in Neu-Listen gezeigt (Index enthält trotzdem alle Files — "weiche" Filterung)
- `recursive`: rekursiv vs. nur direkter Ordner
- `type`: `movie` | `episode` | `auto` (parser entscheidet anhand `SxxEyy`-Pattern)

**Datei `config/content-paths.json`** in `.gitignore` — pro Host individuell.

**`.env`-Erweiterungen** (optional, alle mit guten Defaults):

```
CONTENT_CONFIG_PATH=/app/config/content-paths.json
CONTENT_RESCAN_MINUTES=30
```

**`docker-compose.yml`** (Beispiel-Erweiterung, vom Anwender anzupassen):

```yaml
volumes:
  - /mnt/nas/videos:/content:ro
  - ./config:/app/config:ro
  - ./data:/app/data
```

`data/` muss in `.gitignore`.

### 4.2 Indexer (`lib/content/`)

**Modulaufteilung:**

- `lib/content/paths.js` — lädt + validiert `content-paths.json`
- `lib/content/parser.js` — Filename-Parsing (`parse-torrent-name` Wrapper)
- `lib/content/scanner.js` — durchläuft konfigurierte Pfade, erzeugt `ContentEntry`-Objekte
- `lib/content/index.js` — in-Memory-Datenstruktur mit Search-API + Persistenz
- `lib/content/contentSource.js` — Wiedergabe-Logik (Direct-Play vs. Transcode)
- `lib/content/codecProbe.js` — Lazy ffprobe pro File mit persistentem Cache

**Schema `ContentEntry`:**

```js
{
  id: "tv/better-call-saul/s04e06-pinata",  // slug, stabil
  path: "/content/tv/Better Call Saul/Season 4/S04E06 - Pinata.mkv",
  pathLabel: "Serien",
  filename: "S04E06 - Pinata.mkv",
  ext: ".mkv",
  size: 1547892341,
  mtime: "2026-04-15T20:42:11Z",
  type: "episode",            // movie | episode | other
  title: "Pinata",            // episoden-titel oder film-titel
  show: "Better Call Saul",   // nur bei episode
  season: 4,                  // nur bei episode
  episode: 6,                 // nur bei episode
  year: null,                 // nur bei movie wenn parser ihn findet
  codecInfo: null             // null bis lazy-probed; danach { video, audio, container, directPlay: bool }
}
```

**Slug-Schema:**

- Movie: `<pathLabel>/<title>-<year>` z. B. `filme/inception-2010`
- Episode: `<pathLabel>/<show>/sXXeYY-<title>` z. B. `serien/better-call-saul/s04e06-pinata`
- Bei Kollision: `<slug>-<8charhash>`

Alle slugs lowercase, Sonderzeichen → `-`, Umlaute auflösen (ae/oe/ue/ss).

**Persistenz `data/content-index.json`:**

```json
{
  "scannedAt": "2026-05-12T18:30:00Z",
  "entries": [ { ContentEntry }, ... ],
  "version": 1
}
```

Atomic-write via temp + rename. Bei Schema-Version-Mismatch komplett neu scannen.

**Scanner-Verhalten:**

1. Beim Server-Start:
   - Lade `content-index.json` falls vorhanden (sofort verfügbar)
   - Wenn fehlt oder älter als 24h: Hintergrund-Full-Scan starten
   - Server ist immer sofort responsiv, auch wenn Index gerade neu gebaut wird
2. Periodisch alle `CONTENT_RESCAN_MINUTES` (Default 30):
   - Inkrementaler Scan: nur Files mit `mtime > lastScannedAt` re-parsen, Codec-Cache bleibt
   - Gelöschte Files werden aus dem Index entfernt
3. Manuell via `POST /diag/content/reindex` — full re-scan

**Excludes:**

- File-Extensions außerhalb `directPlayCandidates ∪ transcodeOnly` werden ignoriert
- Pfad-Komponente matcht `excludePatterns` (case-insensitive substring) → ignoriert
- Files unter 1 MB ignoriert (verhindert teaser/sample versehentlich indizieren)

### 4.3 Codec-Probe (`lib/content/codecProbe.js`)

Lazy-Pattern, wie bei FRITZ!Box.

```js
async function probeIfNeeded(entry): Promise<CodecInfo>
```

- Wenn `entry.codecInfo` bereits gesetzt → return as is
- Sonst: `ffprobe -v error -show_streams -print_format json <path>` (5s Timeout)
- Bestimme `directPlay`:
  - `entry.ext ∈ {.mp4, .m4v}` AND `video === 'h264'` AND `audio === 'aac'` AND `video.level <= 41`
- Speichere in `entry.codecInfo`, persistiere den Index
- Bei probe-Fehler: `codecInfo = { directPlay: false, error: '...' }` → fallback zu transcode

### 4.4 Wiedergabe (`lib/content/contentSource.js`)

**Public API:**

```js
async function resolveStream(itemId): Promise<{ url, mimeType, isLive: false }>
```

Logik:

1. Lookup `entry = index.findById(itemId)` — bei Miss → throw "unbekanntes File"
2. `codecInfo = await codecProbe.probeIfNeeded(entry)`
3. `token = generateStreamToken(entry.id)`
4. Bei `codecInfo.directPlay`:
   - `url = ${BASE_URL}/content/${entry.id}/file.mp4?token=${token}`
   - `mimeType = 'video/mp4'`
5. Sonst:
   - `streamer.start({ source: 'local', id: entry.id, displayName: entry.title, inputPath: entry.path, audioMap: <picked or null> })`
   - `url = ${BASE_URL}/stream/fritzbox/index.m3u8?token=${token}`
   - `mimeType = 'application/vnd.apple.mpegurl'`

**Streamer-Erweiterung (`lib/fritzbox/streamer.js`):**

Der bestehende Streamer kriegt einen `source`-Parameter, der zwischen RTSP-Live und lokalem File unterscheidet:

```js
streamer.start({
  source: 'fritzbox' | 'local',
  id, displayName,
  // bei source==='fritzbox':
  tunerId,
  // bei source==='local':
  inputPath,
  audioMap,
});
```

In `copyArgs`/`transcodeArgs`:
- `source === 'fritzbox'`: `-rtsp_transport udp -buffer_size 8388608 -i <rtspUrl>`
- `source === 'local'`: `-i <inputPath>` (kein RTSP-Wrapping)

Restliche FFmpeg-Args bleiben gleich. Die Streamer-State-Machine (single-slot, loading-placeholder, idle-timeout) funktioniert für beide Quellen identisch.

**HLS-Window-Größe bei Transcode** wird auf `hls_list_size 30` (statt 3) erhöht, damit Echo Show Pause bis ~3 Min toleriert. Bei Live-TV bleibt 3 (kein Sinn länger zu puffern wenn's eh kontinuierlich läuft).

→ Konkret: `hls_list_size` wird `source`-abhängig: `'fritzbox' → 3`, `'local' → 30`.

**audioPicker-Refactoring:**

Heutiger Cache-Key ist `tunerId`. Neu: generischer Key — `tunerId` bei Live-TV, `entry.id` bei lokalen Files. `pickAudioMap(cacheKey, inputSourceForFFprobe)` — Input ist entweder RTSP-URL oder lokaler Pfad.

**Audio-Picker greift nur im Transcode-Pfad.** Bei Direct-Play wird die MP4-Datei 1:1 ausgeliefert; falls sie mehrere Audio-Spuren enthält, wählt der Echo-Show-Player selbst (in der Regel die erste). Wir akzeptieren das — Direct-Play soll möglichst kein Code-Pfad anfassen, der Wiedergabe-Last erzeugt. Wenn ein konkretes MP4-File die falsche Standardspur hat, kann der Anwender erzwingen, dass es transkodiert wird (Workaround: Extension umbenennen zu `.m4v` ist nicht hilfreich; sauberer Workaround wäre als späteres Feature ein `forceTranscode`-Override pro File).

### 4.5 Stream-Auslieferung (`server.js` neuer Route-Block)

```js
const contentRouter = express.Router();
contentRouter.use(authMiddleware());
contentRouter.get('/:id/file.mp4', (req, res) => {
  const entry = contentIndex.findById(req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  // JWT-sub muss matchen
  if (req.tokenPayload.sub !== entry.id) return res.status(403).json({ error: 'token mismatch' });
  res.sendFile(entry.path);  // express handles Range-headers + Content-Type
});
app.use('/content', contentRouter);
```

`res.sendFile` mit Range-Support nativ.

### 4.6 Suche (`lib/content/search.js`)

```js
function searchLocal(query, opts = {}): ContentEntry[]
function findNewest(opts = {}): ContentEntry[]
function findExactEpisode(show, season, episode): ContentEntry | null
function findLatestEpisode(show): ContentEntry | null
```

**`searchLocal(query)`:**

- Normalisiere `query` (lowercase, Umlaute auflösen, Sonderzeichen weg)
- Token-basierter Match gegen `entry.title`, `entry.show`, `entry.filename`
- Score nach Match-Qualität:
  - Exakter Show-Match: höchste Priorität
  - Token-Match in Show + Title: hoch
  - Token-Match in Filename: mittel
  - Substring-Match: niedrig
- Sortiert nach Score, dann `mtime` absteigend
- Default-Limit 10

**`findNewest({ label, limit = 20, uniquePerShow = true, newerThanDaysOnly = true })`:**

- Filter alle Entries nach `label` (falls gesetzt)
- Wenn `newerThanDaysOnly`: skippe Entries älter als path's `newerThanDays`
- Wenn `uniquePerShow`: pro Show nur jüngste Episode
- Sortiere nach `mtime` desc
- Limit anwenden

**`findLatestEpisode(showQuery)`:**

- Fuzzy-Match auf `entry.show` (token-basiert)
- Filter alle Episoden der Show
- Sortiere nach `season desc, episode desc`
- Erste zurückgeben

### 4.7 Alexa-Integration

**Neue Intents (`skill/model/de-DE.json`):**

```json
{
  "name": "SearchEverythingIntent",
  "slots": [{ "name": "query", "type": "AMAZON.SearchQuery" }],
  "samples": [
    "suche {query}",
    "finde {query}",
    "suche nach {query}",
    "gibt es {query}",
    "hast du {query}"
  ]
},
{
  "name": "SearchContentIntent",
  "slots": [{ "name": "query", "type": "AMAZON.SearchQuery" }],
  "samples": [
    "suche {query} lokal",
    "suche {query} in meiner sammlung",
    "suche lokal nach {query}",
    "finde {query} lokal"
  ]
},
{
  "name": "ListNewContentIntent",
  "slots": [{ "name": "label", "type": "CONTENT_LABEL" }],
  "samples": [
    "was gibt es neues",
    "zeige neues",
    "was ist neu",
    "neue {label}",
    "was gibt es neues bei {label}",
    "zeige neue {label}"
  ]
},
{
  "name": "PlayShowIntent",
  "slots": [
    { "name": "show", "type": "AMAZON.SearchQuery" },
    { "name": "season", "type": "AMAZON.NUMBER" },
    { "name": "episode", "type": "AMAZON.NUMBER" }
  ],
  "samples": [
    "spiele {show}",
    "starte {show}",
    "spiele {show} folge {episode}",
    "spiele {show} episode {episode}",
    "spiele {show} staffel {season} folge {episode}",
    "weiterschauen {show}"
  ]
}
```

Plus neuer Slot-Typ `CONTENT_LABEL` mit hardcoded Werten `Filme`, `Serien`, `Eigene` (Synonyme: `Film` → `Filme`, `Serie` → `Serien` etc.).

**Neue Handler (`skill/handlers/`):**

- `SearchEverythingHandler.js` — local + mediathek gemischt
- `SearchContentHandler.js` — nur lokal
- `ListNewContentHandler.js` — `index.findNewest(...)`
- `PlayShowHandler.js` — `findExactEpisode` / `findLatestEpisode`

**Erweiterung `PlayMediathekResultHandler.js`:**

Heutiger Code spielt `result.url` direkt ab. Neu: er prüft `result.source`:

```js
if (result.source === 'local') {
  const stream = await contentSource.resolveStream(result.id);
  url = stream.url;
} else {
  url = result.url;  // wie heute
}
responseBuilder.addVideoAppLaunchDirective(url, result.title, ...);
```

**Erweiterung `TouchEventHandler.js`:**

Zwei neue Aktionen:

- `selectContent` mit `contentId` — startet das File direkt (wie `selectChannel` aber für Content)
- `selectShow` mit `showName` — wie `PlayShowHandler` ohne season/episode → letzte Episode

**Erweiterung `LaunchHandler.js`:**

Neue Reihe "Neu in deiner Sammlung" auf der Startseite zwischen Live-TV-Quickbar und Mediathek-Nachrichten. Wenn `index.findNewest({ limit: 6 })` leer ist, wird die Reihe ausgeblendet (Layout fällt auf heute zurück).

**APL-Template-Änderung:**

`skill/apl/LaunchTemplate.json` bekommt einen optionalen `recentContent`-Container zwischen Quickbar und News-Sequence. Touch sendet `selectContent` mit der Content-ID.

**Was unverändert bleibt:**

- `SearchMediathekHandler` (gezielt Mediathek bleibt funktionsfähig)
- `PlayChannelHandler` (Live-TV)
- `PlayCategoryHandler` (Nachrichten/Sport/Kultur)
- `SummaryHandler` (AI-Zusammenfassung)
- `ListChannelsHandler`
- Alle FRITZ!Box-Module

---

## 5. Diag-Endpoints

Zusätzlich zu den FRITZ!Box-Diag-Routen (LAN-only-Gate wiederverwendet):

- `GET /diag/content/stats` — pro Pfad: Anzahl Files, letzter Scan, älteste/jüngste mtime
- `GET /diag/content/search?q=<query>` — manuell Voice-Search testen
- `GET /diag/content/item/:id` — voller Index-Eintrag (path, codec, parsed fields)
- `POST /diag/content/reindex` — Full-Scan triggern
- `GET /diag/content/config` — geladene `content-paths.json` zurückgeben

---

## 6. Testing

**Unit-Tests:**

- `lib/content/parser.js` — typische Filenames + Edge-Cases (Filme mit Zahlen, Sonderzeichen, multi-language tags)
- `lib/content/index.js` — slug-Erzeugung, Kollisions-Handling, search-Scoring
- `lib/content/search.js` — `findNewest` (uniquePerShow, label-Filter), `findExactEpisode` (fuzzy show-match)
- `lib/content/contentSource.js` — Direct-Play vs. Transcode-Entscheidung, mock streamer
- `lib/fritzbox/streamer.js` — beide source-Modi (existing tests + neue für source: 'local')

**Integration-Tests:**

- `scripts/test-content.js` (analog zu `scripts/test-fritzbox.js`):
  - `--scan <pathConfig>` — scannt einen Pfad, zeigt Index-Output
  - `--play <id>` — startet Wiedergabe, zeigt Pipeline-Entscheidung
  - `--search <query>` — zeigt Suche-Treffer
- Auf dem Pi: manueller End-to-End mit echtem NAS-Mount

**End-to-End auf Echo Show:**

- "Was gibt's neues" → Liste zeigt jüngste Files, top 3 vorgelesen
- "Suche Tatort" → lokal + Mediathek gemischt
- "Spiele Better Call Saul" → letzte Episode startet
- "Spiele Better Call Saul Staffel 2 Folge 5" → spezifische Episode
- Switch Live-TV ↔ lokales File ↔ Live-TV funktioniert
- Pause auf direct-play file funktioniert
- MKV mit HEVC startet (Transcode)
- MP4 mit H.264 startet direkt ohne FFmpeg-Prozess

---

## 7. Risiken & Mitigationen

| Risiko | Mitigation |
|---|---|
| NAS-Mount nicht verfügbar beim Server-Start | Scanner loggt Warnung, deaktiviert betroffenen Pfad, Server startet trotzdem |
| Filename-Parser missdeutet Titel (z. B. "2012" der Film) | Heuristik akzeptiert ~95%, Override-Mechanismus als Folge-Feature |
| MKV mit HEVC (Echo Show inkompatibel) | Transcode-Pipeline wandelt zu H.264, kostet CPU während Wiedergabe |
| Riesige Files, ffprobe braucht zu lange | Probe-Timeout 5s, bei Timeout fallback zu Transcode |
| Periodischer Re-Scan trifft auf File-Lock (Video gerade kopiert) | Probe überspringen, beim nächsten Scan erneut versuchen |
| Index ist nach Server-Restart leer | Beim Start zuerst persistente JSON laden, parallel Hintergrund-Re-Scan |
| Slug-Kollision (zwei Files mit gleichem Titel/Show/Episode) | Hash-Suffix anhängen, ID bleibt stabil |
| FFmpeg-Slot-Konflikt (Live-TV läuft, User startet lokales File) | Single-Slot: alter Stream wird sauber gestoppt, neuer startet |
| Echo Show buffering bei großem MP4 (z. B. 4 GB Film) | Range-Requests durch `express.static`-Pattern, Echo Show seekt selber |
| Pause zu lang bei Transcode (> 3 min) | `hls_list_size 30` = 3 min Buffer, danach Stream-Loss → User startet neu |
| Sehr lange Erst-Scan-Zeit bei riesigem Index | Server-Start ist nicht blockiert (lazy load), Re-Scan ist inkrementell |

---

## 8. YAGNI — Bewusst nicht gebaut

- Watch-History, Resume, Auto-Next-Episode
- Plex/Jellyfin/Kodi-Metadata-Lookups
- Filesystem-Watcher (zu unzuverlässig über NAS-Mounts)
- VOD-Modus mit unendlichem HLS-Buffer
- Mehrere parallele Streams
- Dynamische Slot-Modell-Generierung aus Config
- Override-Mechanismus für falsch geparste Filenames (`.nfo`/JSON pro File)
- YouTube-Integration (eigenes Folge-Spec)
- Pre-Encoding zu MP4 im Hintergrund (würde Disk verdoppeln)
- Bitrate-/Auflösungs-Wahl pro File (Reuse der globalen FRITZBOX_*-Settings)

---

## 9. Erweiterungs-Pfade (späteres Spec)

**Watch-History & Resume:**
JSON-Log letzter Plays (`{itemId, source, playedAt}`), max 100 Einträge. Voice-Befehl "spiele weiter" → jüngster Eintrag. "Spiele Better Call Saul" → suche jüngsten Eintrag dieser Show, spiele nächste Episode. Startseiten-Reihe "Weitergucken".

**YouTube-Auto-Download:**
Cron-Job (täglich oder adaptiv) lädt via `yt-dlp` neueste Episoden von kuratierten Playlists in `/content/youtube/<show>/`. Files erscheinen automatisch im normalen Index. Auto-Cleanup nach N Tagen.

**Override-Mechanismus für Parser:**
Neben einem File darf optional `<filename>.json` liegen mit korrekten Metadaten, die den Parser-Output überschreiben.

---

## 10. Akzeptanz-Kriterien

- [ ] `config/content-paths.example.json` eingecheckt mit generischen Pfaden
- [ ] `config/content-paths.json` in `.gitignore`, lokal anlegbar
- [ ] `data/` in `.gitignore`, content-index.json persistiert
- [ ] Server-Start mit/ohne NAS-Mount nicht-blockierend
- [ ] Beim Start: Index aus JSON laden (schnell), Hintergrund-Re-Scan parallel
- [ ] Alle `CONTENT_RESCAN_MINUTES` Minuten inkrementelles Re-Scan
- [ ] `POST /diag/content/reindex` triggert full re-scan
- [ ] "Suche Tatort" liefert local + mediathek gemischt
- [ ] "Suche Tatort lokal" liefert nur lokal
- [ ] "Suche Tatort in der Mediathek" funktioniert unverändert
- [ ] "Was gibt's Neues" zeigt top 20 (smart-mix, pro show 1, newerThanDays-gefiltert)
- [ ] "Was gibt's neues bei Filmen" filtert nach Label
- [ ] "Spiele Better Call Saul" spielt höchste Episode
- [ ] "Spiele Better Call Saul Folge 5" spielt S01E05
- [ ] "Spiele Better Call Saul Staffel 3 Folge 7" spielt S03E07
- [ ] H.264-MP4 startet direct-play, kein FFmpeg-Prozess
- [ ] MKV/HEVC startet transcode via Streamer
- [ ] Loading-Placeholder wirkt auch bei lokalen Files
- [ ] Switch Live-TV → lokales File: alter Stream stoppt, neuer startet
- [ ] Switch lokales File → Live-TV: umgekehrt
- [ ] Echo Show kann pausieren (direct-play: native, transcode: ~3 min)
- [ ] Touch auf Tile in Startseiten-Reihe "Neu in deiner Sammlung" startet Wiedergabe
- [ ] Diag-Endpoints `/diag/content/{stats, search, item/:id, reindex, config}` funktionieren (LAN-only)
- [ ] Bestehende Features (FRITZ!Box, Mediathek-Suche, Nachrichten, Summary) bleiben unverändert
- [ ] `npm test` bleibt grün
- [ ] README dokumentiert NAS-Setup, Pfad-Config, `.env`-Variablen
