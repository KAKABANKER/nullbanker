const { prisma } = require("../db");

// Registra visitas às páginas públicas (não às chamadas de API/admin) sem travar a resposta.
function trackVisit(req, res, next) {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "";
  const userAgent = req.headers["user-agent"] || "";
  const path = req.path;

  prisma.visit
    .create({ data: { path, ip, userAgent } })
    .catch(() => {
      /* não deixa a falha de log derrubar a request */
    });

  next();
}

module.exports = { trackVisit };
