const express = require('express');
const router = express.Router();
const voiceMap = require('../utils/voiceMap');
const { Communicate } = require('edge-tts-ts');
const { logError } = require('../utils/logger');

// Fallback voice if language not in map
const DEFAULT_VOICE = 'en-US-JennyNeural';

router.post('/tts', async (req, res) => {
  const { text, language } = req.body;

  if (!text || !language) {
    return res.status(400).json({ error: 'Missing text or language in request body.' });
  }

  const voice = voiceMap[language] || DEFAULT_VOICE;

  try {
    const comm = new Communicate(text, { voice });
    let chunks = [];

    for await (const chunk of comm.stream()) {
      if (chunk.type === "audio") {
        chunks.push(chunk.data);
      }
    }

    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      throw new Error("Edge TTS returned empty audio stream.");
    }

    const audioBase64 = audioBuffer.toString('base64');

    return res.json({
      audioBase64,
      mimeType: 'audio/mp3',
    });

  } catch (error) {
    logError('TTS local Edge', error);
    return res.status(500).json({ error: error.message || 'TTS request failed.' });
  }
});

module.exports = router;
