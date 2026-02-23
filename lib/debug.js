/**
 * Debug-Logging Modul.
 * Aktivierung: DEBUG=true in .env
 * Loggt mit [DEBUG] Prefix fuer einfaches Filtern.
 */

const DEBUG = process.env.DEBUG === 'true';

function debug(...args) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  console.log(`[DEBUG ${timestamp}]`, ...args);
}

function debugJson(label, obj) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  console.log(`[DEBUG ${timestamp}] ${label}:`, JSON.stringify(obj, null, 2));
}

function debugTruncated(label, text, maxLen = 500) {
  if (!DEBUG) return;
  const timestamp = new Date().toISOString();
  if (text && text.length > maxLen) {
    console.log(`[DEBUG ${timestamp}] ${label} (${text.length} chars, truncated):`, text.substring(0, maxLen) + '...');
  } else {
    console.log(`[DEBUG ${timestamp}] ${label}:`, text);
  }
}

module.exports = { debug, debugJson, debugTruncated };
