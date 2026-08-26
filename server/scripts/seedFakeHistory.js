const crypto = require('crypto');
const { _db } = require('../utils/db');

const users = _db.prepare('SELECT id, username FROM users ORDER BY createdAt ASC').all();

const deleteExistingStmt = _db.prepare(
  'DELETE FROM live_room_exports WHERE createdByUserId = ? AND roomCode = ?'
);

const insertExportStmt = _db.prepare(`
  INSERT INTO live_room_exports (
    id, roomCode, createdByUserId, createdByUsername, sourceLang, targetLang, model, createdAt, closedAt, transcriptCount
  ) VALUES (
    @id, @roomCode, @createdByUserId, @createdByUsername, @sourceLang, @targetLang, @model, @createdAt, @closedAt, @transcriptCount
  )
`);

const insertTranscriptStmt = _db.prepare(`
  INSERT INTO live_room_transcripts (
    id, exportId, roomCode, speakerId, speakerName, originalText, translatedText, sourceLang, targetLang, createdAt
  ) VALUES (
    @id, @exportId, @roomCode, @speakerId, @speakerName, @originalText, @translatedText, @sourceLang, @targetLang, @createdAt
  )
`);

function iso(minutesFromNow) {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

function seedForUser(user, index) {
  const roomCode = `DEMO-${user.username.toUpperCase()}`;

  deleteExistingStmt.run(user.id, roomCode);

  const exportId = crypto.randomUUID();
  const createdAt = iso(-120 - index * 10);
  const closedAt = iso(-95 - index * 10);

  const segments = [
    {
      speakerName: user.username,
      originalText: 'Good morning everyone. Can you hear me clearly?',
      translatedText: 'Chào buổi sáng mọi người. Nghe rõ mình không?',
      sourceLang: 'en-US',
      targetLang: 'vi-VN',
    },
    {
      speakerName: 'Interpreter',
      originalText: 'Vâng, âm thanh rất rõ.',
      translatedText: 'Yes, the audio is clear.',
      sourceLang: 'vi-VN',
      targetLang: 'en-US',
    },
    {
      speakerName: user.username,
      originalText: 'Let us review the product timeline and the launch checklist.',
      translatedText: 'Hãy cùng xem lại timeline sản phẩm và checklist ra mắt.',
      sourceLang: 'en-US',
      targetLang: 'vi-VN',
    },
    {
      speakerName: 'Interpreter',
      originalText: 'Chúng ta nên chốt mockup UI trước thứ Sáu.',
      translatedText: 'We should finalize the UI mockups by Friday.',
      sourceLang: 'vi-VN',
      targetLang: 'en-US',
    },
  ];

  const room = {
    id: exportId,
    roomCode,
    createdByUserId: user.id,
    createdByUsername: user.username,
    sourceLang: 'en-US',
    targetLang: 'vi-VN',
    model: 'gemini-3.5-live-translate-preview',
    createdAt,
    closedAt,
    transcriptCount: segments.length,
  };

  insertExportStmt.run(room);

  const baseMinutes = -110 - index * 10;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    insertTranscriptStmt.run({
      id: crypto.randomUUID(),
      exportId,
      roomCode,
      speakerId: null,
      speakerName: segment.speakerName,
      originalText: segment.originalText,
      translatedText: segment.translatedText,
      sourceLang: segment.sourceLang,
      targetLang: segment.targetLang,
      createdAt: iso(baseMinutes + i * 3),
    });
  }
}

if (users.length === 0) {
  console.log('[seed-history] No user accounts found.');
  process.exit(0);
}

const tx = _db.transaction(() => {
  users.forEach(seedForUser);
});

tx();

console.log(`[seed-history] Seeded ${users.length} fake history room(s).`);