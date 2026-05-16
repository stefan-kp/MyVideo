#!/usr/bin/env node
/**
 * Tests the MCP-tool logic directly (without going through the HTTP
 * transport). We call the registered tool handlers and assert on their
 * return shape + side-effects on the queue.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Queue } = require('../lib/queue');
const { buildServer } = require('../lib/mcp/server');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }
function tmpFile() { return path.join(os.tmpdir(), `mcp-test.${Date.now()}.${Math.random()}.json`); }

// Wait until predicate returns truthy, polling every 10ms up to maxMs.
async function waitFor(predicate, maxMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 10));
  }
  return false;
}

function callTool(server, name, args) {
  const tool = server._registeredTools[name];
  if (!tool) throw new Error(`tool not found: ${name}`);
  // SDK exposes the registered handler under .handler (called by the
  // SDK's CallToolRequest dispatcher). We invoke it directly here so we
  // don't need a full HTTP transport in tests.
  return tool.handler(args || {}, {});
}

(async () => {
  console.log('\n--- list_queue: returns count + items ---');
  const q1 = new Queue();
  q1.file = tmpFile();
  q1.add({ source: 'mediathek', url: 'http://x/a.m3u8', title: 'Tagesschau' });
  const s1 = buildServer({
    queue: q1,
    contentService: { isEnabled: () => false },
    youtubeDir: '/tmp/yt',
  });
  const r1 = await callTool(s1, 'list_queue');
  assert(r1.structuredContent.count === 1, `count 1 (got ${r1.structuredContent.count})`);
  assert(r1.structuredContent.items[0].title === 'Tagesschau', 'title');
  assert(r1.structuredContent.items[0].source === 'mediathek', 'source');
  assert(r1.structuredContent.items[0].status === 'ready', 'status ready by default');
  assert(r1.content[0].type === 'text', 'has text content for old clients');
  assert(r1.content[0].text.includes('Tagesschau'), 'text content includes title');

  console.log('\n--- add_youtube_to_queue: happy path ---');
  const q2 = new Queue();
  q2.file = tmpFile();
  let dlCalled = null;
  const fakeFile = '/tmp/fakeyt/dQw4w9WgXcQ-rick.mp4';
  const fakeContentSvc = {
    isEnabled: () => true,
    rescan: async () => ({ entries: 1 }),
    getIndex: () => ({ all: () => [{ id: 'youtube/_inbox/dqw4w9wgxcq', path: fakeFile }] }),
  };
  const s2 = buildServer({
    queue: q2,
    contentService: fakeContentSvc,
    youtubeDir: '/tmp/yt',
    downloadFn: async (opts) => { dlCalled = opts; return fakeFile; },
  });
  const r2 = await callTool(s2, 'add_youtube_to_queue', {
    youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ',
    title: 'Rick Roll',
  });
  assert(r2.structuredContent.ok === true, 'ok=true');
  assert(r2.structuredContent.videoId === 'dQw4w9WgXcQ', 'videoId extracted');
  assert(r2.structuredContent.status === 'downloading', 'initial status downloading');
  assert(q2.list().length === 1, 'queue has 1 item');
  assert(q2.list()[0].source === 'youtube_pending', 'item is pending');
  // Wait for the background download to complete
  const completed = await waitFor(() => q2.list()[0].status === 'ready', 2000);
  assert(completed, 'background download completed within 2s');
  if (completed) {
    const finalItem = q2.list()[0];
    assert(finalItem.source === 'local', `source flipped to local (got: ${finalItem.source})`);
    assert(finalItem.contentId === 'youtube/_inbox/dqw4w9wgxcq', 'contentId set');
    assert(finalItem.imageUrl.includes('i.ytimg.com'), 'ytimg URL set');
  }
  assert(dlCalled && dlCalled.videoId === 'dQw4w9WgXcQ', 'downloader was called');

  console.log('\n--- add_youtube_to_queue: invalid URL ---');
  const q3 = new Queue();
  q3.file = tmpFile();
  const s3 = buildServer({
    queue: q3,
    contentService: { isEnabled: () => false },
    youtubeDir: '/tmp/yt',
    downloadFn: async () => { throw new Error('should not be called'); },
  });
  const r3 = await callTool(s3, 'add_youtube_to_queue', { youtubeUrl: 'not-a-youtube-url' });
  assert(r3.isError === true, 'returned isError=true');
  assert(r3.structuredContent.ok === false, 'ok=false');
  assert(r3.structuredContent.error === 'invalid_url', 'error code invalid_url');
  assert(q3.list().length === 0, 'nothing added to queue');

  console.log('\n--- add_youtube_to_queue: duplicate ---');
  const q4 = new Queue();
  q4.file = tmpFile();
  const s4 = buildServer({
    queue: q4,
    contentService: { isEnabled: () => false },
    youtubeDir: '/tmp/yt',
    // Make download hang so the first add stays as 'downloading'
    downloadFn: () => new Promise(() => {}),
  });
  await callTool(s4, 'add_youtube_to_queue', { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' });
  const r4 = await callTool(s4, 'add_youtube_to_queue', { youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' });
  assert(r4.isError === true, 'duplicate is error');
  assert(r4.structuredContent.error === 'duplicate', 'error code duplicate');
  assert(r4.structuredContent.existingId, 'existingId returned');

  console.log('\n--- list_queue includes pending items with status ---');
  const r5 = await callTool(s4, 'list_queue');
  assert(r5.structuredContent.items[0].status === 'downloading', 'pending status visible in list');
  assert(r5.structuredContent.items[0].youtubeUrl === 'https://youtu.be/dQw4w9WgXcQ', 'youtubeUrl visible');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(err => { console.error('TEST CRASH:', err); process.exit(2); });
