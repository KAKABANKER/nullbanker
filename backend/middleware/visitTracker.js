const { prisma } = require("../db");

// User-agents de bots, monitores de uptime e crawlers (não contam como visita).
const BOT_PATTERNS = [
  /uptime/i, /pingdom/i, /statuscake/i, /freshping/i, /site24x7/i, /cron-job/i,
  /monitor/i, /health ?check/i, /render/i, /bot/i, /spider/i, /crawl/i, /slurp/i,
  /curl/i, /wget/i, /python-requests/i, /axios/i, /go-http-client/i, /node-fetch/i,
  /headless/i, /preview/i,
];

function isLikelyBot(userAgent) {
  if (!userAgent) return true;
  return BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

// Só conta abertura de PÁGINA (a home ou um .html). Atalhos sem extensão
// (/produtos, /login etc.) redirecionam para o .html correspondente — contar
// os dois dobraria a visita real, então só o .html é contabilizado.
function isPageView(req) {
  if (req.method !== "GET") return false;
  const p = req.path;
  if (p.startsWith("/api")) return false;
  if (p === "/admin.html" || p === "/admin") return false; // o próprio painel não conta
  if (p === "/") return true;
  if (p.endsWith(".html")) return true;
  return false;
}

// Mesmo visitante na mesma página em até 30 min = 1 visita só (F5 não infla).
const DEDUPE_MS = 30 * 60 * 1000;
const recent = new Map();

function alreadyCounted(key) {
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < DEDUPE_MS) return true;
  recent.set(key, now);
  if (recent.size > 5000) {
    for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
  }
  return false;
}

function trackVisit(req, res, next) {
  const userAgent = req.headers["user-agent"] || "";
  if (!isPageView(req) || isLikelyBot(userAgent)) return next();

  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "";
  const path = req.path.slice(0, 200);
  if (alreadyCounted(`${ip}|${path}`)) return next();

  prisma.visit
    .create({ data: { path, ip: ip.slice(0, 64), userAgent: userAgent.slice(0, 300) } })
    .catch(() => {
      /* log de visita nunca derruba a requisição */
    });

  next();
}

module.exports = { trackVisit };
