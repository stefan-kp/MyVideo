const express = require('express');
const axios = require('axios');
const { URL } = require('url');
const channels = require('./channels');
const { authMiddleware } = require('./auth');

const router = express.Router();

// All proxy routes require a valid JWT
router.use(authMiddleware());

// CORS for Alexa
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// --- Live TV: Master Playlist ---
router.get('/live/:channelId/master.m3u8', async (req, res) => {
  try {
    const channel = channels.findChannel(req.params.channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const response = await axios.get(channel.url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: status => status < 400
    });

    // Use the final URL after redirects as base for rewriting
    const finalUrl = response.request?.res?.responseUrl || channel.url;
    const basePath = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
    const token = req.query.token;

    const rewritten = rewritePlaylist(response.data, basePath, `/proxy/live/${req.params.channelId}`, token);

    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(rewritten);
  } catch (err) {
    const status = err.response?.status;
    if (status === 403) {
      console.error(`HLS Proxy: ${req.params.channelId} geo-blocked (403)`);
      res.status(403).json({ error: 'Stream geo-blocked - nicht verfuegbar von diesem Standort' });
    } else {
      console.error(`HLS Proxy error (master): ${err.message}`);
      res.status(502).json({ error: 'Failed to fetch upstream playlist' });
    }
  }
});

// --- Live TV: Sub-playlists and segments ---
router.get('/live/:channelId/*', async (req, res) => {
  try {
    const channel = channels.findChannel(req.params.channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Use original URL to derive base, but resolve against final redirect URL
    const baseResponse = await axios.head(channel.url, {
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: status => status < 400
    });
    const finalBaseUrl = baseResponse.request?.res?.responseUrl || channel.url;
    const basePath = finalBaseUrl.substring(0, finalBaseUrl.lastIndexOf('/') + 1);

    const subPath = req.params[0];
    const upstreamUrl = new URL(subPath, basePath).href;

    if (subPath.endsWith('.m3u8')) {
      const response = await axios.get(upstreamUrl, { timeout: 10000 });
      const token = req.query.token;
      const rewritten = rewritePlaylist(response.data, basePath, `/proxy/live/${req.params.channelId}`, token);

      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(rewritten);
    } else {
      const response = await axios.get(upstreamUrl, {
        responseType: 'stream',
        timeout: 15000
      });

      res.set('Content-Type', response.headers['content-type'] || 'video/mp2t');
      res.set('Cache-Control', 'public, max-age=30');
      response.data.pipe(res);
    }
  } catch (err) {
    const status = err.response?.status;
    if (status === 403) {
      res.status(403).json({ error: 'Stream geo-blocked' });
    } else {
      console.error(`HLS Proxy error (sub): ${err.message}`);
      res.status(502).json({ error: 'Failed to fetch upstream resource' });
    }
  }
});

// --- Mediathek Proxy ---
router.get('/mediathek', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) {
      return res.status(400).json({ error: 'url parameter required' });
    }

    const isM3u8 = url.endsWith('.m3u8') || url.includes('.m3u8');

    if (isM3u8) {
      const response = await axios.get(url, { timeout: 10000 });
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
      const token = req.query.token;
      const rewritten = rewritePlaylistAbsolute(response.data, baseUrl, token);

      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(rewritten);
    } else {
      const headers = {};
      if (req.headers.range) {
        headers.Range = req.headers.range;
      }

      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 15000,
        headers
      });

      res.set('Content-Type', response.headers['content-type'] || 'video/mp4');
      if (response.headers['content-range']) {
        res.set('Content-Range', response.headers['content-range']);
        res.status(206);
      }
      if (response.headers['content-length']) {
        res.set('Content-Length', response.headers['content-length']);
      }
      res.set('Accept-Ranges', 'bytes');

      response.data.pipe(res);
    }
  } catch (err) {
    console.error(`Mediathek Proxy error: ${err.message}`);
    res.status(502).json({ error: 'Failed to fetch mediathek resource' });
  }
});

// --- Stream availability check (used by handlers before launching) ---
async function checkStreamAvailable(url) {
  try {
    const response = await axios.head(url, {
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: () => true
    });
    return { available: response.status < 400, status: response.status };
  } catch {
    return { available: false, status: 0 };
  }
}

function rewritePlaylist(content, upstreamBase, proxyBase, token) {
  return content.split('\n')
    // Strip I-Frame streams - Alexa VideoApp doesn't support them
    .filter(line => !line.trim().startsWith('#EXT-X-I-FRAME-STREAM-INF'))
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Rewrite URI="..." attributes in #EXT-X tags
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (match, uri) => {
          const proxyUri = `${proxyBase}/${uri}?token=${token}`;
          return `URI="${proxyUri}"`;
        });
      }

      // Rewrite plain URL lines
      let absoluteUrl;
      try {
        absoluteUrl = new URL(trimmed, upstreamBase).href;
      } catch {
        return line;
      }

      const relativePath = absoluteUrl.startsWith(upstreamBase)
        ? absoluteUrl.substring(upstreamBase.length)
        : trimmed;

      return `${proxyBase}/${relativePath}?token=${token}`;
    }).join('\n');
}

function rewritePlaylistAbsolute(content, baseUrl, token) {
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(trimmed, baseUrl).href;
    } catch {
      return line;
    }

    return `/proxy/mediathek?url=${encodeURIComponent(absoluteUrl)}&token=${token}`;
  }).join('\n');
}

module.exports = router;
module.exports.checkStreamAvailable = checkStreamAvailable;
