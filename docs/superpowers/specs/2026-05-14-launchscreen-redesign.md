# LaunchScreen Redesign — Echo Show APL

Status: Design-Spec akzeptiert, bereit für Implementierung
Datum: 2026-05-14
Autor: ui-designer (Spec) + User (Entscheidungen)
Implementiert: nein

---

## 1. IST-Analyse

Das aktuelle `skill/apl/LaunchTemplate.json` (365 Zeilen) versucht in einem Screen zu zeigen:

- Titel "Aktuelle Nachrichten" (32dp)
- Queue-Row (horizontal, ohne `direction:"row"` Wrap-Kontrolle — auf Show 5 läuft das aus dem Bild)
- Live-TV-Quickbar mit **8** Sender-Logos à 60×40dp
- Recent-Content-Row (horizontal)
- Eine scrollbare Sequence mit den News-Sektionen, jede mit 22dp-Titel und 18dp-Metadaten
- Rechte 35%-Spalte: Logo + Headline "Sage: Thema ..." + vier Kategorie-Buttons

### Konkrete Probleme

1. **Touch-Targets unter Limit.** Die Sender-Logos sind 60×40dp + 6dp Padding → Frame ca. 72×52dp. Amazons Echo-Show-Empfehlung sind **80dp** Mindestkante für Primärtargets, bei Show 5 (Finger auf Brusthöhe, Arm gestreckt) eher 100dp. Die Queue-Cards haben weder Mindestbreite noch Mindesthöhe gesetzt — bei einem 8-Zeichen-Titel sind sie wahrscheinlich unter 60dp hoch.
2. **Horizontale Row ohne Overflow-Strategie.** Die Live-TV-Row und die Recent-Row sind plain `Container direction:"row"` ohne `Sequence`. Auf Show 5 (960dp Breite, 65% = 624dp nutzbar) passen **maximal 7 Logo-Tiles** (72×7 + Padding). Acht überlaufen → unsichtbar. Kein horizontales Scrolling, kein "mehr"-Indikator.
3. **Information overload.** Auf einem Screen: 8 Sender, bis zu 6 Queue-Items, bis zu 6 Recent-Items, mehrere News-Sektionen mit allen Items, 4 Kategorien, Logo, Titel. Selbst auf Show 10 ist das visuell überladen, auf Show 5 unlesbar.
4. **Inkonsistente Bildgrößen.** News-Thumbnails 80×45dp, Sender-Logos 60×40dp, Recent ganz ohne Bild. Optisches Rauschen.
5. **Adaptive Begrüßung fehlt.** Der Titel ist hartcodiert "Aktuelle Nachrichten". Wenn die Queue zwölf Items hat — keine Erwähnung. Wenn ORF-API down ist — der Screen ist leer.
6. **Voice-Hint nur rechts.** "Sage: Thema ..." steht in der rechten Spalte und referenziert die Kategorien drunter, nicht aber den eigentlichen Hauptcontent links (Queue/Live/Recent). User weiß nicht: kann ich "spiel Queue" sagen?
7. **Hartcodierte Farben.** `#4FC3F7`, `#79c0ff`, `#B0BEC5`, `#78909C`, `rgba(255,255,255,0.08)` u.v.m. Direkt im Template gestreut — keine Tokens, keine Wiederverwendbarkeit über die Templates (`ChannelListTemplate`, `NewsListTemplate`) hinweg.
8. **Kein Responsive.** Eine Layout-Definition für alle Viewports. Show 5 (960×480, hub-landscape-small) und Show 10 (1280×800, hub-landscape-medium/large) werden gleich behandelt. APL-`@viewportProfile`-Mechanik wird gar nicht genutzt.
9. **Recent-Content ist eigentlich Queue-nah, aber separater Slot.** Beide zeigen ContentEntries. Doppelter UI-Pfad ohne klare Hierarchie.

---

## 2. Layout-Vorschlag

### Designprinzip

