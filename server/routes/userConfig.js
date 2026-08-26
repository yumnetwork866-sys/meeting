const express = require('express');
const { findUserById, updateUser } = require('../utils/db');
const { requireAuth } = require('../utils/auth');
const { encrypt, decrypt } = require('../utils/crypto');

const router = express.Router();

router.get('/user/config', requireAuth, (req, res) => {
  try {
    const u = findUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'Không tìm thấy user.' });
    let apiKey = '';
    try {
      apiKey = decrypt(u.apiKeyEnc || '');
    } catch {
      apiKey = '';
    }
    return res.json({
      apiKey,
      model: u.model || '',
    });
  } catch (err) {
    console.error('get config error:', err);
    return res.status(500).json({ error: err.message || 'Không đọc được cấu hình.' });
  }
});

router.put('/user/config', requireAuth, (req, res) => {
  try {
    const { apiKey, model } = req.body || {};
    const patch = {};
    if (typeof apiKey === 'string') {
      patch.apiKeyEnc = apiKey ? encrypt(apiKey.trim()) : '';
    }
    if (typeof model === 'string') {
      patch.model = model.trim();
    }
    const updated = updateUser(req.user.id, patch);
    if (!updated) return res.status(404).json({ error: 'Không tìm thấy user.' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('put config error:', err);
    return res.status(500).json({ error: err.message || 'Không lưu được cấu hình.' });
  }
});

module.exports = router;
