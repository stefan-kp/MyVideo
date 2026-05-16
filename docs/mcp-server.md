# MyVideo MCP Server

Der Pi-Server bietet einen optionalen [Model Context Protocol](https://modelcontextprotocol.io/)
Endpunkt unter `POST /mcp` (Streamable HTTP Transport). Damit kann
Claude (Desktop, Code, oder andere MCP-Clients) deine Watch-Queue
abfragen und YouTube-Videos hinzufügen.

## Konfiguration

Setze in deiner `.env`:

```bash
# Token (Pflicht — leer = MCP deaktiviert)
MCP_TOKEN=4f3c2a1b...   # mind. 32 Zeichen empfohlen, z.B. `openssl rand -hex 32`

# Sichtbarkeit (optional)
# Default: nur aus dem lokalen Netzwerk (192.168.x.x / 10.x / 172.16-31.x / 127.0.0.1)
# Setzen, wenn du den MCP-Endpunkt über den Cloudflare-Tunnel von überall
# erreichen willst:
# MCP_PUBLIC=true
```

Ohne `MCP_TOKEN` ist der MCP-Endpunkt deaktiviert. Der Server gibt
beim Start eine entsprechende Meldung aus:

```
  MCP:           aktiviert (LAN-only, token-gated)
  MCP:           aktiviert (public, token-gated)
  MCP:           deaktiviert (kein MCP_TOKEN env)
```

Im Diag-UI gibt es einen eigenen **MCP-Tab**, der den aktuellen
Status, die maskierte Token-Anzeige (zur Verifikation dass die .env
geladen wurde), die verfügbaren Tools und Copy-Paste-Snippets für
Claude Desktop / Claude Code anzeigt.

## Tools

### `list_queue`

Kein Input. Returnt die Watch-Queue als JSON mit Status:

```json
{
  "count": 2,
  "items": [
    {
      "id": "uuid-...",
      "title": "Tagesschau 17:00",
      "source": "mediathek",
      "status": "ready",
      "addedAt": "2026-05-16T..."
    },
    {
      "id": "uuid-...",
      "title": "YouTube dQw4w9WgXcQ",
      "source": "youtube_pending",
      "status": "downloading",
      "youtubeUrl": "https://youtu.be/dQw4w9WgXcQ",
      "addedAt": "2026-05-16T..."
    }
  ]
}
```

Status-Werte:
- `ready` — abspielbar
- `downloading` — yt-dlp läuft noch im Hintergrund
- `failed` — Download fehlgeschlagen (Feld `error` mit Detail)

### `add_youtube_to_queue`

Input:
- `youtubeUrl` (Pflicht) — URL oder bare Video-ID. Akzeptiert
  `youtu.be/<id>`, `youtube.com/watch?v=<id>`, `/embed/<id>`,
  `/shorts/<id>`, oder den 11-Zeichen-Video-ID direkt.
- `title` (optional) — Anzeigetitel. Wenn weggelassen, wird ein
  Platzhalter mit der Video-ID verwendet.

Returnt sofort (kein Warten auf Download):

```json
{
  "ok": true,
  "id": "uuid-...",
  "videoId": "dQw4w9WgXcQ",
  "status": "downloading"
}
```

Der Worker lädt das Video im Hintergrund (yt-dlp), reindexiert die
lokale Sammlung, und upgraded das Queue-Item auf `status: "ready"`.
Wenn der Download fehlschlägt, wird `status: "failed"` gesetzt mit
einer Fehlermeldung im `error`-Feld.

Duplicate-Check via youtubeUrl: zweimal die gleiche URL hinzuzufügen
returnt einen Error mit `existingId`.

## Client-Konfiguration

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "myvideo": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mytv.kaproblem.com/mcp",
        "--header",
        "Authorization: Bearer DEIN_MCP_TOKEN"
      ]
    }
  }
}
```

(Claude Desktop kann selbst nur stdio-MCP-Server. `mcp-remote` ist
ein npm-Wrapper, der über HTTP zum echten Server proxied.)

### Claude Code (CLI)

```bash
claude mcp add myvideo \
  --transport http \
  --header "Authorization: Bearer DEIN_MCP_TOKEN" \
  https://mytv.kaproblem.com/mcp
```

Oder direkt in `.claude/mcp.json` im Projektordner:

```json
{
  "mcpServers": {
    "myvideo": {
      "transport": "http",
      "url": "https://mytv.kaproblem.com/mcp",
      "headers": {
        "Authorization": "Bearer DEIN_MCP_TOKEN"
      }
    }
  }
}
```

## Beispielsessions

In Claude Desktop oder Claude Code nach der Konfiguration einfach
fragen:

> Was steht in meiner Watch-Queue?

oder

> Pack mal https://youtu.be/dQw4w9WgXcQ in die Queue.

Claude ruft die Tools auf und gibt das Ergebnis zurück.

## Sicherheit

- Token-Auth ist Pflicht: ohne korrektes `Authorization: Bearer ...`
  Header gibt's 401 (kein Token) oder 403 (falscher Token).
- Der Token sollte NICHT in Query-Parametern stehen (MCP-Spec).
- Wenn du den Server über Cloudflare Tunnel exposiert hast, kommen
  MCP-Requests von außen — der Token ist die einzige Schranke. Halte
  ihn lang + geheim.
- Es gibt aktuell kein Rate-Limiting auf dem `/mcp`-Endpunkt. Wenn
  jemand den Token erbeutet, kann er deine Queue spammen.

## Lokale Tests ohne Claude

```bash
# Init
curl -X POST https://mytv.kaproblem.com/mcp \
  -H "Authorization: Bearer DEIN_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Antwort enthält in den Response-Headern `mcp-session-id` — den
brauchst du auf allen Folge-Requests.
