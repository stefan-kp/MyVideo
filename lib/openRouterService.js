const axios = require('axios');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

function isAvailable() {
  return !!process.env.OPENROUTER_API_KEY;
}

async function generateSummary(subtitleTexts) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const userContent = subtitleTexts.map(s => {
    const time = s.timestamp
      ? new Date(s.timestamp * 1000).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';
    return `=== ${s.title} (${s.channel}, ${time}) ===\n${s.text}`;
  }).join('\n\n');

  const response = await axios.post(OPENROUTER_API_URL, {
    model,
    messages: [
      {
        role: 'system',
        content: 'Fasse die folgenden Nachrichten-Untertitel zusammen. Liste die wichtigsten Themen als kurze Absaetze. Erwaehne am Anfang kurz die Quellen und das Datum der Nachrichten. Maximal 400 Woerter. Antworte auf Deutsch.'
      },
      {
        role: 'user',
        content: userContent
      }
    ]
  }, {
    timeout: 15000,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  return response.data.choices[0].message.content;
}

module.exports = { isAvailable, generateSummary };
