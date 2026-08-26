const WebSocket = require('ws');
const { URL } = require('url');

const { verifyToken } = require('../utils/auth');
const { findUserById } = require('../utils/db');
const { decrypt } = require('../utils/crypto');

const DEFAULT_MODEL = 'gemini-3.5-live-translate-preview';

function safeCloseClient(client, code, reason) {
  try {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'error', error: reason }));
    }
  } catch {}
  try {
    client.close(code || 1011, reason || 'closed');
  } catch {}
}

function buildSetupMessage({ model, targetLang }) {
  // Google expects ISO language tag (e.g. "vi" not "vi-VN")
  const target = (targetLang || 'en').split('-')[0].toLowerCase();
  // Per Live API reference: inputAudioTranscription / outputAudioTranscription are
  // direct children of `setup` (NOT inside generationConfig). translationConfig
  // belongs under generationConfig.
  return {
    setup: {
      model: model.startsWith('models/') ? model : `models/${model}`,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      generationConfig: {
        responseModalities: ['AUDIO'],
        translationConfig: {
          targetLanguageCode: target,
          echoTargetLanguage: false,
        },
      },
    },
  };
}

function attachLiveTranslate(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    if (pathname !== '/ws/live-translate') return; // let other upgrade handlers run

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (client, req) => {
    let upstream = null;
    try {
      const reqUrl = new URL(req.url, `http://${req.headers.host}`);
      const token = reqUrl.searchParams.get('token');
      const sourceLang = reqUrl.searchParams.get('source') || 'en-US';
      const targetLang = reqUrl.searchParams.get('target') || 'vi-VN';
      const model = reqUrl.searchParams.get('model') || DEFAULT_MODEL;

      if (!token) return safeCloseClient(client, 4401, 'Missing auth token');

      let payload;
      try {
        payload = verifyToken(token);
      } catch {
        return safeCloseClient(client, 4401, 'Invalid token');
      }

      const user = findUserById(payload.sub);
      if (!user) return safeCloseClient(client, 4401, 'User not found');

      let apiKey = '';
      try {
        apiKey = decrypt(user.apiKeyEnc || '');
      } catch {}
      if (!apiKey) return safeCloseClient(client, 4402, 'API key chưa được cấu hình.');

      const upstreamUrl =
        `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;

      upstream = new WebSocket(upstreamUrl);

      upstream.on('open', () => {
        const setupMsg = buildSetupMessage({ model, targetLang });
        upstream.send(JSON.stringify(setupMsg));
        try {
          client.send(JSON.stringify({ type: 'ready', sourceLang, targetLang, model }));
        } catch {}
      });

      upstream.on('message', (data) => {
        try {
          if (client.readyState !== WebSocket.OPEN) return;
          // Always coerce to UTF-8 text. Google's BidiGenerateContent returns JSON;
          // forwarding as a string guarantees the browser receives a text frame.
          const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
          client.send(text);
        } catch (err) {
          console.warn('[live] forward upstream -> client failed:', err.message);
        }
      });

      upstream.on('close', (code, reason) => {
        safeCloseClient(client, 1000, `upstream closed (${code}): ${reason}`);
      });

      upstream.on('error', (err) => {
        console.error('[live] upstream error:', err.message);
        safeCloseClient(client, 1011, `upstream error: ${err.message}`);
      });

      client.on('message', (data, isBinary) => {
        if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
        try {
          upstream.send(isBinary ? data : data.toString('utf8'));
        } catch (err) {
          console.warn('[live] forward client -> upstream failed:', err.message);
        }
      });

      client.on('close', () => {
        try {
          if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close();
        } catch {}
      });

      client.on('error', (err) => {
        console.warn('[live] client error:', err.message);
        try {
          if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close();
        } catch {}
      });
    } catch (err) {
      console.error('[live] connection setup error:', err);
      safeCloseClient(client, 1011, err.message || 'setup failed');
      try {
        if (upstream && upstream.readyState === WebSocket.OPEN) upstream.close();
      } catch {}
    }
  });

  return wss;
}

module.exports = { attachLiveTranslate, buildSetupMessage };
