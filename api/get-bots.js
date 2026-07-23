const { readJSON, readSessionCookie } = require('../lib/store');
const { getServerStatus } = require('../lib/pterodactyl');

module.exports = async (req, res) => {
  const session = readSessionCookie(req, 'azort_session');
  if (!session || session.role !== 'client') return res.status(401).json({ error: 'Not signed in.' });

  const users = await readJSON('users.json') || [];
  const user = users.find(u => u.id === session.userId);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });

  const allBots = await readJSON('bots.json') || [];

  // CRITICAL: filter server-side by session userId. Never trust a userId or
  // serverId supplied by the client for this lookup — this is the boundary
  // that stops client A from ever seeing or touching client B's bot.
  const myBots = allBots.filter(b => b.userId === user.id);

  // Refresh live status from Pterodactyl (in production, consider caching
  // this with a short TTL so you're not hitting Pterodactyl on every page
  // load from every user - see conversation notes on polling).
  const enriched = await Promise.all(myBots.map(async (bot) => {
    let status = bot.status;
    try {
      status = await getServerStatus(bot.serverId);
    } catch {
      // fall back to last known status rather than erroring the whole dashboard
    }
    return { ...bot, status };
  }));

  return res.status(200).json({
    user: { username: user.username, displayName: user.displayName },
    bots: enriched,
  });
};
