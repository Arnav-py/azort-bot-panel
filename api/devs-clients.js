const crypto = require('crypto');
const {
  readJSON, writeJSON, readSessionCookie,
  hashPassword, genTempPassword,
} = require('../lib/store');

function requireAdmin(req, res) {
  const session = readSessionCookie(req, 'azort_admin_session');
  if (!session || session.role !== 'admin') {
    res.status(401).json({ error: 'Not signed in.' });
    return null;
  }
  return session;
}

// NOTE: this endpoint models "one client = one user + one primary bot" for
// simplicity, matching the add/edit form in the devs dashboard. If a client
// ever needs more than one bot, extend the bots.json filter below rather
// than changing this shape - a user can already own multiple entries in
// bots.json.

module.exports = async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const users = await readJSON('users.json') || [];
  const bots = await readJSON('bots.json') || [];

  if (req.method === 'GET') {
    const clients = users.map(u => {
      const bot = bots.find(b => b.userId === u.id);
      return {
        id: u.id,
        username: u.username,
        botName: bot?.name || '—',
        serverId: bot?.serverId || '—',
        expiresAt: bot?.expiresAt || null,
        status: bot?.status === 'suspended' ? 'expired' : (u.suspended ? 'expired' : 'active'),
        lastLogin: u.lastLogin || null,
      };
    });
    return res.status(200).json({ clients });
  }

  if (req.method === 'POST') {
    const { username, botName, serverId, expiresAt, tempPassword } = req.body || {};
    if (!username || !botName || !serverId) {
      return res.status(400).json({ error: 'Username, bot name, and server ID are required.' });
    }
    if (users.some(u => u.username.toLowerCase() === String(username).toLowerCase())) {
      return res.status(409).json({ error: 'That username is already in use.' });
    }

    const plainPass = tempPassword || genTempPassword();
    const userId = 'u_' + crypto.randomBytes(5).toString('hex');
    const botId = 'b_' + crypto.randomBytes(5).toString('hex');

    users.push({
      id: userId,
      username,
      passwordHash: hashPassword(plainPass),
      displayName: username,
    });
    bots.push({
      id: botId,
      userId,
      name: botName,
      serverId,
      plan: 'Standard',
      expiresAt: expiresAt || null,
      cpuLimit: 100,
      memLimit: 512,
      status: 'offline',
      lastAction: null,
    });

    await writeJSON('users.json', users);
    await writeJSON('bots.json', bots);

    return res.status(201).json({ ok: true, tempPassword: plainPass });
  }

  if (req.method === 'PUT') {
    const { id, botName, serverId, expiresAt, status } = req.body || {};
    const user = users.find(u => u.id === id);
    if (!user) return res.status(404).json({ error: 'Client not found.' });

    const bot = bots.find(b => b.userId === id);
    if (bot) {
      if (botName) bot.name = botName;
      if (serverId) bot.serverId = serverId;
      bot.expiresAt = expiresAt || null;
    }
    user.suspended = status === 'expired';

    await writeJSON('users.json', users);
    await writeJSON('bots.json', bots);

    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const { id, action } = req.body || {};
    if (action !== 'reset-password') return res.status(400).json({ error: 'Unsupported action.' });

    const user = users.find(u => u.id === id);
    if (!user) return res.status(404).json({ error: 'Client not found.' });

    const plainPass = genTempPassword();
    user.passwordHash = hashPassword(plainPass);
    await writeJSON('users.json', users);

    return res.status(200).json({ ok: true, tempPassword: plainPass });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
