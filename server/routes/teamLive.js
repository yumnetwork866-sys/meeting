const crypto = require('crypto');
const WebSocket = require('ws');
const { URL } = require('url');

const { verifyToken } = require('../utils/auth');
const {
  findUserById,
  createLiveRoomExport,
  updateLiveRoomExport,
  insertLiveRoomTranscript,
  closeLiveRoomExport,
} = require('../utils/db');
const { decrypt } = require('../utils/crypto');
const { buildSetupMessage } = require('./liveTranslate');

const DEFAULT_MODEL = 'gemini-3.5-live-translate-preview';
const rooms = new Map();
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;
const STOP_GRACE_MS = 1200;
const RECONNECT_GRACE_MS = 10000;

function send(client, payload) {
  if (client.readyState !== WebSocket.OPEN) return;
  try {
    client.send(JSON.stringify(payload));
  } catch {}
}

function broadcast(room, payload) {
  for (const participant of room.participants.values()) {
    send(participant.ws, payload);
  }
}

function findParticipantByUserId(room, userId) {
  for (const participant of room.participants.values()) {
    if (participant.userId === userId) return participant;
  }
  return null;
}

function makeRoomId() {
  for (let i = 0; i < 8; i++) {
    const id = crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
    if (!rooms.has(id)) return id;
  }
  return crypto.randomUUID().slice(0, 6).toUpperCase();
}

function publicParticipant(participant) {
  return {
    id: participant.id,
    username: participant.username,
    language: participant.language || '',
    isSpeaker: participant.id === participant.room?.activeSpeakerId,
  };
}

function publicTranscript(transcript) {
  return {
    id: transcript.id,
    exportId: transcript.exportId,
    roomCode: transcript.roomCode,
    speakerId: transcript.speakerId || null,
    speakerName: transcript.speakerName || '',
    originalText: transcript.originalText || '',
    translatedText: transcript.translatedText || '',
    sourceLang: transcript.sourceLang || '',
    targetLang: transcript.targetLang || '',
    createdAt: transcript.createdAt || new Date().toISOString(),
  };
}

function roomState(room) {
  return {
    type: 'room_state',
    roomId: room.id,
    sourceLang: room.sourceLang,
    targetLang: room.targetLang,
    model: room.model,
    activeSpeakerId: room.activeSpeakerId,
    participants: Array.from(room.participants.values()).map(publicParticipant),
  };
}

function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function mergeLiveText(current, incoming) {
  const next = String(incoming || '');
  if (!next) return current;
  if (!current) return next;

  // Live API may send the cumulative transcription snapshot on each update.
  // Preserve the latest snapshot instead of appending duplicates.
  if (next === current) return current;
  if (next.startsWith(current)) return next;
  if (current.endsWith(next)) return current;

  return current + next;
}

function resetTurnBuffers(room) {
  room.turnSource = '';
  room.turnTarget = '';
  room.turnSourceLang = '';
  room.turnTargetLang = '';
  room.turnSpeakerId = null;
  room.turnSpeakerName = '';
}

function flushRoomTranscript(room, { force = false, allowEmpty = false } = {}) {
  const original = String(room.turnSource || '').trim();
  const translated = String(room.turnTarget || '').trim();
  if (!original && !translated && !allowEmpty) return;
  if (!original && !translated && force && !allowEmpty) return;

  const transcript = {
    id: crypto.randomUUID(),
    exportId: room.exportId,
    roomCode: room.id,
    speakerId: room.turnSpeakerId || room.activeSpeakerId || null,
    speakerName: room.turnSpeakerName || '',
    originalText: original,
    translatedText: translated,
    sourceLang: room.turnSourceLang || room.sourceLang,
    targetLang: room.turnTargetLang || room.targetLang,
    createdAt: new Date().toISOString(),
  };

  room.transcripts.push(transcript);
  insertLiveRoomTranscript(transcript);
  updateLiveRoomExport(room.exportId, { transcriptCount: room.transcripts.length });
  resetTurnBuffers(room);
}

