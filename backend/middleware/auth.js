const jwt = require("jsonwebtoken");
const { prisma } = require("../db");

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

// Confere no banco, a cada requisição, se a conta ainda existe e ainda é admin.
// Só olhar o JWT deixaria um admin removido/excluído com acesso por até 7 dias.
async function requireAdmin(req, res, next) {
  requireAuth(req, res, async () => {
    try {
      const current = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { isAdmin: true },
      });
      if (!current || !current.isAdmin) {
        return res.status(403).json({ error: "Acesso restrito ao administrador." });
      }
      next();
    } catch (err) {
      console.error("Erro ao validar admin:", err);
      res.status(500).json({ error: "Não foi possível validar o acesso." });
    }
  });
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
