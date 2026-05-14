# YouTube Playlist Integration — Design

**Datum:** 2026-05-14
**Status:** Design akzeptiert, bereit für Implementierung
**Scope:** Konfigurierbare YouTube-Playlists, Crawl-on-Demand im Web-UI, Download via yt-dlp, Videos erscheinen als normale ContentEntries im Index und sind über Queue/Voice abrufbar.

---

## 1. Ziel

YouTube-Inhalte (private/unlisted Playlists) als zusätzliche Content-Quelle einbinden, die sich **wie lokale Files verhält**: Videos werden als MP4 in einen lokalen Pfad heruntergeladen, der vom existierenden Content-Scanner indiziert wird. Damit funktionieren Suche, Queue, Direct-Play und Touch-UI automatisch.

---

## 2. Entscheidungen (aus Klärung)

- **yt-dlp als Standalone-Binary** im Dockerfile (Auto-Update via `yt-dlp -U`)
- **On-Demand-Download** beim "+Queue"-Click — kein Background-Polling
- **Playlists werden im UI verwaltet** und in `data/youtube-playlists.json` persistiert (NICHT in `config/`)
- **Manueller "Aktualisieren"-Button** pro Playlist (kein Auto-Crawl)
- **Einzelvideos**: User legt sich auf YouTube eine eigene unlisted Playlist an
- **Auto-Cleanup**: Dateien älter als N Tage werden gelöscht (default 7), ausgenommen sind Items die gerade in der Queue stehen
- **Format**: 720p-MP4 H.264+AAC (direct-playable), konfigurierbar via env
- **Pfad**: `data/youtube/<playlist-slug>/<videoId>-<title>.mp4` — Content-Service mountet diesen Pfad als zusätzlichen Index-Pfad mit Label "YouTube"

---

## 3. Module

### `lib/youtube/playlists.js`
Persistente Liste konfigurierter Playlists (`data/youtube-playlists.json`).

**Schema:**
```js
{
  version: 1,
  playlists: [
    {
      id: "<uuid>",
      label: "Jimmy Kimmel",          // user-facing label
      slug: "jimmy-kimmel",            // for filesystem path
      url: "https://www.youtube.com/playlist?list=...",
      playlistId: "PL...",             // extracted from URL
      cleanupDays: 7,                  // auto-delete files older than this
      addedAt: "2026-05-14T...",
      lastCrawledAt: null,
      videos: [                        // cached from last crawl
        {
          videoId: "abc123",
          title: "Episode Title",
          duration: 1800,              // seconds
          uploadDate: "20260513",
          downloaded: false,           // true once yt-dlp has fetched it
          downloadedPath: null,        // absolute path if downloaded
          downloadedAt: null,
        },
      ],
    },
  ],
}
```

**API:**
- `getInstance()` → singleton
- `load(file)`, `save()`
- `list()`, `findById(id)`, `findBySlug(slug)`
- `add({url, label, cleanupDays})` → extracts playlistId from URL, creates slug, appends, returns object
- `remove(id)`
- `updateVideos(id, videos)` → replaces video cache after crawl
- `markDownloaded(id, videoId, absPath)` → updates `videos[].downloaded`

### `lib/youtube/crawler.js`
Calls `yt-dlp --flat-playlist --print-json <url>` to fetch playlist metadata (no download). Returns array of `{videoId, title, duration, uploadDate}`. Cached on the playlist object.

### `lib/youtube/downloader.js`
Calls `yt-dlp -f "<format>" -o "<output-template>" <videoUrl>` to download a single video to `data/youtube/<slug>/`. Output filename pattern: `%(id)s-%(title).80s.%(ext)s`. Returns absolute path of downloaded file.

Format selector via env: `YOUTUBE_FORMAT_SELECTOR` (default `bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]`).

### `lib/youtube/cleanup.js`
Periodic task (runs every 6h via `setInterval`):
1. For each playlist, walk `data/youtube/<slug>/`
2. For each file: if `mtime > cleanupDays`, AND file is **not** in the queue, delete
3. Update playlist's `videos[].downloaded` flag if file was removed

---

## 4. HTTP-Routes (`/diag/youtube/*`)