function finalizeSpeaker(room, reason = 'speaker stopped') {
  if (room.stopTimer) {
    clearTimeout(room.stopTimer);
    room.stopTimer = null;
  }
  flushRoomTranscript(room, { force: true });
  room.stopRequested = false;
  room.stopReason = '';

  const upstream = room.upstream;
  room.upstream = null;
  room.activeSpeakerId = null;

  if (upstream) {
    try {
      upstream.close();
    } catch {}
  }

  broadcast(room, { type: 'speaker_stopped', reason });
  broadcast(room, roomState(room));
}

function requestSpeakerStop(room, reason = 'speaker stopped') {
  room.stopRequested = true;
  room.stopReason = reason;

  if (room.stopTimer) {
    clearTimeout(room.stopTimer);
  }

  room.stopTimer = setTimeout(() => {
    finalizeSpeaker(room, room.stopReason || reason);
  }, STOP_GRACE_MS);
}

function joinRoom(client, user, room, apiKey) {
  if (room.emptyRoomTimer) {
    clearTimeout(room.emptyRoomTimer);
    room.emptyRoomTimer = null;
  }

  const existingParticipant = findParticipantByUserId(room, user.id);
  if (existingParticipant) {
    if (existingParticipant.disconnectTimer) {
      clearTimeout(existingParticipant.disconnectTimer);
      existingParticipant.disconnectTimer = null;
    }
    existingParticipant.username = user.username;
    existingParticipant.apiKey = apiKey;
    existingParticipant.ws = client;
    existingParticipant.room = room;
    client.teamParticipant = existingParticipant;
    send(client, { type: 'connected', clientId: existingParticipant.id, username: user.username });
    send(client, {
      type: 'room_history',
      transcripts: room.transcripts.map(publicTranscript),
    });
    broadcast(room, roomState(room));
    return;
  }

  const participant = {
    id: crypto.randomUUID(),
    userId: user.id,
    username: user.username,
    language: '',
    apiKey,
    ws: client,
    room,
    disconnectTimer: null,
  };

  client.teamParticipant = participant;
  room.participants.set(participant.id, participant);
  send(client, { type: 'connected', clientId: participant.id, username: user.username });
  send(client, {
    type: 'room_history',
    transcripts: room.transcripts.map(publicTranscript),
  });
  broadcast(room, roomState(room));
}

function stopSpeaker(room, reason = 'speaker stopped') {
  finalizeSpeaker(room, reason);
}

