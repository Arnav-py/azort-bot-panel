const { readJSON, verifyPassword, createSessionCookie } = require('../lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const admins = await readJSON('admins.json') || [];
  const admin = admins.find(a => a.username.toLowerCase() === String(username).toLowerCase());

  if (!admin || !verifyPassword(password, admin.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const cookie = createSessionCookie('azort_admin_session', { adminId: admin.id, role: 'admin' }, 60 * 60 * 4);
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ ok: true });
};
