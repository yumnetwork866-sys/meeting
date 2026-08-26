const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const {
  listAllUsers,
  countAllUsers,
  deleteUserById,
  createUser,
  updateUser,
  findUserByUsername,
  findUserById,
  findUserStatsForAdmin,
  countAdmins,
  listUserSessionsForAdmin,
  createAuditLog,
  listAuditLogs,
  getAppSettings,
  updateAppSettings,
  listLiveRoomExports,
  findLiveRoomExport,
  listLiveRoomTranscripts,
} = require('../utils/db');
const { requireAuth, requireAdmin, isAdminUser } = require('../utils/auth');

const router = express.Router();
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const ROLES = new Set(['admin', 'user']);
const USER_SORTS = new Set(['username', 'createdAt', 'lastActiveAt', 'sessionCount', 'transcriptCount', 'role']);

// Every /admin/* route requires a logged-in admin.
router.use('/admin', requireAuth, requireAdmin);

function publicUser(u) {
  const role = u.role === 'admin' ? 'admin' : 'user';
  return {
    id: u.id,
    username: u.username,
    createdAt: u.createdAt,
    model: u.model || '',
    hasApiKey: !!u.hasApiKey,
    sessionCount: u.sessionCount ?? 0,
    transcriptCount: u.transcriptCount ?? 0,
    lastActiveAt: u.lastActiveAt || null,
    mustChangePassword: !!u.mustChangePassword,
    approved: u.approved !== 0,
    isAdmin: role === 'admin',
    role,
  };
}

function userListParams(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.max(1, Math.min(Number(query.pageSize) || 10, 100));
  const sortBy = USER_SORTS.has(query.sortBy) ? query.sortBy : 'createdAt';
  const sortDir = String(query.sortDir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  const role = ROLES.has(query.role) ? query.role : undefined;
  const search = String(query.query || '').trim();
  return { page, pageSize, sortBy, sortDir, role, query: search };
}

function audit(req, action, target, details = '') {
  createAuditLog({
    id: crypto.randomUUID(),
    actorId: req.user.id,
    actorUsername: req.user.username,
    action,
    targetUserId: target?.id,
    targetUsername: target?.username,
    details,
    createdAt: new Date().toISOString(),
  });
}

// List all users with stats
router.get('/admin/users', (req, res) => {
  const params = userListParams(req.query);
  const total = countAllUsers(params);
  const users = listAllUsers({
    ...params,
    limit: params.pageSize,
    offset: (params.page - 1) * params.pageSize,
  }).map(publicUser);
  res.json({ users, total, page: params.page, pageSize: params.pageSize });
});

router.get('/admin/audit-logs', (req, res) => {
  res.json({ logs: listAuditLogs(req.query.limit).map((log) => ({ ...log, details: log.details || '' })) });
});

router.get('/admin/settings', (req, res) => {
  res.json({ settings: getAppSettings() });
});

router.patch('/admin/settings', (req, res) => {
  const patch = {};
  if (typeof req.body?.publicRegistrationEnabled === 'boolean') {
    patch.publicRegistrationEnabled = req.body.publicRegistrationEnabled;
  }
  if (typeof req.body?.requireAdminApproval === 'boolean') {
    patch.requireAdminApproval = req.body.requireAdminApproval;
  }
  const settings = updateAppSettings(patch);
  const changed = Object.entries(patch).map(([key, value]) => `${key}=${value}`).join('; ');
  if (changed) audit(req, 'update_settings', null, changed);
  res.json({ settings });
});

router.get('/admin/users/:id', (req, res) => {
  const target = findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy user.' });
  const stats = findUserStatsForAdmin(target.id) || target;
  return res.json({
    user: publicUser(stats),
    sessions: listUserSessionsForAdmin(target.id),
  });
});

router.get('/admin/live-rooms', (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const state = String(req.query.state || 'all').toLowerCase();
    return res.json({
      rooms: listLiveRoomExports(limit, state).map((room) => ({
        id: room.id,
        roomCode: room.roomCode,
        createdByUserId: room.createdByUserId || '',
        createdByUsername: room.createdByUsername || '',
        sourceLang: room.sourceLang,
        targetLang: room.targetLang,
        model: room.model,
        createdAt: room.createdAt,
        closedAt: room.closedAt || null,
        transcriptCount: room.transcriptCount || 0,
      })),
    });
  } catch (err) {
    console.error('list live rooms error:', err);
    return res.status(500).json({ error: err.message || 'Không đọc được danh sách phòng.' });
  }
});

