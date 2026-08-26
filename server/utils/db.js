const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const LEGACY_JSON = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
	  CREATE TABLE IF NOT EXISTS users (
	    id           TEXT PRIMARY KEY,
	    username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
	    passwordHash TEXT NOT NULL,
	    createdAt    TEXT NOT NULL,
	    apiKeyEnc    TEXT NOT NULL DEFAULT '',
	    model        TEXT NOT NULL DEFAULT '',
	    role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
	    mustChangePassword INTEGER NOT NULL DEFAULT 0,
	    approved     INTEGER NOT NULL DEFAULT 1
	  );

  CREATE TABLE IF NOT EXISTS sessions (
    id        TEXT PRIMARY KEY,
    userId    TEXT NOT NULL,
    title     TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId, updatedAt DESC);

  CREATE TABLE IF NOT EXISTS transcripts (
    id             TEXT PRIMARY KEY,
    sessionId      TEXT NOT NULL,
    userId         TEXT NOT NULL,
    originalText   TEXT NOT NULL,
    translatedText TEXT NOT NULL,
    sourceLang     TEXT NOT NULL,
    targetLang     TEXT NOT NULL,
    createdAt      TEXT NOT NULL,
    FOREIGN KEY (sessionId) REFERENCES sessions(id) ON DELETE CASCADE
	  );
	  CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(sessionId, createdAt DESC);

  CREATE TABLE IF NOT EXISTS live_room_exports (
    id              TEXT PRIMARY KEY,
    roomCode        TEXT NOT NULL,
    createdByUserId TEXT NOT NULL,
    createdByUsername TEXT NOT NULL,
    sourceLang      TEXT NOT NULL,
    targetLang      TEXT NOT NULL,
    model           TEXT NOT NULL,
    createdAt       TEXT NOT NULL,
    closedAt        TEXT,
    transcriptCount INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_live_room_exports_roomCode ON live_room_exports(roomCode, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_live_room_exports_closedAt ON live_room_exports(closedAt DESC, createdAt DESC);

  CREATE TABLE IF NOT EXISTS live_room_transcripts (
    id             TEXT PRIMARY KEY,
    exportId       TEXT NOT NULL,
    roomCode       TEXT NOT NULL,
    speakerId      TEXT,
    speakerName    TEXT,
    originalText   TEXT NOT NULL,
    translatedText TEXT NOT NULL,
    sourceLang     TEXT NOT NULL,
    targetLang     TEXT NOT NULL,
    createdAt      TEXT NOT NULL,
    FOREIGN KEY (exportId) REFERENCES live_room_exports(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_live_room_transcripts_export ON live_room_transcripts(exportId, createdAt DESC);

	  CREATE TABLE IF NOT EXISTS audit_logs (
	    id             TEXT PRIMARY KEY,
	    actorId        TEXT NOT NULL,
	    actorUsername  TEXT NOT NULL,
	    action         TEXT NOT NULL,
	    targetUserId   TEXT,
	    targetUsername TEXT,
	    details        TEXT NOT NULL DEFAULT '',
	    createdAt      TEXT NOT NULL
	  );
	  CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(createdAt DESC);

	  CREATE TABLE IF NOT EXISTS app_settings (
	    key       TEXT PRIMARY KEY,
	    value     TEXT NOT NULL,
	    updatedAt TEXT NOT NULL
	  );
	`);

const userCols = db.prepare('PRAGMA table_info(users)').all().map((col) => col.name);
if (!userCols.includes('role')) {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'))");
}
if (!userCols.includes('mustChangePassword')) {
  db.exec('ALTER TABLE users ADD COLUMN mustChangePassword INTEGER NOT NULL DEFAULT 0');
}
if (!userCols.includes('approved')) {
  db.exec('ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1');
}

const liveRoomExportCols = db.prepare('PRAGMA table_info(live_room_exports)').all().map((col) => col.name);
if (!liveRoomExportCols.includes('createdByUserId')) {
  db.exec('ALTER TABLE live_room_exports ADD COLUMN createdByUserId TEXT NOT NULL DEFAULT ""');
}
if (!liveRoomExportCols.includes('createdByUsername')) {
  db.exec('ALTER TABLE live_room_exports ADD COLUMN createdByUsername TEXT NOT NULL DEFAULT ""');
}
if (!liveRoomExportCols.includes('sourceLang')) {
  db.exec('ALTER TABLE live_room_exports ADD COLUMN sourceLang TEXT NOT NULL DEFAULT "en-US"');
}
if (!liveRoomExportCols.includes('targetLang')) {
  db.exec('ALTER TABLE live_room_exports ADD COLUMN targetLang TEXT NOT NULL DEFAULT "vi-VN"');
}
if (!liveRoomExportCols.includes('model')) {
  db.exec('ALTER TABLE live_room_exports ADD COLUMN model TEXT NOT NULL DEFAULT ""');
}
if (!liveRoomExportCols.includes('createdAt')) {
  db.exec('ALTER TABLE live_room_exports ADD COLUMN createdAt TEXT NOT NULL DEFAULT ""');
}
if (!liveRoomExportCols.includes('closedAt')) {
  db.exec('ALTER TABLE live_room_exports ADD COLUMN closedAt TEXT');
}
if (!liveRoomExportCols.includes('transcriptCount')) {
  db.exec('ALTER TABLE live_room_exports ADD COLUMN transcriptCount INTEGER NOT NULL DEFAULT 0');
}

const liveRoomTranscriptCols = db.prepare('PRAGMA table_info(live_room_transcripts)').all().map((col) => col.name);
if (!liveRoomTranscriptCols.includes('speakerId')) {
  db.exec('ALTER TABLE live_room_transcripts ADD COLUMN speakerId TEXT');
}
if (!liveRoomTranscriptCols.includes('speakerName')) {
  db.exec('ALTER TABLE live_room_transcripts ADD COLUMN speakerName TEXT');
}

// One-time migration from legacy users.json (if present)
(function migrateLegacyJson() {
  if (!fs.existsSync(LEGACY_JSON)) return;
  try {
    const raw = fs.readFileSync(LEGACY_JSON, 'utf8');
    const parsed = JSON.parse(raw);
    const users = Array.isArray(parsed?.users) ? parsed.users : [];
    if (users.length === 0) {
      fs.renameSync(LEGACY_JSON, LEGACY_JSON + '.migrated');
      return;
    }
    const insert = db.prepare(`
      INSERT OR IGNORE INTO users (id, username, passwordHash, createdAt, apiKeyEnc, model, role, mustChangePassword, approved)
      VALUES (@id, @username, @passwordHash, @createdAt, @apiKeyEnc, @model, @role, @mustChangePassword, @approved)
    `);
    const tx = db.transaction((rows) => {
      for (const u of rows) {
        insert.run({
          id: u.id,
          username: u.username,
          passwordHash: u.passwordHash,
          createdAt: u.createdAt || new Date().toISOString(),
          apiKeyEnc: u.apiKeyEnc || '',
          model: u.model || '',
          role: u.role === 'admin' ? 'admin' : 'user',
          mustChangePassword: u.mustChangePassword ? 1 : 0,
          approved: u.approved === 0 ? 0 : 1,
        });
      }
    });
    tx(users);
    fs.renameSync(LEGACY_JSON, LEGACY_JSON + '.migrated');
    console.log(`[db] Migrated ${users.length} user(s) from users.json -> SQLite`);
  } catch (err) {
    console.warn('[db] Legacy JSON migration skipped:', err.message);
  }
})();

const findByUsernameStmt = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
const findByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const insertStmt = db.prepare(`
  INSERT INTO users (id, username, passwordHash, createdAt, apiKeyEnc, model, role, mustChangePassword, approved)
  VALUES (@id, @username, @passwordHash, @createdAt, @apiKeyEnc, @model, @role, @mustChangePassword, @approved)
`);

function findUserByUsername(username) {
  return findByUsernameStmt.get(username);
}

function findUserById(id) {
  return findByIdStmt.get(id);
}

function createUser(user) {
  insertStmt.run({
    id: user.id,
    username: user.username,
    passwordHash: user.passwordHash,
    createdAt: user.createdAt,
    apiKeyEnc: user.apiKeyEnc || '',
    model: user.model || '',
    role: user.role === 'admin' ? 'admin' : 'user',
    mustChangePassword: user.mustChangePassword ? 1 : 0,
    approved: user.approved === 0 ? 0 : 1,
  });
}

const ALLOWED_PATCH_COLS = new Set(['username', 'passwordHash', 'apiKeyEnc', 'model', 'role', 'mustChangePassword', 'approved']);

function updateUser(id, patch) {
  const cols = Object.keys(patch).filter((k) => ALLOWED_PATCH_COLS.has(k));
  if (cols.length === 0) return findUserById(id);
  const setSql = cols.map((c) => `${c} = @${c}`).join(', ');
  const params = { id };
  for (const c of cols) params[c] = patch[c];
  const stmt = db.prepare(`UPDATE users SET ${setSql} WHERE id = @id`);
  const result = stmt.run(params);
  if (result.changes === 0) return null;
  return findUserById(id);
}

// ---- Admin: user management ----
const USER_SORTS = {
  username: 'username',
  createdAt: 'createdAt',
  lastActiveAt: 'lastActiveAt',
  sessionCount: 'sessionCount',
  transcriptCount: 'transcriptCount',
  role: 'role',
};
const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?');
const countAdminsStmt = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND approved <> 0");
const userStatsSelect = `
  SELECT u.id, u.username, u.createdAt, u.model, u.role, u.mustChangePassword, u.approved,
         (CASE WHEN u.apiKeyEnc <> '' THEN 1 ELSE 0 END) AS hasApiKey,
         (SELECT COUNT(*) FROM sessions s WHERE s.userId = u.id) AS sessionCount,
         (SELECT COUNT(*) FROM transcripts t WHERE t.userId = u.id) AS transcriptCount,
         (SELECT MAX(s.updatedAt) FROM sessions s WHERE s.userId = u.id) AS lastActiveAt
  FROM users u
`;
const findUserStatsForAdminStmt = db.prepare(`${userStatsSelect} WHERE u.id = ?`);
const listUserSessionsForAdminStmt = db.prepare(`
  SELECT s.id, s.title, s.createdAt, s.updatedAt,
         (SELECT COUNT(*) FROM transcripts t WHERE t.sessionId = s.id) AS transcriptCount
  FROM sessions s
  WHERE s.userId = ?
  ORDER BY s.updatedAt DESC
  LIMIT 50
`);
const insertAuditLogStmt = db.prepare(`
  INSERT INTO audit_logs (id, actorId, actorUsername, action, targetUserId, targetUsername, details, createdAt)
  VALUES (@id, @actorId, @actorUsername, @action, @targetUserId, @targetUsername, @details, @createdAt)
`);
const listAuditLogsStmt = db.prepare(`
  SELECT id, actorId, actorUsername, action, targetUserId, targetUsername, details, createdAt
  FROM audit_logs
  ORDER BY createdAt DESC
  LIMIT ?
`);

function userWhere(params, out) {
  const where = [];
  if (params.query) {
    where.push('u.username LIKE @query COLLATE NOCASE');
    out.query = `%${params.query}%`;
  }
  if (params.role === 'admin' || params.role === 'user') {
    where.push('u.role = @role');
    out.role = params.role;
  }
  return where.length ? ` WHERE ${where.join(' AND ')}` : '';
}

function listAllUsers(options = {}) {
  const params = {};
  const whereSql = userWhere(options, params);
  const sortBy = USER_SORTS[options.sortBy] || 'createdAt';
  const sortDir = String(options.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const hasPaging = Number.isFinite(Number(options.limit)) && Number.isFinite(Number(options.offset));
  let sql = `${userStatsSelect}${whereSql} ORDER BY ${sortBy} ${sortDir}, username ASC`;
  if (hasPaging) {
    sql += ' LIMIT @limit OFFSET @offset';
    params.limit = Math.max(1, Math.min(Number(options.limit), 100));
    params.offset = Math.max(0, Number(options.offset));
  }
  return db.prepare(sql).all(params);
}
function countAllUsers(options = {}) {
  const params = {};
  const whereSql = userWhere(options, params);
  return db.prepare(`SELECT COUNT(*) AS count FROM users u${whereSql}`).get(params).count;
}
function findUserStatsForAdmin(id) {
  return findUserStatsForAdminStmt.get(id);
}
function deleteUserById(id) {
  // sessions/transcripts cascade via ON DELETE CASCADE (foreign_keys = ON)
  return deleteUserStmt.run(id).changes > 0;
}
function countAdmins() {
  return countAdminsStmt.get().count;
}
function listUserSessionsForAdmin(userId) {
  return listUserSessionsForAdminStmt.all(userId);
}
function createAuditLog(log) {
  insertAuditLogStmt.run({
    id: log.id,
    actorId: log.actorId,
    actorUsername: log.actorUsername,
    action: log.action,
    targetUserId: log.targetUserId || null,
    targetUsername: log.targetUsername || null,
    details: log.details || '',
    createdAt: log.createdAt,
  });
}
function listAuditLogs(limit = 50) {
  return listAuditLogsStmt.all(Math.max(1, Math.min(Number(limit) || 50, 100)));
}

// ---- App settings ----
const DEFAULT_APP_SETTINGS = {
  publicRegistrationEnabled: true,
  requireAdminApproval: true,
};
const getSettingStmt = db.prepare('SELECT value FROM app_settings WHERE key = ?');
const upsertSettingStmt = db.prepare(`
  INSERT INTO app_settings (key, value, updatedAt)
  VALUES (@key, @value, @updatedAt)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
`);

function boolSetting(key) {
  const row = getSettingStmt.get(key);
  if (!row) return DEFAULT_APP_SETTINGS[key];
  return row.value === 'true';
}

function getAppSettings() {
  return {
    publicRegistrationEnabled: boolSetting('publicRegistrationEnabled'),
    requireAdminApproval: boolSetting('requireAdminApproval'),
  };
}

function updateAppSettings(patch = {}) {
  const allowed = Object.keys(DEFAULT_APP_SETTINGS);
  const now = new Date().toISOString();
  const tx = db.transaction((entries) => {
    for (const key of entries) {
      upsertSettingStmt.run({ key, value: String(!!patch[key]), updatedAt: now });
    }
  });
  tx(allowed.filter((key) => typeof patch[key] === 'boolean'));
  return getAppSettings();
}

// ---- Sessions ----
const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (id, userId, title, createdAt, updatedAt)
  VALUES (@id, @userId, @title, @createdAt, @updatedAt)
`);
const listSessionsStmt = db.prepare(`
  SELECT s.id, s.title, s.createdAt, s.updatedAt,
         (SELECT COUNT(*) FROM transcripts t WHERE t.sessionId = s.id) AS count
  FROM sessions s
  WHERE s.userId = ?
  ORDER BY s.updatedAt DESC
`);
const findSessionStmt = db.prepare('SELECT * FROM sessions WHERE id = ? AND userId = ?');
const renameSessionStmt = db.prepare(
  'UPDATE sessions SET title = @title, updatedAt = @updatedAt WHERE id = @id AND userId = @userId'
);
const touchSessionStmt = db.prepare('UPDATE sessions SET updatedAt = @updatedAt WHERE id = @id');
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE id = ? AND userId = ?');

function createSession(session) {
  insertSessionStmt.run(session);
}
function listSessions(userId) {
  return listSessionsStmt.all(userId);
}
function findSession(userId, id) {
  return findSessionStmt.get(id, userId);
}
function renameSession(userId, id, title) {
  const res = renameSessionStmt.run({ id, userId, title, updatedAt: new Date().toISOString() });
  return res.changes > 0;
}
function touchSession(id) {
  touchSessionStmt.run({ id, updatedAt: new Date().toISOString() });
}
function deleteSession(userId, id) {
  const res = deleteSessionStmt.run(id, userId);
  return res.changes > 0;
}

// ---- Transcripts ----
const insertTranscriptStmt = db.prepare(`
  INSERT INTO transcripts (id, sessionId, userId, originalText, translatedText, sourceLang, targetLang, createdAt)
  VALUES (@id, @sessionId, @userId, @originalText, @translatedText, @sourceLang, @targetLang, @createdAt)
`);
const listTranscriptsStmt = db.prepare(
  'SELECT * FROM transcripts WHERE sessionId = ? ORDER BY createdAt DESC'
);
const deleteTranscriptStmt = db.prepare('DELETE FROM transcripts WHERE id = ? AND userId = ?');
const clearTranscriptsStmt = db.prepare('DELETE FROM transcripts WHERE sessionId = ? AND userId = ?');

const insertLiveRoomExportStmt = db.prepare(`
  INSERT INTO live_room_exports (id, roomCode, createdByUserId, createdByUsername, sourceLang, targetLang, model, createdAt, closedAt, transcriptCount)
  VALUES (@id, @roomCode, @createdByUserId, @createdByUsername, @sourceLang, @targetLang, @model, @createdAt, @closedAt, @transcriptCount)
`);
const updateLiveRoomExportStmt = db.prepare(`
  UPDATE live_room_exports
  SET roomCode = @roomCode,
      createdByUserId = @createdByUserId,
      createdByUsername = @createdByUsername,
      sourceLang = @sourceLang,
      targetLang = @targetLang,
      model = @model,
      createdAt = @createdAt,
      closedAt = @closedAt,
      transcriptCount = @transcriptCount
  WHERE id = @id
`);
const findLiveRoomExportStmt = db.prepare('SELECT * FROM live_room_exports WHERE id = ?');
const listLiveRoomExportsStmt = db.prepare(`
  SELECT e.*,
         (SELECT COUNT(*) FROM live_room_transcripts t WHERE t.exportId = e.id) AS transcriptCount
  FROM live_room_exports e
  ORDER BY COALESCE(e.closedAt, e.createdAt) DESC, e.createdAt DESC
  LIMIT ?
`);
const listLiveRoomExportsByRoomCodeStmt = db.prepare(`
  SELECT e.*,
         (SELECT COUNT(*) FROM live_room_transcripts t WHERE t.exportId = e.id) AS transcriptCount
  FROM live_room_exports e
  WHERE e.roomCode = ?
  ORDER BY COALESCE(e.closedAt, e.createdAt) DESC, e.createdAt DESC
`);
const listLiveRoomExportsByStateStmt = db.prepare(`
  SELECT e.*,
         (SELECT COUNT(*) FROM live_room_transcripts t WHERE t.exportId = e.id) AS transcriptCount
  FROM live_room_exports e
  WHERE (? = 'open' AND e.closedAt IS NULL)
     OR (? = 'closed' AND e.closedAt IS NOT NULL)
     OR (? = 'all')
  ORDER BY COALESCE(e.closedAt, e.createdAt) DESC, e.createdAt DESC
  LIMIT ?
`);
const findLiveRoomExportByUserAndRoomCodeStmt = db.prepare(`
  SELECT e.*,
         (SELECT COUNT(*) FROM live_room_transcripts t WHERE t.exportId = e.id) AS transcriptCount
  FROM live_room_exports e
  WHERE e.createdByUserId = ? AND e.roomCode = ?
  ORDER BY COALESCE(e.closedAt, e.createdAt) DESC, e.createdAt DESC
  LIMIT 1
`);
const insertLiveRoomTranscriptStmt = db.prepare(`
  INSERT INTO live_room_transcripts (id, exportId, roomCode, speakerId, speakerName, originalText, translatedText, sourceLang, targetLang, createdAt)
  VALUES (@id, @exportId, @roomCode, @speakerId, @speakerName, @originalText, @translatedText, @sourceLang, @targetLang, @createdAt)
`);
const listLiveRoomTranscriptsStmt = db.prepare(`
  SELECT * FROM live_room_transcripts WHERE exportId = ? ORDER BY createdAt ASC
`);
const countLiveRoomTranscriptsStmt = db.prepare(`
  SELECT COUNT(*) AS count FROM live_room_transcripts WHERE exportId = ?
`);
const closeLiveRoomExportStmt = db.prepare(`
  UPDATE live_room_exports SET closedAt = @closedAt WHERE id = @id
`);
const deleteLiveRoomExportStmt = db.prepare(`
  DELETE FROM live_room_exports WHERE id = ?
`);

function insertTranscript(row) {
  insertTranscriptStmt.run(row);
}
function listTranscripts(sessionId) {
  return listTranscriptsStmt.all(sessionId);
}
function deleteTranscript(userId, id) {
  const res = deleteTranscriptStmt.run(id, userId);
  return res.changes > 0;
}
function clearTranscripts(userId, sessionId) {
  clearTranscriptsStmt.run(sessionId, userId);
}

function createLiveRoomExport(room) {
  insertLiveRoomExportStmt.run({
    id: room.id,
    roomCode: room.roomCode,
    createdByUserId: room.createdByUserId,
    createdByUsername: room.createdByUsername,
    sourceLang: room.sourceLang,
    targetLang: room.targetLang,
    model: room.model,
    createdAt: room.createdAt,
    closedAt: room.closedAt || null,
    transcriptCount: room.transcriptCount || 0,
  });
}

function updateLiveRoomExport(id, patch) {
  const current = findLiveRoomExport(id);
  if (!current) return null;
  updateLiveRoomExportStmt.run({
    id,
    roomCode: patch.roomCode ?? current.roomCode,
    createdByUserId: patch.createdByUserId ?? current.createdByUserId,
    createdByUsername: patch.createdByUsername ?? current.createdByUsername,
    sourceLang: patch.sourceLang ?? current.sourceLang,
    targetLang: patch.targetLang ?? current.targetLang,
    model: patch.model ?? current.model,
    createdAt: patch.createdAt ?? current.createdAt,
    closedAt: patch.closedAt ?? current.closedAt ?? null,
    transcriptCount: patch.transcriptCount ?? current.transcriptCount ?? 0,
  });
  return findLiveRoomExport(id);
}

function findLiveRoomExport(id) {
  return findLiveRoomExportStmt.get(id);
}

function listLiveRoomExports(limit = 50, state = 'all') {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const safeState = state === 'open' || state === 'closed' ? state : 'all';
  return listLiveRoomExportsByStateStmt.all(safeState, safeState, safeState, safeLimit);
}

function listLiveRoomExportsForRoom(roomCode) {
  return listLiveRoomExportsByRoomCodeStmt.all(roomCode);
}

function listLiveRoomExportsForUser(userId, options = {}) {
  const {
    limit = 50,
    state = 'closed',
    lang = '',
  } = options || {};
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const safeState = state === 'open' || state === 'closed' ? state : state === 'all' ? 'all' : 'closed';
  const conditions = ['e.createdByUserId = ?'];
  const params = [userId];

  if (safeState !== 'all') {
    conditions.push(safeState === 'open' ? 'e.closedAt IS NULL' : 'e.closedAt IS NOT NULL');
  }

  if (lang) {
    conditions.push('(e.sourceLang = ? OR e.targetLang = ?)');
    params.push(lang, lang);
  }

  params.push(safeLimit);
  const sql = `
    SELECT e.*,
           (SELECT COUNT(*) FROM live_room_transcripts t WHERE t.exportId = e.id) AS transcriptCount
    FROM live_room_exports e
    WHERE ${conditions.join(' AND ')}
    ORDER BY COALESCE(e.closedAt, e.createdAt) DESC, e.createdAt DESC
    LIMIT ?
  `;
  return db.prepare(sql).all(...params);
}

function findLiveRoomExportForUserAndRoomCode(userId, roomCode) {
  return findLiveRoomExportByUserAndRoomCodeStmt.get(userId, roomCode);
}

function insertLiveRoomTranscript(row) {
  insertLiveRoomTranscriptStmt.run(row);
}

function listLiveRoomTranscripts(exportId) {
  return listLiveRoomTranscriptsStmt.all(exportId);
}

function closeLiveRoomExport(id, closedAt = new Date().toISOString()) {
  const res = closeLiveRoomExportStmt.run({ id, closedAt });
  return res.changes > 0 ? findLiveRoomExport(id) : null;
}

function deleteLiveRoomExport(id) {
  const res = deleteLiveRoomExportStmt.run(id);
  return res.changes > 0;
}

function countLiveRoomTranscripts(exportId) {
  return countLiveRoomTranscriptsStmt.get(exportId).count;
}

module.exports = {
  findUserByUsername,
  findUserById,
  createUser,
  updateUser,
  listAllUsers,
  countAllUsers,
  findUserStatsForAdmin,
  deleteUserById,
  countAdmins,
  listUserSessionsForAdmin,
  createAuditLog,
  listAuditLogs,
  getAppSettings,
  updateAppSettings,
  createSession,
  listSessions,
  findSession,
  renameSession,
  touchSession,
  deleteSession,
  insertTranscript,
  listTranscripts,
  deleteTranscript,
  clearTranscripts,
  createLiveRoomExport,
  updateLiveRoomExport,
  findLiveRoomExport,
  findLiveRoomExportForUserAndRoomCode,
  listLiveRoomExports,
  listLiveRoomExportsForRoom,
  listLiveRoomExportsForUser,
  insertLiveRoomTranscript,
  listLiveRoomTranscripts,
  closeLiveRoomExport,
  deleteLiveRoomExport,
  countLiveRoomTranscripts,
  _db: db,
};
