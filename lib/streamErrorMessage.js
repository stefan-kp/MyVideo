/**
 * Translate a thrown error into a user-speakable German sentence for Alexa.
 *
 * Sources (HlsSource, future FritzboxSource etc.) are expected to throw friendly
 * German messages. Guards against:
 *  - non-Error throwables (err.message undefined)
 *  - SSML-significant characters (< &) that would corrupt the speak payload
 *  - missing trailing period (breaks speech cadence)
 *  - oversized messages
 *
 * Falls back to a generic message when the thrown value doesn't look user-ready.
 */
function friendlyErrorMessage(err) {
  const fallback = 'Der Stream ist gerade nicht erreichbar.';
  const msg = err && typeof err.message === 'string' ? err.message.trim() : '';
  if (!msg) return fallback;
  if (msg.length > 200) return fallback;
  if (msg.includes('<') || msg.includes('&')) return fallback;
  return msg.endsWith('.') ? msg : `${msg}.`;
}

module.exports = { friendlyErrorMessage };
