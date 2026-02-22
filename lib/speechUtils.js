function sanitizeForSpeech(text) {
  return text
    .replace(/&/g, 'und')
    .replace(/[<>]/g, '')
    .replace(/"/g, '')
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function relativeTime(timestamp) {
  const now = Date.now();
  const ts = timestamp * 1000;
  const diff = now - ts;
  const hours = Math.floor(diff / 3600000);
  const date = new Date(ts);
  const hour = date.getHours();

  if (diff < 0) return 'bald';
  if (hours < 1) return 'gerade eben';
  if (hours < 3) return `vor ${hours} Stunden`;

  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeOfDay = hour < 6 ? 'Nacht' : hour < 12 ? 'Vormittag' : hour < 18 ? 'Nachmittag' : 'Abend';

  if (isToday) return `heute ${timeOfDay}`;
  if (isYesterday) return `gestern ${timeOfDay}`;

  const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  if (hours < 168) return `am ${days[date.getDay()]}`;

  return `vom ${date.getDate()}.${date.getMonth() + 1}.`;
}

function formatResultForSpeech(result, index) {
  const minutes = Math.round(result.duration / 60);
  const durationText = minutes > 0 ? `, ${minutes} Minuten` : '';
  const time = relativeTime(result.timestamp);
  const title = sanitizeForSpeech(result.title);
  return `${index + 1}: ${title}, ${time}${durationText}`;
}

module.exports = { sanitizeForSpeech, relativeTime, formatResultForSpeech };