Ein-Screen-Übersicht ohne vertikales Scrolling auf Show 5. Maximal **drei** Touch-Karten pro Sektion, große Bilder, klare Sektionsüberschriften, **eine** dominante Aktion ("Queue weiter abspielen") oben.

### Design Tokens (theme.json oder inline für alle Templates wiederverwendbar)

```
bg.base       = #0B1220
bg.card       = rgba(255,255,255,0.06)
bg.card.alt   = rgba(255,255,255,0.03)
accent        = #4FC3F7   (cyan – Sektionstitel, Akzent)
accent.cta    = #1F6FEB   (blau – Primär-CTA "Queue weiter")
text.primary  = #FFFFFF
text.muted    = #B0BEC5
text.dim      = #78909C
radius.card   = 14dp
radius.tile   = 12dp
pad.card      = 16dp
gap.section   = 18dp
gap.tile      = 10dp
```

### Viewport-Profile (APL)

Im APL-Document zwei Layouts via `when: "${@viewportProfile == @hubLandscapeSmall}"` etc.:

| Profil | Geräte | Strategie |
|---|---|---|
| `@hubLandscapeSmall` | Show 5 (960×480) | **1 Sektion sichtbar**, vertical Pager statt Stack |
| `@hubLandscapeMedium`/`Large` | Show 8 (1280×800), Show 10 | **Alle 3 Sektionen sichtbar**, Grid-Layout |

### Layout Show 8/10 (1280×800) — Default

```
+------------------------------------------------------------+
|  Hallo. 3 Videos in deiner Queue.        [Queue weiter ▶]  |   <- Header (Höhe 96dp)
+------------------------------------------------------------+
|  QUEUE                                                     |   <- Sektionstitel (28dp)
|  +---------+ +---------+ +---------+                       |
|  | Cover   | | Cover   | | Cover   |  je 280×160dp        |   <- 3 Touch-Karten
|  | Titel   | | Titel   | | Titel   |  Tile 280×220dp      |
|  | Quelle  | | Quelle  | | Quelle  |                       |
|  +---------+ +---------+ +---------+                       |
|                                                            |
|  LIVE-TV          NEWS              LOKAL                  |   <- 3 Spalten parallel
|  +------+         +-----------+     +-----------+          |
|  | ORF1 |         | ZIB 17:00 |     | S04E12    |          |
|  +------+         +-----------+     +-----------+          |
|  +------+         +-----------+     +-----------+          |
|  | ORF2 |         | Tageschau |     | Tatort    |          |
|  +------+         +-----------+     +-----------+          |
|  +------+         +-----------+     +-----------+          |
|  | ZDF  |         | ZIB 19:30 |     | Doku XY   |          |
|  +------+         +-----------+     +-----------+          |
|  [Alle Sender →]  [Mehr News →]     [Mehr Inhalte →]       |   <- Eskalation
+------------------------------------------------------------+
|  Sag: "Tagesschau", "Queue", "alle Sender"      Mic-Icon   |   <- Voice-Hint-Bar
+------------------------------------------------------------+
```

Spalten-Aufteilung Show 10:
- Padding: 32dp links/rechts, 24dp oben/unten
- Header: 96dp Höhe, fix
- Queue-Row: 220dp Höhe, fix
- 3-Spalten-Grid: `grow: 1`
- Voice-Hint-Bar: 48dp Höhe, fix

Spalten-Breiten:
- Live-TV-Spalte: 200dp (Logo-Tiles 160×96dp, zentriert)
- News-Spalte: `grow: 1` (Cards mit Bild 96×54dp + Text)
- Lokal-Spalte: `grow: 1` (Cards mit Cover 96×54dp + Text)

### Layout Show 5 (960×480) — Pager

Show 5 hat nicht genug Höhe für 3 Sektionen + Queue gleichzeitig (480dp - 96dp Header - 48dp Voice-Bar = 336dp nutzbar). Lösung: **APL `Pager`** mit Seiten:

