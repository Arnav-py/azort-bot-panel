const { clearSessionCookie } = require('../lib/store');

module.exports = async (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie('azort_session'));
  return res.status(200).json({ ok: true });
};
