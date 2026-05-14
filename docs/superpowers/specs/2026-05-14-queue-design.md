# Watch-Queue + UI-Verbesserungen — Design

**Datum:** 2026-05-14
**Status:** Design akzeptiert, bereit für Implementierung
**Scope:** Persistente Wiedergabe-Queue, vom Web-UI (Mac/Handy/Browser) pflegbar, am Echo Show per Voice startbar. Plus kleine UI-Filter im /diag/ui.

---

## 1. Ziel

Eine **Watch-Queue** als Fernbedienung-Pattern: Im Browser/Handy stöbern, "merken für später", abends auf den Echo Show "Spiele meine Queue" sagen. Items werden beim Start aus der Queue entfernt.

Zwei zusätzliche kleine UI-Verbesserungen:
- Filter-Tabs (Alle/Filme/Serien/Eigene) im "Neueste Files"-Tab
- "+Queue"-Buttons auf Suche-/Newest-Listen

**Nicht-Ziele:**
- Watch-Progress-Tracking (Echo Show liefert keine Events)
- Multi-User-Queues (Single-User Self-Hosted bleibt)
- Auto-Next nach Episoden-Ende
- Live-TV-Sender in der Queue

---

## 2. Datenstruktur

**Queue-Item** (in `data/queue.json` persistiert):

```js
{
  id: "<uuid>",              // queue-internal stable id
  source: "local" | "mediathek",
  // bei source=local:
  contentId: "filme/inception-2010",
  // bei source=mediathek:
  url: "https://...",        // direct video URL (m3u8 oder mp4)
  // gemeinsam (cached für Anzeige):
  title: "Inception",
  subtitle: "Filme",         // oder "ZIB 1 - ORF" bei mediathek
  duration: 7200,            // sekunden, 0 wenn unbekannt
  imageUrl: "...",           // optional, mediathek hat oft thumbs
  addedAt: "2026-05-14T18:00:00Z",
}
```

**Datei `data/queue.json`**:

```json
{
  "version": 1,
  "items": [ ... ]
}
```

Atomic write via temp + rename. Beim Start: laden falls existiert, sonst leere Liste.

---

## 3. Module

**`lib/queue.js`** — Persistente Queue-Datenstruktur:

```js
class Queue {
  load(file)                    // sync, called at startup
  save()                        // sync, atomic
  list()                        // returns items (array)
  add(itemInput)                // appends, returns full item with id+addedAt
  remove(id)                    // by queue-item-id
  reorder(id, direction)        // 'up' | 'down'
  clear()
  pop()                         // returns + removes first item
  peek(n = 1)                   // returns first n without removing
}
```

Singleton zugänglich via `getInstance()`.

**Default location**: `data/queue.json`. Override via `QUEUE_FILE` env var.

**Init**: Beim Server-Start parallel zum Content-Service. Wenn `data/`-Volume nicht da → bestmöglich (memory-only Fallback mit Warning-Log).

---

## 4. HTTP-Routes

Unter `/diag/queue/*` (LAN-only, wie bestehende `/diag/*` Routen — keine extra Auth nötig):

- `GET /diag/queue` — komplette Liste
- `POST /diag/queue` — body: `{source, contentId?, url?, title, subtitle?, duration?, imageUrl?}` → fügt hinzu, returns item
- `DELETE /diag/queue/:id` — entfernt
- `POST /diag/queue/:id/up` — verschiebt rauf
- `POST /diag/queue/:id/down` — verschiebt runter
- `POST /diag/queue/clear` — leert komplett

`POST` mit `application/json` body. Express `express.json()`-middleware ist neu — muss vor dem queue-router montiert werden.

**Validation**: bei local source muss `contentId` ein gültiger Index-Eintrag sein. Bei mediathek source muss `url` HTTPS sein.

---

## 5. Voice-Integration

**Zwei neue Intents (`skill/model/de-DE.json`):**

```json
{
  "name": "PlayQueueIntent",
  "slots": [],
  "samples": [
    "spiele meine queue",
    "spiele queue",
    "nächstes aus queue",
    "was ist als nächstes dran",
    "spiele die queue ab",
    "starte queue"
  ]
},
{
  "name": "QueuePeekIntent",
  "slots": [],
  "samples": [
    "was ist als nächstes",
    "was steht in der queue",
    "zeige queue",
    "was ist in meiner queue"
  ]
}
```

**`PlayQueueHandler`**:

1. `queue.pop()` → erstes Item, oder null
2. Wenn null: speak "Deine Queue ist leer. Du kannst über das Web-Interface Sachen hinzufügen."
3. Wenn `source: 'local'` → `contentSource.resolveStream(item.contentId)` → `addVideoAppLaunchDirective(...)`
4. Wenn `source: 'mediathek'` → direkt `item.url` als Directive
5. Save queue (das `pop` hat schon entfernt)

**`QueuePeekHandler`**:

1. `queue.peek(3)` → top 3 (ohne removing)
2. Wenn leer: "Deine Queue ist leer."
3. Sonst: "In der Queue: 1. {title}. 2. {title}. ..."
4. Plus APL-List wenn supported (wie `renderNewsList`)

---

## 6. Launch-Screen-Erweiterung

Neue **Queue-Reihe ganz oben** (vor Live-TV-Quickbar) wenn Items in Queue sind. Wenn leer → nicht rendern.

`renderLaunchScreen` bekommt neuen Parameter `queue` (Array). APL-Template kriegt ein optionales Container-Element mit `when: ${launchData.properties.queue.length > 0}` ganz oben in der Items-Liste.

Layout: horizontale Reihe mit großen Kacheln (Titel, Subtitle, Pos-Nummer 1/2/3). Touch auf Kachel → sendet `selectQueueItem` event (analog zu `selectChannel`/`selectContent`) → spielt das Item ab und entfernt aus Queue.

`TouchEventHandler` bekommt einen `selectQueueItem`-Branch.

---

## 7. Web-UI-Erweiterungen (`public/diag/index.html`)

**Neuer Tab "Queue"** mit:
- Liste der Items (Position, Titel, Source-Pill, Add-Date)
- Pro Item: ↑ ↓ ✕ Buttons
- "Leeren" Knopf am Ende
- Auto-Refresh alle 5s

**Filter-Tabs auf "Lokale Sammlung"-Tab**:
- Buttons "Alle | Filme | Serien | Eigene" über der Newest-Tabelle
- Klick filtert die `/diag/content/newest`-Anfrage mit `?label=Filme`
- Aktiver Filter highlightet
- Suche-Tab kriegt analog einen Filter (optional jetzt — könnte später kommen)

**"+Queue"-Buttons**:
- In der Newest-Liste pro Zeile
- In der Suche-Liste pro Zeile (nur für `source='local'`-Treffer und Mediathek-Ergebnisse mit `url`)
- Klick → `POST /diag/queue` mit dem Eintrag + Toast "In Queue"

---

## 8. Tests

- `test/queue.test.js`: add/remove/reorder/pop/peek/save/load roundtrip + edge cases (leer, missing file)
- E2E: manuelle Tests im UI

Bestehende Tests dürfen nicht brechen.

---

## 9. YAGNI

- Kein Watch-State, kein Resume
- Kein Drag-and-Drop (nur Up/Down-Buttons)
- Kein QR-Code-Sharing
- Kein Queue-pro-User
- Keine Multi-Device-Sync (wenn 2 Browser parallel die Queue editieren — last-write-wins, akzeptiert)
- Kein "Mark as watched" separates Konzept — pop() entfernt sofort beim Start
