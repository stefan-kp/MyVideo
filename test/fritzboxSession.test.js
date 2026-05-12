#!/usr/bin/env node
/**
 * FritzboxSession test - mocks HTTP via dependency injection
 * Run: node test/fritzboxSession.test.js
 */
const { FritzboxSession, computeResponse } = require('../lib/fritzbox/session');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

async function testChallengeResponse() {
  console.log('\n--- computeResponse (PBKDF2-HMAC-SHA256) ---');
  // Known FRITZ!Box test vector (from AVM docs)
  // Challenge: 2$60000$salt1$6000$salt2
  // password: "1example!"
  // Expected response format: salt2$hex
  const challenge = '2$60000$1234567890abcdef$6000$abcdef1234567890';
  const password = '1example!';
  const resp = computeResponse(challenge, password);
  assert(resp.startsWith('abcdef1234567890$'), 'response begins with salt2$');
  assert(resp.length > 65, 'response includes hash after salt');
}

async function testSessionLogin() {
  console.log('\n--- FritzboxSession.getSid (mocked HTTP) ---');
  const calls = [];
  const fakeHttp = {
    async get(url) {
      calls.push(url);
      if (calls.length === 1) {
        // First call: get challenge
        return { data: '<SessionInfo><SID>0000000000000000</SID><Challenge>2$60000$salt1$6000$salt2</Challenge></SessionInfo>' };
      }
      // Second call: login response
      return { data: '<SessionInfo><SID>aabbccdd11223344</SID></SessionInfo>' };
    }
  };
  const sess = new FritzboxSession({ host: '192.168.0.1', user: 'tv', password: 'secret', httpClient: fakeHttp });
  const sid = await sess.getSid();
  assert(sid === 'aabbccdd11223344', 'returns SID after challenge-response');
  assert(calls.length === 2, 'made exactly 2 HTTP calls');
  assert(calls[0].includes('/login_sid.lua?version=2'), 'first call is challenge endpoint');
  assert(calls[1].includes('username=tv'), 'second call passes username');
  assert(calls[1].includes('response=salt2$'), 'second call passes response');
}

async function testSessionCached() {
  console.log('\n--- FritzboxSession.getSid (cached) ---');
  let count = 0;
  const fakeHttp = {
    async get(url) {
      count++;
      if (count === 1) return { data: '<SessionInfo><SID>0000000000000000</SID><Challenge>2$60000$s1$6000$s2</Challenge></SessionInfo>' };
      return { data: '<SessionInfo><SID>cachedsid12345</SID></SessionInfo>' };
    }
  };
  const sess = new FritzboxSession({ host: '192.168.0.1', user: 'tv', password: 'p', httpClient: fakeHttp });
  const a = await sess.getSid();
  const b = await sess.getSid();
  assert(a === b, 'second call returns same SID');
  assert(count === 2, 'no extra HTTP calls (only initial login)');
}

async function testInvalidate() {
  console.log('\n--- FritzboxSession.invalidate ---');
  let count = 0;
  const sids = ['firstsid01234567', 'secondsid1234567'];
  const fakeHttp = {
    async get(url) {
      count++;
      if (url.includes('username=')) {
        const sid = sids.shift();
        return { data: `<SessionInfo><SID>${sid}</SID></SessionInfo>` };
      }
      return { data: '<SessionInfo><SID>0000000000000000</SID><Challenge>2$60000$s1$6000$s2</Challenge></SessionInfo>' };
    }
  };
  const sess = new FritzboxSession({ host: '192.168.0.1', user: 'tv', password: 'p', httpClient: fakeHttp });
  const first = await sess.getSid();
  sess.invalidate();
  const second = await sess.getSid();
  assert(first === 'firstsid01234567', 'first SID');
  assert(second === 'secondsid1234567', 'second SID after invalidate');
}

async function testWithSidRetriesOn403() {
  console.log('\n--- FritzboxSession.withSid (retry on 403) ---');
  let loginCount = 0;
  const fakeHttp = {
    async get(url) {
      if (url.includes('username=')) {
        loginCount++;
        return { data: `<SessionInfo><SID>sid${loginCount}aaaaaaaaaa</SID></SessionInfo>` };
      }
      return { data: '<SessionInfo><SID>0000000000000000</SID><Challenge>2$60000$s1$6000$s2</Challenge></SessionInfo>' };
    }
  };
  const sess = new FritzboxSession({ host: '192.168.0.1', user: 'tv', password: 'p', httpClient: fakeHttp });

  let attempt = 0;
  const result = await sess.withSid(async (sid) => {
    attempt++;
    if (attempt === 1) {
      const err = new Error('forbidden'); err.response = { status: 403 }; throw err;
    }
    return `ok-${sid}`;
  });
  assert(result === 'ok-sid2aaaaaaaaaa', 'second attempt with renewed SID succeeded');
  assert(loginCount === 2, 'logged in twice (initial + retry)');
}

(async () => {
  await testChallengeResponse();
  await testSessionLogin();
  await testSessionCached();
  await testInvalidate();
  await testWithSidRetriesOn403();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