function startSpeaker(room, participant) {
  if (room.activeSpeakerId && room.activeSpeakerId !== participant.id) {
    send(participant.ws, { type: 'error', error: 'Một người khác đang nói trong phòng.' });
    return;
  }
  if (!participant.apiKey) {
    send(participant.ws, { type: 'error', error: 'API key chưa được cấu hình.' });
    return;
  }
  if (!participant.language) {
    send(participant.ws, { type: 'error', error: 'Hãy chọn ngôn ngữ bạn sẽ nói trước.' });
    return;
  }
  room.activeSpeakerId = participant.id;
  room.stopRequested = false;
  room.stopReason = '';
  if (room.stopTimer) {
    clearTimeout(room.stopTimer);
    room.stopTimer = null;
  }
  const upstreamUrl =
    `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(participant.apiKey)}`;

  const sourceLang = participant.language;
  const targetLang = participant.language === room.sourceLang ? room.targetLang : room.sourceLang;
  const upstream = new WebSocket(upstreamUrl);
  room.upstream = upstream;
  room.turnSource = '';
  room.turnTarget = '';
  room.turnSourceLang = sourceLang;
  room.turnTargetLang = targetLang;
  room.turnSpeakerId = participant.id;
  room.turnSpeakerName = participant.username;

  upstream.on('open', () => {
    upstream.send(JSON.stringify(buildSetupMessage({
      model: room.model,
      targetLang,
    })));
    broadcast(room, {
      type: 'speaker_started',
      speakerId: participant.id,
      speakerName: participant.username,
      sourceLang,
      targetLang,
    });
    send(participant.ws, { type: 'live_ready' });
    broadcast(room, roomState(room));
  });

  upstream.on('message', (data) => {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    let turnComplete = false;
    try {
      const parsed = JSON.parse(text);
      const content = pick(parsed, 'serverContent', 'server_content');
      const inputTr = pick(
        content,
        'inputTranscription',
        'input_transcription',
        'inputAudioTranscription',
        'input_audio_transcription'
      );
      if (inputTr?.text) {
        room.turnSource = mergeLiveText(room.turnSource, inputTr.text);
      }
      const outputTr = pick(
        content,
        'outputTranscription',
        'output_transcription',
        'outputAudioTranscription',
        'output_audio_transcription'
      );
      if (outputTr?.text) {
        room.turnTarget = mergeLiveText(room.turnTarget, outputTr.text);
      }
      turnComplete = !!(content && (content.turnComplete || content.turn_complete));
    } catch {}
    broadcast(room, {
      type: 'live_message',
      speakerId: participant.id,
      speakerName: participant.username,
      sourceLang,
      targetLang,
      data: text,
    });
    if (turnComplete) {
      flushRoomTranscript(room, { allowEmpty: true });
    }
    if (turnComplete && room.stopRequested) {
      finalizeSpeaker(room, room.stopReason || 'speaker stopped');
    }
  });

  upstream.on('close', (code, reason) => {
    if (room.upstream !== upstream) return;
    room.upstream = null;
    room.activeSpeakerId = null;
    room.stopRequested = false;
    room.stopReason = '';
    if (room.stopTimer) {
      clearTimeout(room.stopTimer);
      room.stopTimer = null;
    }
    flushRoomTranscript(room, { force: true });
    broadcast(room, {
      type: 'speaker_stopped',
      reason: `upstream closed (${code}): ${reason}`,
    });
    broadcast(room, roomState(room));
  });

  upstream.on('error', (err) => {
    console.error('[team-live] upstream error:', err.message);
    send(participant.ws, { type: 'error', error: `Live API: ${err.message}` });
    if (room.upstream === upstream) stopSpeaker(room, `upstream error: ${err.message}`);
  });
}

function leaveCurrentRoom(client) {
  const participant = client.teamParticipant;
  if (!participant?.room) return;
  if (participant.ws !== client) return;

  const room = participant.room;
  if (room.activeSpeakerId === participant.id) {
    stopSpeaker(room, 'speaker left');
  }

  client.teamParticipant = null;

  participant.ws = null;
  if (participant.disconnectTimer) {
    clearTimeout(participant.disconnectTimer);
  }
  participant.disconnectTimer = setTimeout(() => {
    if (participant.ws) return;
    room.participants.delete(participant.id);
    participant.disconnectTimer = null;

    if (room.participants.size === 0) {
      if (room.upstream) {
        try {
          room.upstream.close();
        } catch {}
      }
      room.emptyRoomTimer = setTimeout(() => {
        if (room.participants.size === 0) {
          closeLiveRoomExport(room.exportId, new Date().toISOString());
          rooms.delete(room.id);
        }
        room.emptyRoomTimer = null;
      }, EMPTY_ROOM_TTL_MS);
      return;
    }

    broadcast(room, roomState(room));
  }, RECONNECT_GRACE_MS);
}

