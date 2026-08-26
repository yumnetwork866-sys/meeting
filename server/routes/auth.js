const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { findUserByUsername, findUserById, createUser, updateUser, getAppSettings } = require('../utils/db');
const { signToken, requireAuth, isAdminUser } = require('../utils/auth');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function publicAuthUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role || 'user',
    isAdmin: isAdminUser(user),
    mustChangePassword: !!user.mustChangePassword,
    approved: user.approved !== 0,
  };
}

router.post('/auth/register', async (req, res) => {
  try {
    const settings = getAppSettings();
    if (!settings.publicRegistrationEnabled) {
      return res.status(403).json({ error: 'Đăng ký công khai đang tắt. Vui lòng liên hệ admin.' });
    }
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Cần username và password.' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username 3–32 ký tự, chỉ chứa chữ/số/._-' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password tối thiểu 6 ký tự.' });
    }
    if (findUserByUsername(username)) {
      return res.status(409).json({ error: 'Username đã tồn tại.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: crypto.randomUUID(),
      username,
      passwordHash,
      createdAt: new Date().toISOString(),
      apiKeyEnc: '',
      model: '',
      role: 'user',
      mustChangePassword: 0,
      approved: settings.requireAdminApproval ? 0 : 1,
    };
    createUser(user);
    if (!settings.requireAdminApproval) {
      const token = signToken(user);
      return res.json({ token, user: publicAuthUser({ ...user, approved: 1 }) });
    }
    return res.json({
      ok: true,
      pendingApproval: true,
      message: 'Tài khoản đã được tạo. Vui lòng chờ admin duyệt trước khi đăng nhập.',
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: err.message || 'Đăng ký thất bại.' });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Cần username và password.' });
    }
    const user = findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Username hoặc password không đúng.' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Username hoặc password không đúng.' });
    }
    if (user.approved === 0) {
      return res.status(403).json({ error: 'Tài khoản đang chờ admin duyệt.' });
    }
    const token = signToken(user);
    return res.json({ token, user: publicAuthUser(user) });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: err.message || 'Đăng nhập thất bại.' });
  }
});

// TODO: tạm thời cho phép đổi mật khẩu chỉ bằng username (chưa xác thực).
// Cần bổ sung xác minh danh tính (email/câu hỏi bảo mật) sau.
router.post('/auth/reset-password', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Cần username và mật khẩu mới.' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password tối thiểu 6 ký tự.' });
    }
    const user = findUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'Username không tồn tại.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    updateUser(user.id, { passwordHash, mustChangePassword: 0 });
    return res.json({ ok: true });
  } catch (err) {
    console.error('reset-password error:', err);
    return res.status(500).json({ error: err.message || 'Đặt lại mật khẩu thất bại.' });
  }
});

router.get('/auth/me', requireAuth, (req, res) => {
  const u = findUserById(req.user.id);
  if (!u) return res.status(404).json({ error: 'Không tìm thấy user.' });
  return res.json({ user: publicAuthUser(u) });
});

router.post('/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password tối thiểu 6 ký tự.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = updateUser(req.user.id, { passwordHash, mustChangePassword: 0 });
    return res.json({ user: publicAuthUser(user) });
  } catch (err) {
    console.error('change-password error:', err);
    return res.status(500).json({ error: err.message || 'Đổi mật khẩu thất bại.' });
  }
});

module.exports = router;
