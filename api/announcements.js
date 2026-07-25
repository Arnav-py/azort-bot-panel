const { readJSON, writeJSON, readSessionCookie } = require('../lib/store');

module.exports = async (req, res) => {
  const session = readSessionCookie(req, 'azort_session');
  if (!session || session.role !== 'client') return res.status(401).json({ error: 'Not signed in.' });
  const users = await readJSON('users.json') || [];
  const user = users.find(item => item.id === session.userId);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  const announcements = await readJSON('announcements.json') || [];
  const settings = await readJSON('admin-settings.json') || { maintenanceMode: false };

  if (req.method === 'GET') {
    const dismissed = user.dismissedAnnouncements || [];
    return res.status(200).json({
      announcements: announcements.filter(item => item.active !== false && !dismissed.includes(item.id)),
      maintenance: settings,
    });
  }
  if (req.method === 'POST') {
    if (!req.body?.id || !announcements.some(item => item.id === req.body.id)) return res.status(400).json({ error: 'Invalid announcement.' });
    user.dismissedAnnouncements = [...new Set([...(user.dismissedAnnouncements || []), req.body.id])];
    await writeJSON('users.json', users);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
};
