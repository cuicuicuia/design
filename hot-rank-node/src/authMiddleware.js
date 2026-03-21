const { verifyAccessToken } = require('./auth');

function getBearerToken(req) {
  const raw = req.headers && req.headers.authorization;
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ code: 401, msg: 'Unauthorized', data: null });
  }
  try {
    const decoded = verifyAccessToken(token);
    req.auth = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ code: 401, msg: 'Unauthorized', data: null });
  }
}

function optionalAuth(req, _res, next) {
  const token = getBearerToken(req);
  if (!token) return next();
  try {
    const decoded = verifyAccessToken(token);
    req.auth = decoded;
  } catch (_) {
    // ignore invalid token
  }
  return next();
}

module.exports = { requireAuth, optionalAuth, getBearerToken };

