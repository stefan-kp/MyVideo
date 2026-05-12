#!/usr/bin/env node
const { parseRtspFromM3u, M3uResolver } = require('../lib/fritzbox/m3uResolver');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

function testParse() {
  console.log('\n--- parseRtspFromM3u ---');
  const m3u = '#EXTM3U\n#EXTINF:-1,ORF 1\nrtsp://192.168.0.1:554/?freq=474&pol=h&sr=27500\n';
  const url = parseRtspFromM3u(m3u);
  assert(url === 'rtsp://192.168.0.1:554/?freq=474&pol=h&sr=27500', 'extracts RTSP line');

  const empty = parseRtspFromM3u('#EXTM3U\nno rtsp here\n');
  assert(empty === null, 'returns null when no RTSP line');
}

async function testResolverCaching() {
  console.log('\n--- M3uResolver caching ---');
  let count = 0;
  const fakeSession = {
    host: '192.168.0.1',
    async getSid() { return 'fakesid12345678'; },
    async withSid(fn) { return fn('fakesid12345678'); },
  };
  const fakeHttp = {
    async get(url) {
      count++;
      return { data: '#EXTM3U\n#EXTINF:-1,X\nrtsp://192.168.0.1:554/?id=' + count + '\n' };
    }
  };
  const r = new M3uResolver({ session: fakeSession, httpClient: fakeHttp, ttlMs: 60000 });
  const a = await r.getRtspUrl('40200_1010');
  const b = await r.getRtspUrl('40200_1010');
  assert(a === b, 'cached result returned');
  assert(count === 1, 'only 1 HTTP call due to cache');

  const c = await r.getRtspUrl('40200_1020');
  assert(count === 2, 'different tuner triggers new fetch');
  assert(c !== a, 'different tuner returns different URL');
}

(async () => {
  testParse();
  await testResolverCaching();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