```
Seite 1:                          Seite 2/3/4:
+------------------------------+  +------------------------------+
| Hallo. 3 Queue [Weiter ▶]    |  | Hallo. 3 Queue [Weiter ▶]    |
+------------------------------+  +------------------------------+
| QUEUE                        |  | LIVE-TV                      |
| +------+ +------+ +------+   |  | +------+ +------+ +------+   |
| |Cover | |Cover | |Cover |   |  | | ORF1 | | ORF2 | | ZDF  |   |
| |Titel | |Titel | |Titel |   |  | |      | |      | |      |   |
| +------+ +------+ +------+   |  | +------+ +------+ +------+   |
| Tile 240×180dp               |  | Tile 240×180dp               |
+------------------------------+  +------------------------------+
| • o o o   "weiter"-Hint      |  | o • o o   [Alle Sender →]    |
+------------------------------+  +------------------------------+
```

Vier Seiten: Queue / Live-TV / News / Lokal. Indicator unten (Pager-Dots). Swipe horizontal, oder per Voice "weiter" / "zurück".

Touch-Tiles auf Show 5: 240×180dp (drei nebeneinander = 720dp + 2×16dp Gap = 752dp ≤ 960dp - 2×48dp Padding ✓).

### Pixel-Spec Touch-Karten

| Element | Show 5 | Show 8/10 | Min Touch | Notes |
|---|---|---|---|---|
| Header-CTA "Queue weiter" | 240×72dp | 280×80dp | ✓ 80dp | Frame, accent.cta BG |
| Queue/Lokal/News-Card | 240×180dp | 280×220dp | ✓ 80dp | Cover oben 240×135dp, Text drunter |
| Live-TV-Tile | 240×120dp | 200×120dp | ✓ 80dp | Logo zentriert 160×64dp |
| Eskalation-Button "Alle Sender" | volle Spalte × 56dp | volle Spalte × 56dp | ✓ | Akzentumrahmt, kein Fill |
| Pager-Dot (nur Show 5) | 12×12dp | n/a | nicht touch | Visual only |

### Schriftgrößen

| Use | Show 5 | Show 8/10 |
|---|---|---|
| Header (Begrüßung) | 22dp | 28dp |
| Sektionstitel | 18dp bold uppercase letter-spacing | 22dp bold uppercase |
| Card-Titel | 18dp bold, maxLines 2 | 20dp bold, maxLines 2 |
| Card-Metadaten | 14dp muted | 16dp muted |
| Voice-Hint-Bar | 14dp | 16dp |

---

## 3. Begrüßungs-Logik

**Regel-Tabelle.** Reihenfolge = Priorität (oberste Regel die matched gewinnt).

| Queue | Lokal | News-API | Display-Text (Header) | Voice (speak) | Reprompt |
|---|---|---|---|---|---|
| ≥1 | – | – | "Du hast {N} {Video/Videos} in deiner Queue." | "Du hast {N} {Video/Videos} in deiner Queue. Soll ich abspielen?" | "Soll ich die Queue starten?" |
| 0 | ≥1 neu (< 7 Tage) | ok | "Was möchtest du sehen?" | "Hallo. {M} neue Aufnahmen oder die aktuellen Nachrichten — was magst du?" | "Sage Nachrichten, Live-TV oder einen Titel." |
| 0 | 0 | ok | "Aktuelle Nachrichten" | "Was möchtest du sehen? Aktuelle Nachrichten, Live-TV oder einen Sender?" | "Sage zum Beispiel: Tagesschau." |
| 0 | – | down | "Live-TV verfügbar" | "Die Mediathek ist gerade nicht erreichbar. Du kannst Live-TV starten — sage einen Sendernamen." | "Welchen Sender?" |
| – | – | beide down | "Hallo." | "Im Moment habe ich keine Inhalte. Versuche es später nochmal." | – (`shouldEndSession: false`) |

**Pluralisierung:** 1 → "ein Video", >1 → "{N} Videos". Helper-Funktion `pluralize(n, singular, plural)`.