router.get('/admin/live-rooms/:id', (req, res) => {
  try {
    const room = findLiveRoomExport(req.params.id);
    if (!room) return res.status(404).json({ error: 'Không tìm thấy phòng.' });
    return res.json({
      room: {
        id: room.id,
        roomCode: room.roomCode,
        createdByUserId: room.createdByUserId || '',
        createdByUsername: room.createdByUsername || '',
        sourceLang: room.sourceLang,
        targetLang: room.targetLang,
        model: room.model,
        createdAt: room.createdAt,
        closedAt: room.closedAt || null,
        transcriptCount: room.transcriptCount || 0,
      },
      transcripts: listLiveRoomTranscripts(room.id).map((item) => ({
        id: item.id,
        exportId: item.exportId,
        roomCode: item.roomCode,
        speakerId: item.speakerId || null,
        speakerName: item.speakerName || '',
        originalText: item.originalText,
        translatedText: item.translatedText,
        sourceLang: item.sourceLang,
        targetLang: item.targetLang,
        createdAt: item.createdAt,
      })),
    });
  } catch (err) {
    console.error('live room detail error:', err);
    return res.status(500).json({ error: err.message || 'Không đọc được transcript của phòng.' });
  }
});

// Create a new user
router.post('/admin/users', async (req, res) => {
  try {
    const { username, password, role = 'user', mustChangePassword = false } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Cần username và password.' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username 3–32 ký tự, chỉ chứa chữ/số/._-' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password tối thiểu 6 ký tự.' });
    }
    if (!ROLES.has(role)) {
      return res.status(400).json({ error: 'Vai trò không hợp lệ.' });
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
      role,
      mustChangePassword: mustChangePassword ? 1 : 0,
      approved: 1,
    };
    createUser(user);
    audit(req, 'create_user', user, `role=${role}${user.mustChangePassword ? '; must change password' : ''}`);
    return res.json({
      user: publicUser({ ...user, hasApiKey: 0, sessionCount: 0, transcriptCount: 0 }),
    });
  } catch (err) {
    console.error('admin create user error:', err);
    return res.status(500).json({ error: err.message || 'Tạo user thất bại.' });
  }
});

// Reset a user's password
router.post('/admin/users/:id/reset-password', async (req, res) => {
  try {
    const { password, mustChangePassword = false } = req.body || {};
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password tối thiểu 6 ký tự.' });
    }
    const target = findUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Không tìm thấy user.' });
    const passwordHash = await bcrypt.hash(password, 10);
    updateUser(target.id, { passwordHash, mustChangePassword: mustChangePassword ? 1 : 0 });
    audit(req, 'reset_password', target, mustChangePassword ? 'must change password' : '');
    return res.json({ ok: true });
  } catch (err) {
    console.error('admin reset-password error:', err);
    return res.status(500).json({ error: err.message || 'Đặt lại mật khẩu thất bại.' });
  }
});

router.patch('/admin/users/:id/role', (req, res) => {
  const { role } = req.body || {};
  if (!ROLES.has(role)) {
    return res.status(400).json({ error: 'Vai trò không hợp lệ.' });
  }
  const target = findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy user.' });
  if (target.id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'Không thể hạ quyền chính tài khoản của bạn.' });
  }
  if (target.role === 'admin' && role !== 'admin' && countAdmins() <= 1) {
    return res.status(400).json({ error: 'Không thể hạ quyền admin cuối cùng.' });
  }
  const updated = updateUser(target.id, { role });
  audit(req, 'change_role', updated, `${target.role || 'user'} -> ${role}`);
  return res.json({ user: publicUser(findUserStatsForAdmin(updated.id) || { ...updated, hasApiKey: !!updated.apiKeyEnc }) });
});

router.patch('/admin/users/:id/approval', (req, res) => {
  const { approved } = req.body || {};
  const nextApproved = approved === true || approved === 1;
  const target = findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy user.' });
  if (target.id === req.user.id && !nextApproved) {
    return res.status(400).json({ error: 'Không thể khoá chính tài khoản của bạn.' });
  }
  if (isAdminUser(target) && !nextApproved && countAdmins() <= 1) {
    return res.status(400).json({ error: 'Không thể khoá admin cuối cùng.' });
  }
  const updated = updateUser(target.id, { approved: nextApproved ? 1 : 0 });
  audit(req, nextApproved ? 'approve_user' : 'suspend_user', updated);
  return res.json({ user: publicUser(findUserStatsForAdmin(updated.id) || { ...updated, hasApiKey: !!updated.apiKeyEnc }) });
});

// Delete a user (cascades to their sessions/transcripts)
router.delete('/admin/users/:id', (req, res) => {
  const target = findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy user.' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'Không thể xoá chính tài khoản của bạn.' });
  }
  if (isAdminUser(target) && countAdmins() <= 1) {
    return res.status(400).json({ error: 'Không thể xoá admin cuối cùng.' });
  }
  deleteUserById(target.id);
  audit(req, 'delete_user', target);
  return res.json({ ok: true });
});

module.exports = router;
