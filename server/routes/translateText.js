const express = require('express');
const router = express.Router();
const { logDebug, logError } = require('../utils/logger');

router.post('/translate-text', async (req, res) => {
  const apiKey = req.headers['x-gemini-api-key'];
  const { text, sourceLang, targetLang, model = process.env.DEFAULT_MODEL || 'gemini-3.6-flash' } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'Missing API Key in request headers.' });
  }

  if (!text || !sourceLang || !targetLang) {
    return res.status(400).json({ error: 'Missing required fields in request body.' });
  }

  try {
    const prompt = `Translate this text from language code ${sourceLang} to language code ${targetLang}.
Text: "${text}"
Return ONLY valid JSON with format: { "translatedText": "..." }`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Gemini API returned status ${response.status}`);
    }

    const responseData = await response.json();
    if (!responseData.candidates || !responseData.candidates[0] || !responseData.candidates[0].content) {
      throw new Error('Invalid response structure from Gemini API.');
    }

    let responseText = responseData.candidates[0].content.parts[0].text.trim();

    let parsedJson = null;
    try {
      parsedJson = JSON.parse(responseText);
    } catch (e) {
      let cleaned = responseText;
      if (cleaned.includes('```')) {
        const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match && match[1]) {
          cleaned = match[1].trim();
        }
      }

      try {
        parsedJson = JSON.parse(cleaned);
      } catch (e2) {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          const jsonStr = cleaned.substring(start, end + 1);
          try {
            parsedJson = JSON.parse(jsonStr);
          } catch (e3) {
            logDebug('Gemini text JSON parse fallback', e3.message);
          }
        }
      }
    }

    if (parsedJson && (parsedJson.translatedText || parsedJson.translated_text || parsedJson.translation)) {
      const translatedText = parsedJson.translatedText || parsedJson.translated_text || parsedJson.translation || '';
      return res.json({
        translatedText: String(translatedText).trim(),
      });
    }

    const cleanText = responseText.replace(/^["']|["']$/g, '').trim();
    return res.json({
      translatedText: cleanText,
    });
  } catch (error) {
    logError('Gemini text translation', error);
    return res.status(500).json({ error: error.message || 'Translation failed.' });
  }
});

module.exports = router;