**Zeitabhängige Begrüßung?** Bewusste Entscheidung gegen "Guten Morgen / Abend". Trade-off: charmant vs. Komplexität & Fehlerquelle (Timezone, lokale Zeit auf Pi). YAGNI.

**Voice vs. Display:** Beides. Display zeigt den Header-Text (kurz, Substantiv-Phrase), Voice fragt aktiv (Verb-Phrase + Frage). User soll auf das Display schauen können falls er Voice überhört, aber das Display ist **nicht** Voice-Transkript.

---

## 4. Bild-Strategie

### Bildgrößen-Empfehlung

Echo Show rendert APL bei Device-DPI (Show 5: 1.0×, Show 8: 1.0×, Show 10: 1.5×). Faustregel: liefere Bilder in **2× der angezeigten dp-Größe**, das deckt Show 10 ab.

| Use | Angezeigt | Datei-Auflösung | Format |
|---|---|---|---|
| Queue-Cover | 280×160dp | 560×320 | jpg q85 |
| News-Thumbnail | 96×54dp | 192×108 | jpg q85 |
| Live-TV-Logo | 160×96dp | 320×192 | png mit Transparenz |
| Lokal-Cover | 280×160dp | 560×320 | jpg q85 |
| Header-Logo (optional) | 48×48dp | 96×96 | png |

### Pro Quelle

**YouTube-Thumbnails**
- Direkt `https://i.ytimg.com/vi/<videoId>/mqdefault.jpg` (320×180) — passt für News-Thumbnail-Größe.
- Für Queue/Cover: `hqdefault.jpg` (480×360).
- Echo Show lädt direkt von ytimg.com, kein lokaler Cache nötig. ytimg ist CDN, schnell, billig.
- **Fallback:** Wenn YouTube-Thumbnail fehlt (404) → generisches Icon `/logos/_fallback_youtube.png` (muss angelegt werden).

**Lokale Files**
- Suche im Episoden-Ordner nach `cover.jpg` / `poster.jpg` / `folder.jpg` (Reihenfolge). Server liefert unter `/content/<id>/poster.jpg`.
- Skill-Server muss diese Route bedienen und Image bei Bedarf herunterskalieren (sharp).
- **Fallback-Kette:** Episode-Poster → Show-Poster (eine Ebene hoch) → generisches Icon `/logos/_fallback_local.png`.

**Live-TV-Sender**
- Bereits in `public/logos/`, Mapping über `lib/fritzbox/channels.json` Feld `logoFile`.
- Helper `getLogoUrlForChannelId(id)` (existiert sinngemäss schon als `getLogoUrlForChannel(name)`, sollte einheitlich auf id umgestellt werden).
- **Fallback:** Wenn `logoFile` fehlt oder Datei nicht existiert → Frame mit Initialen-Text (z.B. "ORF", "ZDF").

**Mediathek-News (Sender → Logo)**
- Mapping-Tabelle nötig: Sender-String aus ORF-API → `channels.json` ID → Logo. Beispiele:
  - `"ORF"`, `"ORF 1"`, `"ORF1"` → `orf1_hd.png`
  - `"ZIB"`, `"ZIB Flash"`, `"ZIB 17:00"` → `orf2o_hd.png` (oder `orf1_hd.png` – Entscheidung siehe **Offene Frage 3**)
  - `"Tagesschau"`, `"Das Erste"` → `das_erste_hd.png`
  - `"ZDF heute"`, `"heute journal"` → `zdf_hd.png`
- Mapping lebt in `lib/newsChannelMapping.js` (neue Datei), separat von `fritzbox/channels.json` weil "logischer Sender" ≠ "DVB-Tuner".
- **Fallback:** Generisches News-Icon `/logos/_fallback_news.png`.

### Lazy Load / Cache

