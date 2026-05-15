/**
 * Map a Mediathek/ORF "channel" string (e.g. "ORF1", "ZDF", "Das Erste") to
 * the matching logo file in public/logos/. Independent from
 * lib/fritzbox/channels.json because "logical broadcaster" ≠ "DVB tuner".
 *
 * Fallback: _fallback_news.png (a generic placeholder).
 */

const FALLBACK = '_fallback_news.png';

const MAP = [
  // ORF
  { pattern: /^orf\s*1$/i,    file: 'orf1_hd.png' },
  { pattern: /^orf\s*2$/i,    file: 'orf2o_hd.png' },
  { pattern: /^orf\s*iii$/i,  file: 'orf_iii_hd.png' },
  { pattern: /^orf\s*3$/i,    file: 'orf_iii_hd.png' },
  { pattern: /^orf\s*sport/i, file: 'orf_sport+_hd.png' },
  { pattern: /zib/i,          file: 'orf1_hd.png' }, // generic ORF1 unless ORF API gives specific channel
  // ARD family
  { pattern: /^(ard|das\s*erste)/i, file: 'das_erste_hd.png' },
  { pattern: /tagesschau/i,         file: 'tagesschau24_hd.png' },
  { pattern: /^one$/i,              file: 'one_hd.png' },
  { pattern: /alpha/i,              file: 'ard_alpha_hd.png' },
  // ZDF family
  { pattern: /^zdf(\s|heute|$)/i,   file: 'zdf_hd.png' },
  { pattern: /^heute/i,             file: 'zdf_hd.png' },
  { pattern: /zdf\s*neo/i,          file: 'zdf_neo_hd.png' },
  { pattern: /zdf\s*info/i,         file: 'zdf_info_hd.png' },
  // Misc
  { pattern: /3\s*sat/i,            file: '3sat_hd.png' },
  { pattern: /phoenix/i,            file: 'phoenix_hd.png' },
  { pattern: /arte/i,               file: 'arte_hd.png' },
];

function getLogoFileForNewsChannel(channelName) {
  if (!channelName || typeof channelName !== 'string') return FALLBACK;
  const trimmed = channelName.trim();
  if (!trimmed) return FALLBACK;
  for (const { pattern, file } of MAP) {
    if (pattern.test(trimmed)) return file;
  }
  return FALLBACK;
}

function baseUrl() {
  return process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

function getLogoUrlForNewsChannel(channelName) {
  const file = getLogoFileForNewsChannel(channelName);
  return `${baseUrl()}/logos/${file}`;
}

module.exports = { getLogoFileForNewsChannel, getLogoUrlForNewsChannel, FALLBACK };
