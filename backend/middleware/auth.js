const jwt = require("jsonwebtoken");

function getTokenFromReq(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Sessão inválida ou expirada." });
  }
}

function optionalAuth(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) return next();
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    // segue sem usuário
  }
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: "Acesso restrito ao administrador." });
    }
    next();
  });
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
