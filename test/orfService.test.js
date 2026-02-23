#!/usr/bin/env node

/**
 * ORF TVthek API Integration Test
 *
 * Ruft die echte API auf und prueft ob Credentials, Suche, Profile
 * und das Result-Mapping funktionieren.
 *
 * Ausfuehren: node test/orfService.test.js
 */

// ORF API muss fuer diesen Test aktiv sein
process.env.ORF_API = 'true';

const orfService = require('../lib/orfService');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function assertType(value, type, message) {
  assert(typeof value === type, `${message} (erwartet ${type}, bekommen ${typeof value})`);
}

function section(name) {
  console.log(`\n--- ${name} ---`);
}

async function testSearch() {
  section('searchEpisodes("ZIB 1")');

  const results = await orfService.searchEpisodes('ZIB 1', 5);

  assert(Array.isArray(results), 'Ergebnis ist ein Array');
  assert(results.length > 0, `${results.length} Ergebnisse gefunden`);

  if (results.length > 0) {
    const r = results[0];
    console.log(`\n  Erstes Ergebnis:`);
    console.log(`    title:       ${r.title}`);
    console.log(`    topic:       ${r.topic}`);
    console.log(`    channel:     ${r.channel}`);
    console.log(`    timestamp:   ${r.timestamp} (${new Date(r.timestamp * 1000).toLocaleString('de-AT')})`);
    console.log(`    duration:    ${r.duration}s (${Math.round(r.duration / 60)} Min)`);
    console.log(`    url:         ${r.url ? r.url.substring(0, 80) + '...' : 'FEHLT'}`);
    console.log(`    urlSubtitle: ${r.urlSubtitle ? r.urlSubtitle.substring(0, 80) + '...' : '(keine)'}`);
    console.log(`    imageUrl:    ${r.imageUrl ? r.imageUrl.substring(0, 80) + '...' : '(keine)'}`);
    console.log(`    segments:    ${r.segments ? r.segments.length + ' Kapitel' : '(keine)'}`);
    console.log(`    source:      ${r.source}`);

    assertType(r.title, 'string', 'title ist String');
    assert(r.title.length > 0, 'title ist nicht leer');
    assert(r.channel === 'ORF', 'channel ist ORF');
    assert(r.source === 'orf', 'source ist orf');
    assertType(r.timestamp, 'number', 'timestamp ist Number');
    assert(r.timestamp > 0, 'timestamp > 0');
    assertType(r.duration, 'number', 'duration ist Number');
    assert(r.url, 'url ist vorhanden');
    assert(r.url.includes('.m3u8') || r.url.includes('.mp4'), 'url ist Video-URL (.m3u8 oder .mp4)');
  }

  return results;
}

async function testSearchWithSegments() {
  section('searchEpisodes("ZIB 1") - Segment/Kapitel-Details');

  const results = await orfService.searchEpisodes('ZIB 1', 3);
  const withSegments = results.find(r => r.segments && r.segments.length > 0);

  if (withSegments) {
    console.log(`\n  Sendung mit Segmenten: "${withSegments.title}"`);
    console.log(`  Anzahl Segmente: ${withSegments.segments.length}`);

    assert(withSegments.segments.length > 1, 'Mehr als 1 Segment');

    for (let i = 0; i < Math.min(3, withSegments.segments.length); i++) {
      const seg = withSegments.segments[i];
      console.log(`    [${i + 1}] ${seg.title} (${Math.round(seg.duration / 60)} Min)`);
      console.log(`        url: ${seg.url ? seg.url.substring(0, 70) + '...' : 'FEHLT'}`);
    }
    if (withSegments.segments.length > 3) {
      console.log(`    ... und ${withSegments.segments.length - 3} weitere`);
    }

    const seg = withSegments.segments[0];
    assert(seg.title && seg.title.length > 0, 'Segment hat Titel');
    assert(seg.url && seg.url.length > 0, 'Segment hat URL');
    assertType(seg.duration, 'number', 'Segment duration ist Number');
  } else {
    console.log('  (Keine Ergebnisse mit Segmenten -- API liefert evtl. keine Segmente bei Suche)');
    // Kein Fehler, Suche liefert nicht immer Segmente
  }
}

