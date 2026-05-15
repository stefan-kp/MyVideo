/**
 * Top-3 Live-TV channels for LaunchScreen, country-dependent.
 *
 * Read env LAUNCH_COUNTRY at call time so tests can toggle it.
 * AT (default) shows ORF1, ORF2 Tirol, ORF III.
 * DE shows Das Erste, ZDF, arte.
 * Unknown values fall back to AT.
 */
const AT_TOP = Object.freeze(['orf1', 'orf2t', 'orf3']);
const DE_TOP = Object.freeze(['dasErsteHd', 'zdfHd', 'arteHd']);

function getTopChannelIds() {
  const country = (process.env.LAUNCH_COUNTRY || 'AT').toUpperCase();
  if (country === 'DE') return DE_TOP.slice();
  return AT_TOP.slice();
}

module.exports = { getTopChannelIds, AT_TOP, DE_TOP };