- **Externe Bilder (YouTube)**: Echo Show cached intern, kein Server-Side-Caching nötig.
- **Lokale Posters**: Sharp-resize beim ersten Request, in `data/poster-cache/` ablegen, Cache-Header `Cache-Control: public, max-age=604800` (1 Woche).
- **Logos**: Statisch in `public/logos/`, ETags via Express `static`.
- **Lazy Load**: APL hat kein echtes Lazy-Loading-Konzept. Workaround: nur Bilder für die aktuell sichtbare Seite (Pager-Seite auf Show 5) im Datensatz mitschicken? **YAGNI** – wir liefern alle 3+3+3+3 = 12 Bilder, das ist im Rahmen.

### Performance-Budget

- Header lädt unter 800ms (Show 5 WLAN-Last-Case).
- Max 16 Bilder im Launch-Screen total (3 Queue + 3 Live + 3 News + 3 Lokal + 4 Fallbacks reserve).
- Wenn Mediathek-API > 1500ms braucht: News-Sektion mit Skeleton zeigen, Voice ohne Vorlesen ("Welche Quelle?"), Fallback-Pfad.

---

## 5. YAGNI — weg aus dem aktuellen LaunchTemplate

| Element | Weg / Behalten | Grund |
|---|---|---|
| Rechte 35%-Spalte (Kategorien-Buttons "Sport", "Kultur", "Comedy") | **Weg.** | User-Intent ist Voice ("Alexa, zeig Sport"). Die Buttons triggern denselben Pfad, sind aber Slots, die wertvollen Real-Estate fressen. Falls Kategorie-Browsing wirklich gebraucht wird → eigene Voice-Intent + eigener Screen. |
| "Sage: Thema ..."-Headline | **Weg, ersetzt durch Voice-Hint-Bar unten.** | Bessere Platzierung, mehr Beispiele in einem dünnen Streifen. |
| 8-Sender-Quickbar | **Weg, ersetzt durch 3 Top-Sender + "Alle Sender"-Eskalation.** | 8 sprengt jeden Viewport. User schaut eh 3-4 Sender. |
| Hartcodierter Titel "Aktuelle Nachrichten" | **Weg.** | Adaptive Begrüßung übernimmt. |
| News-Sektionen als Sequence mit ALLEN Results | **Weg, ersetzt durch Top-3 in News-Spalte.** | Vertikales Scrollen auf Echo Show ist UX-feindlich. |
| `recentContent` als separater Slot oberhalb Sequence | **Behalten, aber als eigene Spalte gleichberechtigt.** | Klare Hierarchie. |
| Logo in rechter Spalte (`launchData.properties.logoUrl`) | **Weg.** | Kein Branding-Mehrwert auf einem privaten Skill. |
| Index-Nummer (28dp blue "1", "2", "3" vor jedem News-Item) | **Behalten, aber kleiner (16dp) und nur wenn Voice "Nummer X" aktiv ist.** | User soll "Tagesschau" sagen können, nicht "Nummer 2". |
| Wechselnde Background-Hintergrundfarben pro Item (`flatIndex % 2`) | **Weg.** | Visuelles Rauschen. Konstante card.bg, klare Gaps reichen. |

---

## 6. Spannungsfeld — Voice-first vs. Touch

Der User-Brief sagt: Voice ist primärer Bedienpfad, Touch ist sekundär aber muss funktionieren.

**Daraus folgt:**

1. **Display ist Status + Eskalation, nicht Primärinterface.** Es zeigt, **was es gerade gibt** (Queue voll? Welche News?), aber der User soll nicht denken müssen "wo tippe ich".
2. **Touch-Targets trotzdem groß**, weil:
   - User sitzt am Frühstückstisch, Hände schmierig, sagt "Alexa zeig Queue" — landet hier. Will dann das oberste Video tippen statt Nummer zu sagen.
   - Smutje-Effekt: wenn Voice mal nicht versteht, ist Touch die Recovery.
