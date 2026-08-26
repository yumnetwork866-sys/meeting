const express = require('express');
const { requireAuth } = require('../utils/auth');
const {
  listLiveRoomExportsForRoom,
  listLiveRoomExportsForUser,
  findLiveRoomExportForUserAndRoomCode,
  listLiveRoomTranscripts,
  findLiveRoomExport,
  deleteLiveRoomExport,
} = require('../utils/db');

const router = express.Router();

router.get('/team-live/rooms/:roomCode', requireAuth, (req, res) => {
  try {
    const roomCode = String(req.params.roomCode || '').trim().toUpperCase();
    if (!roomCode) {
      return res.status(400).json({ error: 'Mã phòng không hợp lệ.' });
    }

    const rooms = listLiveRoomExportsForRoom(roomCode);
    if (!rooms.length) {
      return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    }

    const room = rooms[0];
    return res.json({
      roomCode: room.roomCode,
      open: !room.closedAt,
      closedAt: room.closedAt || null,
      createdAt: room.createdAt,
    });
  } catch (err) {
    console.error('team room status error:', err);
    return res.status(500).json({ error: err.message || 'Không đọc được trạng thái phòng.' });
  }
});

router.get('/team-live/history', requireAuth, (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const state = String(req.query.state || 'closed').toLowerCase();
    const lang = String(req.query.lang || '').trim();
    const rooms = listLiveRoomExportsForUser(req.user.id, {
      limit,
      state,
      lang,
    });
    return res.json({
      rooms: rooms.map((room) => ({
        id: room.id,
        roomCode: room.roomCode,
        sourceLang: room.sourceLang,
        targetLang: room.targetLang,
        model: room.model,
        createdAt: room.createdAt,
        closedAt: room.closedAt || null,
        transcriptCount: room.transcriptCount || 0,
      })),
    });
  } catch (err) {
    console.error('team history error:', err);
    return res.status(500).json({ error: err.message || 'Không đọc được lịch sử hội thoại.' });
  }
});

router.get('/team-live/history/:roomCode', requireAuth, (req, res) => {
  try {
    const roomCode = String(req.params.roomCode || '').trim().toUpperCase();
    if (!roomCode) {
      return res.status(400).json({ error: 'Mã phòng không hợp lệ.' });
    }

    const room = findLiveRoomExportForUserAndRoomCode(req.user.id, roomCode);
    if (!room) {
      return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    }
    return res.json({
      room: {
        id: room.id,
        roomCode: room.roomCode,
        sourceLang: room.sourceLang,
        targetLang: room.targetLang,
        model: room.model,
        createdAt: room.createdAt,
        closedAt: room.closedAt || null,
        transcriptCount: room.transcriptCount || 0,
      },
      transcripts: listLiveRoomTranscripts(room.id),
    });
  } catch (err) {
    console.error('team history detail error:', err);
    return res.status(500).json({ error: err.message || 'Không đọc được nội dung hội thoại.' });
  }
});

router.delete('/team-live/history/export/:id', requireAuth, (req, res) => {
  try {
    const exportId = String(req.params.id || '').trim();
    if (!exportId) {
      return res.status(400).json({ error: 'Mã hội thoại không hợp lệ.' });
    }

    const room = findLiveRoomExport(exportId);
    if (!room || room.createdByUserId !== req.user.id) {
      return res.status(404).json({ error: 'Không tìm thấy hội thoại.' });
    }

    const deleted = deleteLiveRoomExport(exportId);
    if (!deleted) {
      return res.status(404).json({ error: 'Không tìm thấy hội thoại.' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('team history delete error:', err);
    return res.status(500).json({ error: err.message || 'Không xóa được hội thoại.' });
  }
});

module.exports = router;
