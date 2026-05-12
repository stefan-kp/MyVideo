const axios = require('axios');

const TUNER_LISTING_PAGES = ['tvhd.lua', 'tvsd.lua'];

/**
 * Verify that all curated tunerIds exist in the FRITZ!Box channel listings.
 * Checks both the HD listing (/dvb/tvhd.lua) and the SD listing (/dvb/tvsd.lua),
 * since some channels (notably Austrian private broadcasters: ProSieben, SAT.1,
 * RTL, VOX) appear only on the SD page.
 * Returns { ok: [], missing: [], fritzCount }.
 * Throws if the FRITZ!Box itself is unreachable.
 */
async function verifyTuners(session, curatedChannels) {
  const sid = await session.getSid();
  const idRegex = /href="dvb\/m3u\/(\d+_\d+)\.m3u/g;
  const fritzIds = new Set();

  for (const page of TUNER_LISTING_PAGES) {
    const url = `http://${session.host}/dvb/${page}?sid=${sid}`;
    try {
      const resp = await axios.get(url, { timeout: 5000 });
      let m;
      while ((m = idRegex.exec(resp.data)) !== null) {
        fritzIds.add(m[1]);
      }
      idRegex.lastIndex = 0;
    } catch (err) {
      // If one page fails, log but try the other - users may only have one type
      console.warn(`FRITZ!Box discovery: ${page} failed (${err.message})`);
    }
  }

  if (fritzIds.size === 0) {
    throw new Error('No tuner IDs found on FRITZ!Box (both HD and SD listings empty or unreachable)');
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