3. **Kein 6-Element-Cluster, sondern 3 + Eskalation.** Drei sichtbare Optionen pro Spalte, plus ein expliziter "Alle Sender →" Button, der zur ChannelListTemplate führt.
4. **Voice-Hint-Bar unten** mit rotierender Hint:
   - `"Sag: Tagesschau, Queue, ORF1, alle Sender"` (statisch, oder rotierend alle 5s).
   - Nicht ablenkend, aber präsent.
5. **Pager-Layout auf Show 5 ist explizit Voice-friendly.** "Weiter" als Voice-Command navigiert Pager-Seiten ohne Touch.

**Empfehlung:** "Minimal feedback während Voice der Hauptpfad ist" + große Touch-Targets als Recovery. Nicht "show off what's possible" — der User kennt die Skill.

---

## 7. Migration — Stufenplan

Jede Stufe deployable und ein eigenständiges Improvement.

### Stufe 1 — Sofortige Aufräumarbeit (≈ 2-3h)
**Ziel:** Größere Touch-Targets, weniger Items, ohne Layout-Revolution.
- Live-TV-Quickbar von 8 auf 3 Sender reduzieren (`LaunchHandler.QUICKBAR_IDS`).
- Live-TV-Tiles auf 100×100dp (statt 60×40dp).
- Rechte 35%-Spalte komplett raus → linker Bereich 100%.
- News-Sequence auf Top-3 limitieren.
- Adaptive Header-Text-Logik (Tabelle aus Abschnitt 3) implementieren.
- Hartcodierte Farben in Variablen-Block am Anfang des Templates.

**Done-Kriterium:** Auf Show 5 ist alles sichtbar ohne horizontalen Overflow.

### Stufe 2 — 3-Spalten-Layout für Show 8/10 (≈ 4-5h)
**Ziel:** Klare Sektionen, parallele Spalten.
- LaunchTemplate auf 3-Spalten-Grid (Live / News / Lokal) umstellen.
- Queue-Row als Header-Row oberhalb der Spalten.
- "Alle Sender →" / "Mehr News →" Eskalation-Buttons.
- Voice-Hint-Bar am unteren Rand.
- Konsistente Card-Komponente (`AplLayouts.MediaCard`) als APL-Layout-Definition.

**Done-Kriterium:** Show 8 und Show 10 zeigen das Final-Layout pixel-genau.

### Stufe 3 — Responsive Show 5 Pager (≈ 3-4h)
**Ziel:** Show 5 bekommt dediziertes Layout.
- APL-Conditional `when: "${@viewportProfile == @hubLandscapeSmall}"` mit Pager-Komponente.
- Voice-Intents "weiter" / "zurück" mappen auf Pager `SetPage`-Command (kann auch erstmal nur Touch-Swipe sein).
- Pager-Dot-Indicator.

**Done-Kriterium:** Show 5 zeigt 4 Pager-Seiten, je 3 Cards.

### Stufe 4 — Bild-Pipeline (≈ 4-6h)
**Ziel:** Konsistente Poster/Logos/Thumbnails.
- `/content/<id>/poster.jpg` Endpoint mit Sharp-Resize + Disk-Cache.
- `lib/newsChannelMapping.js` für Sender→Logo bei Mediathek-News.
- Fallback-Bilder `_fallback_local.png`, `_fallback_news.png`, `_fallback_youtube.png` in `public/logos/`.
- Bestehende `getLogoUrlForChannel(name)` → `getLogoUrlForChannelId(id)` Migration.

**Done-Kriterium:** Jede Card hat ein Bild (echt oder Fallback), keine leeren `Image`-Komponenten.

### Stufe 5 — Polish (≈ 2-3h)
**Ziel:** Feinschliff.
- Animation: Pager-Transitions, Card-Fade-In auf Render.
- Voice-Hint-Bar mit rotierenden Beispielen (alle 5s, falls APL `Sequencer` mitspielt — sonst statisch).
- Design-Tokens auch in `ChannelListTemplate.json`, `NewsListTemplate.json` ausrollen → Konsistenz.

**Done-Kriterium:** Drei Templates fühlen sich wie eine Skill an, nicht wie drei Skills.

---

