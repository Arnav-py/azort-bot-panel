const crypto = require('crypto');
const {
  readJSON, writeJSON, readSessionCookie,
  hashPassword, genTempPassword,
} = require('../lib/store');

async function recordAudit(action, target) {
  const audit = await readJSON('audit-log.json') || [];
  audit.unshift({ id: 'audit_' + crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), actor: 'admin', action, target });
  await writeJSON('audit-log.json', audit.slice(0, 500));
}

function requireAdmin(req, res) {
  const session = readSessionCookie(req, 'azort_admin_session');
  if (!session || session.role !== 'admin') {
    res.status(401).json({ error: 'Not signed in.' });
    return null;
  }
  return session;
}

module.exports = async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const users = await readJSON('users.json') || [];
  const bots = await readJSON('bots.json') || [];

  if (req.method === 'GET') {
    const clients = users.map(u => {
      const clientBots = bots.filter(b => b.userId === u.id);
      const firstBot = clientBots[0];
      return {
        id: u.id,
        username: u.username,
        bots: clientBots,
        botName: firstBot?.name || '—',
        serverId: firstBot?.serverId || '—',
        expiresAt: firstBot?.expiresAt || null,
        status: firstBot?.status === 'suspended' ? 'expired' : (u.suspended ? 'expired' : 'active'),
        lastLogin: u.lastLogin || null,
      };
    });
    return res.status(200).json({ clients });
  }

  if (req.method === 'POST') {
    const { username, bots: submittedBots, botName, serverId, expiresAt, tempPassword } = req.body || {};
    const clientBots = Array.isArray(submittedBots) ? submittedBots : [{ name: botName, serverId, expiresAt }];
    if (!username || !clientBots.length || clientBots.some(bot => !bot?.name || !bot?.serverId)) {
      return res.status(400).json({ error: 'Username and at least one bot with a name and server ID are required.' });
    }
    if (users.some(u => u.username.toLowerCase() === String(username).toLowerCase())) {
      return res.status(409).json({ error: 'That username is already in use.' });
    }

    const plainPass = tempPassword || genTempPassword();
    const userId = 'u_' + crypto.randomBytes(5).toString('hex');
    users.push({
      id: userId,
      username,
      passwordHash: hashPassword(plainPass),
      displayName: username,
    });
    clientBots.forEach(bot => bots.push({
      id: 'b_' + crypto.randomBytes(5).toString('hex'), userId, name: bot.name,
      serverId: bot.serverId, plan: bot.plan || 'Standard', expiresAt: bot.expiresAt || null,
      cpuLimit: bot.cpuLimit || 100, memLimit: bot.memLimit || 512,
      status: 'offline', lastAction: null,
    }));

    await writeJSON('users.json', users);
    await writeJSON('bots.json', bots);
    await recordAudit('client-created', username);

    return res.status(201).json({ ok: true, tempPassword: plainPass });
  }

  if (req.method === 'PUT') {
    const { id, bots: submittedBots, botName, serverId, expiresAt, status } = req.body || {};
    const user = users.find(u => u.id === id);
    if (!user) return res.status(404).json({ error: 'Client not found.' });

    const clientBots = Array.isArray(submittedBots) ? submittedBots : [{ name: botName, serverId, expiresAt }];
    if (!clientBots.length || clientBots.some(bot => !bot?.name || !bot?.serverId)) {
      return res.status(400).json({ error: 'At least one bot with a name and server ID is required.' });
    }
    const existingBots = bots.filter(bot => bot.userId === id);
    const replacementBots = clientBots.map(bot => {
      const existingBot = bot.id ? existingBots.find(candidate => candidate.id === bot.id) : null;
      return ({
        ...(existingBot || {}),
        id: bot.id || 'b_' + crypto.randomBytes(5).toString('hex'),
        userId: id, name: bot.name, serverId: bot.serverId,
        plan: bot.plan || existingBot?.plan || 'Standard',
        expiresAt: bot.expiresAt || null,
        cpuLimit: bot.cpuLimit || existingBot?.cpuLimit || 100,
        memLimit: bot.memLimit || existingBot?.memLimit || 512,
        status: existingBot?.status || 'offline',
        lastAction: existingBot?.lastAction || null,
      });
    });
    const remainingBots = bots.filter(bot => bot.userId !== id);
    bots.length = 0;
    bots.push(...remainingBots, ...replacementBots);
    user.suspended = status === 'expired';

    await writeJSON('users.json', users);
    await writeJSON('bots.json', bots);
    await recordAudit('client-updated', user.username);

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
    await recordAudit('password-reset', user.username);

    return res.status(200).json({ ok: true, tempPassword: plainPass });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
