/**
 * Adaptive greeting builder for LaunchScreen.
 *
 * Pure function — no I/O, no side-effects. Caller passes current state,
 * gets back the display header + spoken text + reprompt + priority bucket.
 *
 * Priority order (first matching rule wins):
 *   queue >=1            -> 'queue'
 *   queue 0, recent >=1  -> 'recent'
 *   queue 0, recent 0, newsOk=true   -> 'news'
 *   newsOk=false, liveTvOk=true       -> 'liveTv'
 *   everything down                   -> 'empty'
 */
function pluralize(n, singular, plural) {
  if (n === 1) return `ein ${singular}`;
  return `${n} ${plural}`;
}

function buildGreeting(input = {}) {
  const { queueCount = 0, recentCount = 0, newsOk = true, liveTvOk = true } = input || {};
  if (queueCount >= 1) {
    const qStr = pluralize(queueCount, 'Video', 'Videos');
    return {
      priority: 'queue',
      header: `Du hast ${qStr} in deiner Queue.`,
      speak: `Du hast ${qStr} in deiner Queue. Soll ich abspielen?`,
      reprompt: 'Soll ich die Queue starten?',
    };
  }
  if (recentCount >= 1 && newsOk) {
    const rStr = pluralize(recentCount, 'neue Aufnahme', 'neue Aufnahmen');
    return {
      priority: 'recent',
      header: 'Was möchtest du sehen?',
      speak: `Hallo. ${rStr} oder die aktuellen Nachrichten — was magst du?`,
      reprompt: 'Sage Nachrichten, Live-TV oder einen Titel.',
    };
  }
  if (newsOk) {
    return {
      priority: 'news',
      header: 'Aktuelle Nachrichten',
      speak: 'Was möchtest du sehen? Aktuelle Nachrichten, Live-TV oder einen Sender?',
      reprompt: 'Sage zum Beispiel: Tagesschau.',
    };
  }
  if (liveTvOk) {
    return {
      priority: 'liveTv',
      header: 'Live-TV verfügbar',
      speak: 'Die Mediathek ist gerade nicht erreichbar. Du kannst Live-TV starten — sage einen Sendernamen.',
      reprompt: 'Welchen Sender?',
    };
  }
  return {
    priority: 'empty',
    header: 'Hallo.',
    speak: 'Im Moment habe ich keine Inhalte. Versuche es später nochmal.',
    reprompt: null,
  };
}

module.exports = { buildGreeting, pluralize };
