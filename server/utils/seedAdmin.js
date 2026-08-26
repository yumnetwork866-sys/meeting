const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { findUserByUsername, createUser, updateUser } = require('./db');

// Ensure admin accounts configured in .env exist and have the admin role.
// ADMIN_USERNAME may contain a comma-separated list. ADMIN_PASSWORD is only a
// bootstrap password for accounts that do not exist yet.
async function ensureAdminUser() {
  const usernames = (process.env.ADMIN_USERNAME || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const password = process.env.ADMIN_PASSWORD || '';

  if (usernames.length === 0) {
    console.warn('[admin] ADMIN_USERNAME not set — no admin account configured.');
    return;
  }

  for (const username of usernames) {
    const existing = findUserByUsername(username);
    if (existing) {
      if (existing.role !== 'admin' || existing.approved === 0) {
        updateUser(existing.id, { role: 'admin', approved: 1 });
        console.log(`[admin] Promoted "${username}" to admin from ADMIN_USERNAME.`);
      }
      continue;
    }

    if (!password || password.length < 6) {
      console.warn(
        `[admin] Admin "${username}" does not exist and ADMIN_PASSWORD is missing/too short ` +
          '(>= 6 chars) — cannot seed. Set ADMIN_PASSWORD or create the account manually.'
      );
      continue;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    createUser({
      id: crypto.randomUUID(),
      username,
      passwordHash,
      createdAt: new Date().toISOString(),
      apiKeyEnc: '',
      model: '',
      role: 'admin',
      approved: 1,
    });
    console.log(`[admin] Seeded admin user "${username}".`);
  }
}

module.exports = { ensureAdminUser };
