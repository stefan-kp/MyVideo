#!/usr/bin/env node
/**
 * Generates 3 simple fallback PNG placeholders (dark BG + emoji-like label).
 * Run once during build / when adding the feature; output is committed.
 *
 * Usage: node scripts/generate-fallback-logos.js
 */
const sharp = require('sharp');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'logos');
const W = 320, H = 192;

async function make(filename, label, hue) {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#1a2030"/>
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="none" stroke="${hue}" stroke-width="2" rx="14"/>
  <text x="50%" y="50%" font-family="sans-serif" font-size="36" font-weight="bold"
        fill="${hue}" text-anchor="middle" dominant-baseline="central">${label}</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT_DIR, filename));
  console.log(`wrote ${filename}`);
}

(async () => {
  await make('_fallback_local.png', '📁 LOKAL', '#4FC3F7');
  await make('_fallback_news.png', '📰 NEWS', '#4FC3F7');
  await make('_fallback_youtube.png', '▶ YOUTUBE', '#FF5252');
})();