- `GET /diag/youtube/playlists` — list configured playlists with cached videos
- `POST /diag/youtube/playlists` — body `{url, label, cleanupDays?}` → creates playlist
- `DELETE /diag/youtube/playlists/:id` — removes (also deletes downloaded files)
- `POST /diag/youtube/playlists/:id/crawl` — triggers `yt-dlp --flat-playlist`, updates `videos[]` cache, returns updated playlist
- `POST /diag/youtube/playlists/:id/download/:videoId` — triggers `yt-dlp` for that video, when done returns the new content-id (slug in the content index) so the UI can immediately call the existing `+Queue` flow

All gated by existing LAN-only `isLanRequest()`.

---

## 5. Content-Service-Integration

`lib/content/service.js` is extended:
- On `init()`, **always** add a synthetic path-config for YouTube:
  ```js
  {
    label: 'YouTube',
    path: path.join(__dirname, '..', '..', 'data', 'youtube'),
    newerThanDays: 14,
    recursive: true,
    type: 'auto',
  }
  ```
- This is **prepended** to `_config.paths` so user's `content-paths.json` is untouched
- Initially `data/youtube` doesn't exist — scanner tolerates that (Task 5's `scanPath` already returns `[]` for missing paths)
- After a YouTube download, the next periodic rescan picks it up automatically

Plus: a manual rescan is triggered immediately after a successful download (`contentService.rescan()`) so the new file appears in the index without waiting for the periodic timer.

---

## 6. Dockerfile

Add yt-dlp binary download after the cloudflared step:

```dockerfile
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
    -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version
```

The binary is a self-contained Python zipapp (~3 MB), runs anywhere.

`ffmpeg` is already installed (needed for FRITZ!Box transcode) — yt-dlp uses it for merging video+audio streams.

---

## 7. Web-UI

New "YouTube"-Tab between "Queue" and "Lokale Sammlung":

```
[ Add playlist URL ] [ Label ] [+ Hinzufügen]

┌─ Jimmy Kimmel Monologe ─────────────────────────────────────────┐
│ Letzter Crawl: vor 2h · 12 Videos · 3 heruntergeladen           │
│ [Aktualisieren] [Entfernen]                                     │
│                                                                  │
│ ✓ Jimmy Kimmel Sat 13.05 · 23:42  [In Queue]                    │
│ ⬇ Trump Speech Commentary · 22:15  [Download + Queue]           │
│ ⬇ Last Week Highlights · 18:30     [Download + Queue]           │
└──────────────────────────────────────────────────────────────────┘
```

- `[Aktualisieren]` → POST `/diag/youtube/playlists/:id/crawl` → reload list
- `[Download + Queue]` → POST `/diag/youtube/playlists/:id/download/:videoId` → wait for response (spinner) → POST `/diag/queue` with `source: 'local'` + new contentId
- `[In Queue]` button (after download) directly adds to queue (no re-download)

---

## 8. Tests

- `test/youtubePlaylists.test.js`: load/save, add/remove, updateVideos, markDownloaded
- Crawler + downloader sind subprocess-based; tested via mock spawn (similar to existing `fritzboxStreamer.test.js` pattern)

---

## 9. Risiken

| Risiko | Mitigation |
|---|---|
| yt-dlp veraltet, YouTube ändert sich | `--update` Subkommando + self-update aufrufbar via diag-route oder cron |
| Download zu groß | 720p-Cap + Plattenplatz-Cleanup via N-Tage-Rule |
| Download bricht ab | yt-dlp returnt non-zero; HTTP-Route gibt Fehler an UI weiter |
| Cleanup löscht aktuelles Queue-Item | Cleanup excludiert alle Files die aktuell `downloadedPath` in einem queue-item haben |
| Playlist ist private | yt-dlp braucht keinen Login für unlisted (das ist der Use Case) |
| Mehrere Downloads gleichzeitig | Mutex pro Playlist; queue für sequentielle Downloads |
| Lange Filenamen | `%(title).80s` truncated auf 80 Zeichen |

---

## 10. YAGNI

- Kein Background-Polling (manueller Crawl reicht)
- Keine Authentication für YouTube (nur unlisted/public)
- Keine YouTube-Suche im UI (Playlist-Hinzufügen muss vom User auf YouTube vorbereitet werden)
- Kein Resume bei abgebrochenem Download (yt-dlp's `--continue` ist by default an, aber wir behandeln Fehler simpel als "nochmal versuchen")
- Keine Per-Playlist Format-Selectoren
- Keine Cookies/Login-Unterstützung
