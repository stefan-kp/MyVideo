/**
 * Voice-hint pool for the LaunchScreen voice-hint bar.
 *
 * Single source of truth — both LaunchHandler (which picks one at random per
 * launch) and aplHelper (which uses the first one as the renderLaunchScreen
 * default if no voiceHint is supplied) import from here. Keeps the two
 * consumers in sync if the wording changes.
 */
const VOICE_HINTS = Object.freeze([
  'Sag: Tagesschau, Queue, ORF1',
  'Sag: spiel Queue weiter',
  'Sag: ORF1, ZDF oder zeig alle Sender',
  'Sag: was läuft heute',
  'Sag: zeig YouTube, zeig Sport',
]);

function pickVoiceHint() {
  return VOICE_HINTS[Math.floor(Math.random() * VOICE_HINTS.length)];
}

const DEFAULT_VOICE_HINT = VOICE_HINTS[0];

module.exports = { VOICE_HINTS, pickVoiceHint, DEFAULT_VOICE_HINT };
