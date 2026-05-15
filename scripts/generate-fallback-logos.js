#!/usr/bin/env node
/**
 * Generates fallback PNG placeholders for the LaunchScreen MediaCard image
 * area when no real cover / thumbnail is available.
 *
 * Idempotent: each file is only generated if it does NOT already exist.
 * This means real designer-supplied PNGs committed at public/logos/_fallback_*.png
 * are preserved across container boots — only missing files get a generated
 * placeholder so the UI never has broken image references.
 *
 * Files:
 *   _fallback_local.png    560x270  film / generic local content
 *   _fallback_series.png   560x270  tv series episodes
 *   _fallback_news.png     560x270  news items where channel mapping failed
 *   _fallback_youtube.png  560x270  youtube videos where ytimg 404s
 *
 * Usage: node scripts/generate-fallback-logos.js
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'public', 'logos');
const W = 560, H = 270;

async function makeIfMissing(filename, glyph, label, accent) {
  const outPath = path.join(OUT_DIR, filename);
  if (fs.existsSync(outPath)) {
    console.log(`skip ${filename} (already exists)`);
    return;
  }
  // Plain text glyph (no emoji — Alpine fonts won't render them), large and bold.
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#1a2030"/>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" fill="none" stroke="${accent}" stroke-width="3" rx="20"/>
  <text x="50%" y="42%" font-family="sans-serif" font-size="80" font-weight="bold"
        fill="${accent}" text-anchor="middle" dominant-baseline="central">${glyph}</text>
  <text x="50%" y="78%" font-family="sans-serif" font-size="34" font-weight="bold"
        fill="${accent}" text-anchor="middle" dominant-baseline="central">${label}</text>
</svg>`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(outPath);
  console.log(`wrote ${filename}`);
}

(async () => {
  await makeIfMissing('_fallback_local.png',   '▣', 'LOKAL',   '#4FC3F7');
  await makeIfMissing('_fallback_series.png',  '▦', 'SERIE',   '#4FC3F7');
  await makeIfMissing('_fallback_news.png',    '◉', 'NEWS',    '#4FC3F7');
  await makeIfMissing('_fallback_youtube.png', '▶', 'YOUTUBE', '#FF5252');
})();