async function testImageUrls() {
  section('Thumbnail/Vorschaubild-URLs');

  const results = await orfService.searchEpisodes('ZIB', 5);
  const withImage = results.filter(r => r.imageUrl && r.imageUrl.length > 0);

  console.log(`  ${withImage.length} von ${results.length} Ergebnissen haben Vorschaubilder`);

  if (withImage.length > 0) {
    const img = withImage[0];
    console.log(`  Beispiel: ${img.imageUrl.substring(0, 100)}...`);
    assert(img.imageUrl.startsWith('http'), 'imageUrl beginnt mit http');
  }

  assert(withImage.length > 0, 'Mindestens ein Ergebnis hat ein Vorschaubild');
}

async function testResolveProfile() {
  section('resolveProfileId / getLatestByTopic("ZIB 1")');

  const results = await orfService.getLatestByTopic('ZIB 1', 3);

  assert(Array.isArray(results), 'Ergebnis ist ein Array');
  assert(results.length > 0, `${results.length} Ergebnisse via Profil`);

  if (results.length > 0) {
    const r = results[0];
    console.log(`\n  Neueste Episode: "${r.title}"`);
    console.log(`    timestamp: ${new Date(r.timestamp * 1000).toLocaleString('de-AT')}`);
    console.log(`    segments:  ${r.segments ? r.segments.length : 0}`);
    console.log(`    imageUrl:  ${r.imageUrl ? 'ja' : 'nein'}`);

    // Profil-basierte Suche sollte eher Segmente liefern
    if (r.segments && r.segments.length > 0) {
      assert(true, `Profil-Ergebnis hat ${r.segments.length} Segmente`);
    } else {
      console.log('  (Profil-Ergebnis ohne Segmente -- evtl. braucht es getEpisodeDetails)');
    }
  }

  return results;
}

async function testEpisodeDetails() {
  section('getEpisodeDetails (falls Episode-ID bekannt)');

  // Erst eine Episode via Suche finden, dann Details holen
  const searchResults = await orfService.searchEpisodes('ZIB 1', 1);
  if (searchResults.length === 0) {
    console.log('  (Uebersprungen -- keine Suchergebnisse)');
    return;
  }

  // Episode-ID aus der URL extrahieren (Heuristik)
  // Alternativ: Wir testen einfach den Search-Endpunkt gruendlicher
  console.log('  (Episode-Details-Test benoetigt bekannte Episode-ID, uebersprungen)');
}

async function testSubtitles() {
  section('Untertitel-URLs');

  const results = await orfService.searchEpisodes('ZIB 1', 5);
  const withSubs = results.filter(r => r.urlSubtitle && r.urlSubtitle.length > 0);

  console.log(`  ${withSubs.length} von ${results.length} Ergebnissen haben Untertitel`);

  if (withSubs.length > 0) {
    const sub = withSubs[0];
    console.log(`  Beispiel: ${sub.urlSubtitle.substring(0, 100)}...`);
    assert(
      sub.urlSubtitle.includes('.ttml') || sub.urlSubtitle.includes('.xml') || sub.urlSubtitle.includes('.vtt'),
      'Untertitel-URL ist TTML/XML/VTT'
    );
  }
}

async function testIsEnabled() {
  section('isEnabled()');
  assert(orfService.isEnabled() === true, 'isEnabled() ist true (ORF_API=true gesetzt)');
}

async function testGetKnownTopics() {
  section('getKnownTopics()');
  const topics = orfService.getKnownTopics();
  assert(Array.isArray(topics), 'Ergebnis ist Array');
  assert(topics.includes('ZIB 1'), 'Enthaelt ZIB 1');
  assert(topics.includes('Spät-ZIB'), 'Enthaelt Spät-ZIB');
  console.log(`  Topics: ${topics.join(', ')}`);
}

async function main() {
  console.log('=== ORF TVthek API Integration Test ===\n');

  try {
    await testIsEnabled();
    await testGetKnownTopics();
    await testSearch();
    await testSearchWithSegments();
    await testImageUrls();
    await testResolveProfile();
    await testEpisodeDetails();
    await testSubtitles();
  } catch (err) {
    console.error(`\n!!! Unerwarteter Fehler: ${err.message}`);
    console.error(err.stack);
    failed++;
  }

  console.log(`\n=== Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
