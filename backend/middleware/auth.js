const jwt = require("jsonwebtoken");
const { prisma } = require("../db");

function getTokenFromReq(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

// Valida o token E confere no banco se a conta ainda existe e não foi banida.
// (Só olhar o JWT deixaria uma conta banida/removida com acesso por até 7 dias.)
async function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) return res.status(401).json({ error: "Não autenticado." });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Sessão inválida ou expirada." });
  }

  try {
    const current = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, name: true, email: true, isAdmin: true, isBanned: true },
    });
    if (!current) return res.status(401).json({ error: "Sessão inválida ou expirada." });
    if (current.isBanned) {
      return res.status(403).json({ error: "Conta suspensa. Fale com o suporte." });
    }
    req.user = { id: current.id, name: current.name, email: current.email, isAdmin: current.isAdmin };
    next();
  } catch (err) {
    console.error("Erro ao validar sessão:", err);
    res.status(500).json({ error: "Não foi possível validar a sessão." });
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

// requireAuth já traz isAdmin direto do banco, então um admin removido perde o acesso na hora.
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: "Acesso restrito ao administrador." });
    }
    next();
  });
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
