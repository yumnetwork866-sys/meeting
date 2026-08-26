const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../utils/auth');
const dbu = require('../utils/db');

const router = express.Router();

const newId = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

// List all sessions for the current user (with transcript counts)
router.get('/sessions', requireAuth, (req, res) => {
  try {
    return res.json({ sessions: dbu.listSessions(req.user.id) });
  } catch (err) {
    console.error('list sessions error:', err);
    return res.status(500).json({ error: err.message || 'Không đọc được danh sách phiên.' });
  }
});

// Create a new session
router.post('/sessions', requireAuth, (req, res) => {
  try {
    const now = new Date().toISOString();
    const title = (req.body?.title || '').toString().trim() || 'Phiên mới';
    const session = { id: newId('sess'), userId: req.user.id, title, createdAt: now, updatedAt: now };
    dbu.createSession(session);
    return res.json({ session: { ...session, count: 0 } });
  } catch (err) {
    console.error('create session error:', err);
    return res.status(500).json({ error: err.message || 'Không tạo được phiên.' });
  }
});

// Rename a session
router.patch('/sessions/:id', requireAuth, (req, res) => {
  try {
    const title = (req.body?.title || '').toString().trim();
    if (!title) return res.status(400).json({ error: 'Tiêu đề không được để trống.' });
    const ok = dbu.renameSession(req.user.id, req.params.id, title);
    if (!ok) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('rename session error:', err);
    return res.status(500).json({ error: err.message || 'Không đổi được tên phiên.' });
  }
});

// Delete a session (cascades to its transcripts)
router.delete('/sessions/:id', requireAuth, (req, res) => {
  try {
    const ok = dbu.deleteSession(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('delete session error:', err);
    return res.status(500).json({ error: err.message || 'Không xoá được phiên.' });
  }
});

// List transcripts of a session
router.get('/sessions/:id/transcripts', requireAuth, (req, res) => {
  try {
    if (!dbu.findSession(req.user.id, req.params.id)) {
      return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    }
    return res.json({ transcripts: dbu.listTranscripts(req.params.id) });
  } catch (err) {
    console.error('list transcripts error:', err);
    return res.status(500).json({ error: err.message || 'Không đọc được transcript.' });
  }
});

// Add a transcript to a session
router.post('/sessions/:id/transcripts', requireAuth, (req, res) => {
  try {
    if (!dbu.findSession(req.user.id, req.params.id)) {
      return res.status(404).json({ error: 'Không tìm thấy phiên.' });
    }
    const b = req.body || {};
    const item = {
      id: newId('card'),
      sessionId: req.params.id,
      userId: req.user.id,
      originalText: (b.originalText || '').toString(),
      translatedText: (b.translatedText || '').toString(),
      sourceLang: (b.sourceLang || '').toString(),
      targetLang: (b.targetLang || '').toString(),
      createdAt: new Date().toISOString(),
    };
    dbu.insertTranscript(item);
    dbu.touchSession(req.params.id);
    return res.json({ transcript: item });
  } catch (err) {
    console.error('add transcript error:', err);
    return res.status(500).json({ error: err.message || 'Không lưu được transcript.' });
  }
});

// Clear all transcripts of a session (keeps the session)
router.delete('/sessions/:id/transcripts', requireAuth, (req, res) => {
  try {
    dbu.clearTranscripts(req.user.id, req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('clear transcripts error:', err);
    return res.status(500).json({ error: err.message || 'Không xoá được transcript.' });
  }
});

// Delete a single transcript
router.delete('/sessions/:id/transcripts/:tid', requireAuth, (req, res) => {
  try {
    dbu.deleteTranscript(req.user.id, req.params.tid);
    return res.json({ ok: true });
  } catch (err) {
    console.error('delete transcript error:', err);
    return res.status(500).json({ error: err.message || 'Không xoá được transcript.' });
  }
});

module.exports = router;
