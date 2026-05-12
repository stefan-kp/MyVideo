#!/usr/bin/env node
/**
 * streamErrorMessage test
 * Locks the contract for translating thrown errors into user-speakable strings
 * for Alexa.
 * Run: node test/streamErrorMessage.test.js
 */
process.env.JWT_SECRET = 'test-secret-1234567890abcdef1234567890abcdef';

const { friendlyErrorMessage } = require('../lib/streamErrorMessage');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { console.log(`  ✓ ${m}`); passed++; } else { console.error(`  ✗ ${m}`); failed++; } }

console.log('\n--- friendlyErrorMessage ---');

assert(friendlyErrorMessage(new Error('ZDF ist gerade geo-blockiert.')) === 'ZDF ist gerade geo-blockiert.',
  'passes through friendly German message ending with period');

assert(friendlyErrorMessage(new Error('Stream nicht erreichbar')) === 'Stream nicht erreichbar.',
  'appends missing trailing period');

assert(friendlyErrorMessage(new Error('ECONNREFUSED 192.168.0.1:80')) === 'ECONNREFUSED 192.168.0.1:80.',
  'short technical message passes through (with period)');

const generic = 'Der Stream ist gerade nicht erreichbar.';

assert(friendlyErrorMessage(new Error('')) === generic, 'empty message → fallback');
assert(friendlyErrorMessage(new Error('   ')) === generic, 'whitespace-only → fallback');
assert(friendlyErrorMessage({}) === generic, 'non-Error object → fallback');
assert(friendlyErrorMessage(null) === generic, 'null → fallback');
assert(friendlyErrorMessage(undefined) === generic, 'undefined → fallback');
assert(friendlyErrorMessage('plain string') === generic, 'thrown string → fallback');

assert(friendlyErrorMessage(new Error('error contains <script>')) === generic,
  'SSML-unsafe < → fallback');
assert(friendlyErrorMessage(new Error('foo & bar')) === generic,
  'SSML-unsafe & → fallback');

const longMsg = 'x'.repeat(250);
assert(friendlyErrorMessage(new Error(longMsg)) === generic, 'oversize message → fallback');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
