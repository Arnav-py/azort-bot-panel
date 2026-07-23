const { readJSON, verifyPassword, createSessionCookie } = require('../lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const users = readJSON('users.json') || [];
  const user = users.find(u => u.username.toLowerCase() === String(username).toLowerCase());

  // Same error for "no such user" and "wrong password" — don't leak which one it was.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const cookie = createSessionCookie('azort_session', { userId: user.id, role: 'client' });
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ ok: true });
};
