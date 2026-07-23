const { readJSON, writeJSON, readSessionCookie, checkCooldown, setCooldown } = require('../lib/store');
const { sendPowerSignal } = require('../lib/pterodactyl');

const ALLOWED_ACTIONS = { restart: 'restart', stop: 'stop' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = readSessionCookie(req, 'azort_session');
  if (!session || session.role !== 'client') return res.status(401).json({ error: 'Not signed in.' });

  const { botId, action } = req.body || {};
  const signal = ALLOWED_ACTIONS[action];
  if (!botId || !signal) return res.status(400).json({ error: 'Invalid request.' });

  const bots = await readJSON('bots.json') || [];
  const bot = bots.find(b => b.id === botId);

  // CRITICAL AUTHORIZATION CHECK:
  // The bot must exist AND belong to the currently authenticated session's
  // userId. botId comes from the client, but ownership is verified against
  // server-side data every single time - never trust a serverId/botId
  // pairing supplied directly by the browser.
  if (!bot || bot.userId !== session.userId) {
    return res.status(403).json({ error: 'You do not have access to this bot.' });
  }

  // Rate limit per user+bot so one laggy bot can't get someone spam-clicking
  // and tripping Pterodactyl's own rate limits.
  const cooldownKey = `${session.userId}:${bot.id}`;
  const cd = checkCooldown(cooldownKey);
  if (cd.onCooldown) {
    return res.status(429).json({ error: 'Action on cooldown.', retryAfter: `${cd.retryAfter}s` });
  }

  try {
    await sendPowerSignal(bot.serverId, signal);
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach Orihost. Try again shortly.' });
  }

  setCooldown(cooldownKey);

  // Update last-action record (see note in lib/store.js re: persistent storage on Vercel)
  bot.lastAction = `${action === 'restart' ? 'Restart' : 'Stop'} — ${new Date().toISOString()}`;
  bot.status = action === 'restart' ? 'restarting' : 'offline';
  await writeJSON('bots.json', bots);

  return res.status(200).json({ ok: true });
};
