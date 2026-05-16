/**
 * MCP server for MyVideo. Streamable HTTP transport, mounted by server.js
 * at POST /mcp.
 *
 * Tools:
 *   - list_queue           → returns the current queue items as JSON
 *   - add_youtube_to_queue → fires off an async download and immediately
 *                            adds the item with status='downloading';
 *                            client polls list_queue for completion.
 *
 * Auth is handled OUTSIDE this module (bearer-token middleware in server.js)
 * so it stays focused on protocol + tool logic.
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { randomUUID } = require('crypto');
const { z } = require('zod');
const path = require('path');

const { makeDownloadAndAttach, extractVideoId } = require('../youtube/queueDownloader');

const SERVER_NAME = 'myvideo';
const SERVER_VERSION = '1.0.0';

/**
 * Build a fresh McpServer with our tools registered.
 *
 * @param {object} deps
 * @param {object} deps.queue           - queue module getInstance() result
 * @param {object} deps.contentService  - lib/content/service.js
 * @param {string} deps.youtubeDir      - absolute path to data/youtube
 * @param {function} [deps.downloadFn]  - injectable for tests
 * @returns {McpServer}
 */
function buildServer(deps) {
  if (!deps || !deps.queue || !deps.contentService || !deps.youtubeDir) {
    throw new Error('mcp.buildServer: queue, contentService, youtubeDir required');
  }

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // === Tool: list_queue ===
  server.registerTool(
    'list_queue',
    {
      title: 'Liste der Videos in der Watch-Queue',
      description: 'Gibt alle Videos zurück, die aktuell in der Queue sind. Jedes Item hat id, title, source, status (ready/downloading/failed), youtubeUrl (falls YouTube), addedAt.',
      inputSchema: {},
    },
    async () => {
      const items = deps.queue.list().map(it => ({
        id: it.id,
        title: it.title,
        subtitle: it.subtitle,
        source: it.source,
        status: it.status || 'ready',
        youtubeUrl: it.youtubeUrl || null,
        contentId: it.contentId || null,
        url: it.url || null,
        duration: it.duration,
        error: it.error || null,
        addedAt: it.addedAt,
      }));
      return {
        content: [
          { type: 'text', text: JSON.stringify({ count: items.length, items }, null, 2) },
        ],
        structuredContent: { count: items.length, items },
      };
    }
  );

  // === Tool: add_youtube_to_queue ===
  server.registerTool(
    'add_youtube_to_queue',
    {
      title: 'YouTube-Video zur Queue hinzufügen',
      description: 'Fügt ein YouTube-Video zur Queue hinzu. Akzeptiert URLs (youtu.be/, youtube.com/watch?v=, /embed/, /shorts/) oder eine bare 11-stellige Video-ID. Der Download läuft asynchron im Hintergrund (yt-dlp). Das Item ist sofort in der Queue, aber nicht abspielbar bis status="ready". Status mit list_queue prüfen.',
      inputSchema: {
        youtubeUrl: z.string().min(1).describe('YouTube-URL oder Video-ID. Z.B. https://youtu.be/dQw4w9WgXcQ oder dQw4w9WgXcQ'),
        title: z.string().optional().describe('Optionaler Anzeigetitel. Wenn weggelassen, wird ein Platzhalter mit der Video-ID verwendet bis yt-dlp den echten Titel kennt.'),
      },
    },
    async ({ youtubeUrl, title }) => {
      const videoId = extractVideoId(youtubeUrl);
      if (!videoId) {
        return {
          content: [{ type: 'text', text: `Fehler: Konnte keine YouTube-Video-ID aus URL extrahieren: ${youtubeUrl}` }],
          structuredContent: { ok: false, error: 'invalid_url' },
          isError: true,
        };
      }
      let item;
      try {
        item = deps.queue.add({
          source: 'youtube_pending',
          youtubeUrl,
          title: title || `YouTube ${videoId}`,
          subtitle: 'YouTube (wird geladen…)',
          status: 'downloading',
          imageUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        });
      } catch (err) {
        if (err.code === 'DUPLICATE') {
          return {
            content: [{ type: 'text', text: `Video ist bereits in der Queue (id: ${err.existingId}).` }],
            structuredContent: { ok: false, error: 'duplicate', existingId: err.existingId },
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: `Fehler beim Hinzufügen: ${err.message}` }],
          structuredContent: { ok: false, error: err.message },
          isError: true,
        };
      }

      // Fire async download — do NOT await
      const downloadAndAttach = makeDownloadAndAttach({
        queue: deps.queue,
        contentService: deps.contentService,
        youtubeDir: deps.youtubeDir,
        downloadFn: deps.downloadFn,
      });
      downloadAndAttach(item.id, youtubeUrl).catch(err => {
        console.error('[mcp] downloadAndAttach unexpected error:', err.message);
      });

      return {
        content: [
          { type: 'text', text: `Video ${videoId} hinzugefügt (id: ${item.id}). Download läuft im Hintergrund — prüfe Status mit list_queue.` },
        ],
        structuredContent: {
          ok: true,
          id: item.id,
          videoId,
          status: 'downloading',
        },
      };
    }
  );

  return server;
}

/**
 * Returns an Express request handler that owns its own per-session
 * transport map. Call this once at startup and mount with
 * `app.post('/mcp', handler)` (and `app.get('/mcp', handler)` for the
 * server-initiated stream channel).
 *
 * Sessions are keyed by the `mcp-session-id` header. The client is
 * expected to echo it back on follow-up requests (the SDK does this
 * automatically). A session that already exists is reused; an absent
 * session header → new session.
 */
function makeHandler(deps) {
  const transports = new Map(); // sessionId → transport
  return async function mcpHandler(req, res) {
    try {
      const incomingSessionId = req.headers['mcp-session-id'];
      let transport = incomingSessionId ? transports.get(incomingSessionId) : null;

      if (!transport) {
        const sessionId = incomingSessionId || randomUUID();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
          onsessioninitialized: (id) => { /* hook for logging */ },
        });
        const server = buildServer(deps);
        await server.connect(transport);
        transports.set(sessionId, transport);
        transport.onclose = () => { transports.delete(sessionId); };
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] handler error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error: ' + err.message },
          id: req.body && req.body.id !== undefined ? req.body.id : null,
        });
      }
    }
  };
}

module.exports = { buildServer, makeHandler, SERVER_NAME, SERVER_VERSION };
