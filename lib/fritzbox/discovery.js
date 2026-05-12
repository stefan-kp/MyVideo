const axios = require('axios');

/**
 * Verify that all curated tunerIds exist in the FRITZ!Box HD channel listing.
 * Returns { ok: [], missing: [] }.
 * Throws if the FRITZ!Box itself is unreachable.
 */
async function verifyTuners(session, curatedChannels) {
  const sid = await session.getSid();
  const url = `http://${session.host}/dvb/tvhd.lua?sid=${sid}`;
  const resp = await axios.get(url, { timeout: 5000 });

  // Parse all tunerIds from HTML: href="dvb/m3u/<id>.m3u..."
  const idRegex = /href="dvb\/m3u\/(\d+_\d+)\.m3u/g;
  const fritzIds = new Set();
  let m;
  while ((m = idRegex.exec(resp.data)) !== null) {
    fritzIds.add(m[1]);
  }

  const ok = [];
  const missing = [];
  for (const ch of curatedChannels) {
    if (fritzIds.has(ch.tunerId)) ok.push(ch.id);
    else missing.push({ id: ch.id, tunerId: ch.tunerId, displayName: ch.displayName });
  }
  return { ok, missing, fritzCount: fritzIds.size };
}

module.exports = { verifyTuners };