## 8. Diag-Webview (`public/diag/index.html`)

Nicht primär Ziel, aber:
- Gleicher Datenfluss → gleiche Sektionen (Queue, Live, News, Lokal).
- Diag ist Debug-Tool. Hier ist **mehr Information** OK (alle 26 Sender, alle News, alle Lokal-Files mit Path).
- Empfehlung: Diag-View **bewusst nicht** redesignen. Die Echo-Show-UI ist limitiert, Diag ist die "alle-Daten"-Sicht für den Pi-Admin.

---

## 9. Entscheidungen (vom Endnutzer abgenommen 2026-05-14)

### ✅ Frage 1 — Live-TV Top-3: env-abhängig (AT vs. DE)
- **Neue ENV:** `LAUNCH_COUNTRY` mit Werten `AT` (Default) oder `DE`.
- **AT-Set:** `['orf1', 'orf2', 'orf3']` (oder die korrekten Channel-IDs aus `channels.json`)
- **DE-Set:** `['das_erste', 'zdf', 'arte']` (oder vergleichbare 3)
- Implementierung in `LaunchHandler.js` als `getTopChannels()`-Helper, der `process.env.LAUNCH_COUNTRY` liest.
- Auto-Favoriten und User-konfigurierbar sind verschoben (YAGNI).

### ✅ Frage 2 — Voice-Hint-Bar: rotierend
- Rotierende Hints alle 5s, vier-fünf Varianten.
- Implementierung: APL `Sequence` mit `Idle`/`AnimateItem`-Loop, oder JS-seitig pre-render mehrere Frames und APL-Pager mit Auto-Advance.
- Beispiel-Rotation: "Sag: Tagesschau" / "Sag: spiel Queue" / "Sag: ORF1" / "Sag: zeig alle Sender" / "Sag: was läuft heute".

### ✅ Frage 3 — Logo-Mapping ZIB: Smart aus ORF-API
- ORF-API liefert pro Sendung das `channel`-Feld. Mapping:
  - `channel: "ORF1"` → `orf1_hd.png`
  - `channel: "ORF2"` → `orf2_hd.png` (oder `orf2o_hd.png` regional)
  - Sonst → `orf1_hd.png` als Fallback
- Generelles Mapping in `lib/newsChannelMapping.js`.

### ✅ Frage 4 — Show 5: Vertical Sequence
- 3 Sektionen untereinander, je 3 Cards.
- APL nativ, kein Pager-Aufwand.
- Migration zu Pager bleibt offen für später (Stufe 5+).

---

## 10. Done-Definition (Spec-Akzeptanz)

Dieses Spec gilt als akzeptiert, wenn:
- [ ] Stufe 1-2 in einer Implementation-PR landen
- [ ] Touch-Target-Minimum 80dp eingehalten
- [ ] News-Sektion hat Bilder (Sender-Logo oder Sendungs-Thumbnail)
- [ ] Header-Begrüßung ist adaptiv nach Tabelle Abschnitt 3
- [ ] Show 5 zeigt nichts mit horizontalem Overflow
- [ ] Offene Fragen 1-4 sind beantwortet (per Issue-Kommentar oder Slack)

---

## Anhang — Referenzen

- Bestehend: `skill/apl/LaunchTemplate.json:1-365`
- Bestehend: `skill/handlers/LaunchHandler.js:1-130`
- Bestehend: `lib/aplHelper.js:101-149` (`renderLaunchScreen`)
- Bestehend: `lib/fritzbox/channels.json` (Sender + `logoFile`-Mapping)
- Bestehend: `public/logos/` (PNG-Assets, mind. 11 vorhanden, mehr im Repo erwartet)
- Verwandt: `docs/superpowers/specs/2026-05-14-queue-design.md`
- Verwandt: `docs/superpowers/specs/2026-05-12-local-content-design.md`
- Amazon APL Viewport Profiles: `@hubLandscapeSmall`, `@hubLandscapeMedium`, `@hubLandscapeLarge`
