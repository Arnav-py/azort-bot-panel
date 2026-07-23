const crypto = require('crypto');
const { readJSON, writeJSON, readSessionCookie } = require('../lib/store');
const { sendPowerSignal, getServerDetails } = require('../lib/pterodactyl');

const ACTIONS = new Set(['start', 'restart', 'stop', 'kill']);

function requireAdmin(req, res) {
  const session = readSessionCookie(req, 'azort_admin_session');
  if (!session || session.role !== 'admin') {
    res.status(401).json({ error: 'Not signed in.' });
    return null;
  }
  return session;
}

async function recordAudit(entry) {
  const audit = await readJSON('audit-log.json') || [];
  audit.unshift({ id: 'audit_' + crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), ...entry });
  await writeJSON('audit-log.json', audit.slice(0, 500));
}

function clientView(users, bots) {
  return users.map(user => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    suspended: Boolean(user.suspended),
    lastLogin: user.lastLogin || null,
    notes: user.adminNotes || '',
    dismissedAnnouncements: user.dismissedAnnouncements || [],
    bots: bots.filter(bot => bot.userId === user.id),
  }));
}

module.exports = async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;

  const users = await readJSON('users.json') || [];
  const bots = await readJSON('bots.json') || [];
  const announcements = await readJSON('announcements.json') || [];
  const settings = await readJSON('admin-settings.json') || { maintenanceMode: false };

  if (req.method === 'GET') {
    const audit = await readJSON('audit-log.json') || [];
    const enrichedBots = await Promise.all(bots.map(async bot => {
      try { return { ...bot, details: await getServerDetails(bot.serverId) }; }
      catch { return { ...bot, details: null }; }
    }));
    const liveDetails = enrichedBots.map(bot => bot.details).filter(Boolean);
    const avgCpu = liveDetails.length ? liveDetails.reduce((total, item) => total + Number(item.cpuUsed || 0), 0) / liveDetails.length : null;
    const memoryUsed = liveDetails.reduce((total, item) => total + Number(item.memoryUsed || 0), 0);
    return res.status(200).json({
      clients: clientView(users, enrichedBots),
      announcements: announcements.filter(item => item.active !== false),
      settings,
      audit: audit.slice(0, 100),
      summary: {
        clients: users.length,
        servers: bots.length,
        online: bots.filter(bot => bot.status === 'online').length,
        expiring: bots.filter(bot => bot.expiresAt && new Date(bot.expiresAt) <= new Date(Date.now() + 30 * 86400000)).length,
        avgCpu,
        memoryUsed,
      },
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};

  if (body.action === 'announcement-create') {
    if (!body.title || !body.message) return res.status(400).json({ error: 'Title and message are required.' });
    const announcement = {
      id: 'announcement_' + crypto.randomBytes(5).toString('hex'),
      title: String(body.title).trim(), message: String(body.message).trim(),
      tone: ['info', 'success', 'warning', 'critical'].includes(body.tone) ? body.tone : 'info',
      active: true, createdAt: new Date().toISOString(), createdBy: session.username || 'admin',
    };
    announcements.unshift(announcement);
    await writeJSON('announcements.json', announcements.slice(0, 100));
    await recordAudit({ actor: session.adminId || 'admin', action: 'announcement-created', target: announcement.title });
    return res.status(201).json({ ok: true, announcement });
  }

  if (body.action === 'announcement-delete') {
    const index = announcements.findIndex(item => item.id === body.id);
    if (index === -1) return res.status(404).json({ error: 'Announcement not found.' });
    const [removed] = announcements.splice(index, 1);
    await writeJSON('announcements.json', announcements);
    await recordAudit({ actor: session.adminId || 'admin', action: 'announcement-deleted', target: removed.title });
    return res.status(200).json({ ok: true });
  }

  if (body.action === 'maintenance') {
    settings.maintenanceMode = Boolean(body.enabled);
    settings.maintenanceMessage = String(body.message || settings.maintenanceMessage || 'Maintenance is in progress.');
    await writeJSON('admin-settings.json', settings);
    await recordAudit({ actor: session.adminId || 'admin', action: settings.maintenanceMode ? 'maintenance-enabled' : 'maintenance-disabled', target: settings.maintenanceMessage });
    return res.status(200).json({ ok: true, settings });
  }

  if (body.action === 'bulk-assign') {
    const user = users.find(item => item.id === body.userId);
    if (!user || !body.name || !body.serverId) return res.status(400).json({ error: 'Client, server name, and server ID are required.' });
    const bot = { id: 'b_' + crypto.randomBytes(5).toString('hex'), userId: user.id, name: String(body.name).trim(), serverId: String(body.serverId).trim(), plan: body.plan || 'Standard', expiresAt: body.expiresAt || null, cpuLimit: Number(body.cpuLimit) || 100, memLimit: Number(body.memLimit) || 512, status: 'offline', lastAction: null, adminNote: '' };
    bots.push(bot);
    await writeJSON('bots.json', bots);
    await recordAudit({ actor: session.adminId || 'admin', action: 'server-assigned', target: `${bot.name} -> ${user.username}` });
    return res.status(201).json({ ok: true, bot });
  }

  if (body.action === 'bulk-remove') {
    const ids = Array.isArray(body.botIds) ? body.botIds : [];
    const removed = bots.filter(bot => ids.includes(bot.id));
    if (!removed.length) return res.status(400).json({ error: 'Select at least one server.' });
    const remaining = bots.filter(bot => !ids.includes(bot.id));
    await writeJSON('bots.json', remaining);
    await recordAudit({ actor: session.adminId || 'admin', action: 'servers-removed', target: `${removed.length} server(s)` });
    return res.status(200).json({ ok: true, removed: removed.length });
  }

  if (body.action === 'server-action') {
    if (!ACTIONS.has(body.power) || !body.botId) return res.status(400).json({ error: 'Invalid server action.' });
    const bot = bots.find(item => item.id === body.botId);
    if (!bot) return res.status(404).json({ error: 'Server not found.' });
    try { await sendPowerSignal(bot.serverId, body.power); } catch { return res.status(502).json({ error: 'Could not reach Orihost.' }); }
    bot.status = body.power === 'stop' || body.power === 'kill' ? 'offline' : 'restarting';
    bot.lastAction = `${body.power[0].toUpperCase() + body.power.slice(1)} — ${new Date().toISOString()}`;
    await writeJSON('bots.json', bots);
    await recordAudit({ actor: session.adminId || 'admin', action: `server-${body.power}`, target: bot.name });
    return res.status(200).json({ ok: true });
  }

  if (body.action === 'client-note') {
    const user = users.find(item => item.id === body.userId);
    if (!user) return res.status(404).json({ error: 'Client not found.' });
    user.adminNotes = String(body.note || '').trim().slice(0, 2000);
    await writeJSON('users.json', users);
    await recordAudit({ actor: session.adminId || 'admin', action: 'client-note-updated', target: user.username });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unsupported action.' });
};