function attachTeamLive(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    if (pathname !== '/ws/team-live') return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (client, req) => {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const token = reqUrl.searchParams.get('token');
    client.isAlive = true;

    const heartbeat = setInterval(() => {
      if (client.readyState !== WebSocket.OPEN) {
        clearInterval(heartbeat);
        return;
      }
      if (!client.isAlive) {
        try {
          client.terminate();
        } catch {}
        clearInterval(heartbeat);
        return;
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch {}
    }, 30000);

    client.on('pong', () => {
      client.isAlive = true;
    });

    if (!token) {
      send(client, { type: 'error', error: 'Missing auth token' });
      client.close(4401, 'Missing auth token');
      clearInterval(heartbeat);
      return;
    }

    let user;
    try {
      const payload = verifyToken(token);
      user = findUserById(payload.sub);
    } catch {}

    if (!user) {
      send(client, { type: 'error', error: 'Invalid token' });
      client.close(4401, 'Invalid token');
      clearInterval(heartbeat);
      return;
    }

    let apiKey = '';
    try {
      apiKey = decrypt(user.apiKeyEnc || '');
    } catch {}

    client.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch {
        send(client, { type: 'error', error: 'Invalid message JSON' });
        return;
      }

      if (msg.type === 'create_room') {
        leaveCurrentRoom(client);
        const sourceLang = msg.sourceLang || 'en-US';
        const targetLang = msg.targetLang || 'vi-VN';
        if (sourceLang === targetLang) {
          send(client, { type: 'error', error: 'Hãy chọn hai ngôn ngữ khác nhau cho phòng.' });
          return;
        }
        const room = {
          id: makeRoomId(),
          exportId: crypto.randomUUID(),
          createdByUserId: user.id,
          createdByUsername: user.username,
          sourceLang,
          targetLang,
          model: msg.model || DEFAULT_MODEL,
          participants: new Map(),
          activeSpeakerId: null,
          upstream: null,
          stopTimer: null,
          stopRequested: false,
          stopReason: '',
          emptyRoomTimer: null,
          transcripts: [],
          turnSource: '',
          turnTarget: '',
          turnSourceLang: '',
          turnTargetLang: '',
          turnSpeakerId: null,
          turnSpeakerName: '',
        };
        rooms.set(room.id, room);
        createLiveRoomExport({
          id: room.exportId,
          roomCode: room.id,
          createdByUserId: room.createdByUserId,
          createdByUsername: room.createdByUsername,
          sourceLang: room.sourceLang,
          targetLang: room.targetLang,
          model: room.model,
          createdAt: new Date().toISOString(),
          closedAt: null,
          transcriptCount: 0,
        });
        joinRoom(client, user, room, apiKey);
        return;
      }

      if (msg.type === 'join_room') {
        const roomId = String(msg.roomId || '').trim().toUpperCase();
        const room = rooms.get(roomId);
        if (!room) {
          send(client, { type: 'error', error: 'Không tìm thấy phòng.' });
          return;
        }
        leaveCurrentRoom(client);
        joinRoom(client, user, room, apiKey);
        return;
      }

      const participant = client.teamParticipant;
      const room = participant?.room;
      if (!participant || !room) {
        send(client, { type: 'error', error: 'Bạn chưa ở trong phòng.' });
        return;
      }

      if (msg.type === 'speaker_start') {
        startSpeaker(room, participant);
        return;
      }

      if (msg.type === 'set_language') {
        const language = String(msg.language || '');
        if (language !== room.sourceLang && language !== room.targetLang) {
          send(client, { type: 'error', error: 'Ngôn ngữ không thuộc phòng này.' });
          return;
        }
        participant.language = language;
        broadcast(room, roomState(room));
        return;
      }

      if (msg.type === 'speaker_stop') {
        if (room.activeSpeakerId === participant.id) requestSpeakerStop(room, 'speaker stopped');
        return;
      }

      if (msg.type === 'audio') {
        if (room.activeSpeakerId !== participant.id) return;
        const payload = JSON.stringify({
          realtimeInput: {
            audio: {
              data: msg.data,
              mimeType: msg.mimeType || 'audio/pcm;rate=16000',
            },
          },
        });
        if (!room.upstream || room.upstream.readyState !== WebSocket.OPEN) return;
        room.upstream.send(payload);
      }
    });

    client.on('close', () => leaveCurrentRoom(client));
    client.on('error', (err) => {
      console.warn('[team-live] client error:', err.message);
      leaveCurrentRoom(client);
    });
    client.on('close', () => clearInterval(heartbeat));
  });

  return wss;
}

module.exports = { attachTeamLive };
