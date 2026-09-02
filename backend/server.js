require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const hpp = require("hpp");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const { prisma } = require("./db");
const { trackVisit } = require("./middleware/visitTracker");

const authRoutes = require("./routes/auth");
const productRoutes = require("./routes/products");
const orderRoutes = require("./routes/orders");
const adminRoutes = require("./routes/admin");
const webhookRoutes = require("./routes/webhooks");

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.disable("x-powered-by");

// ---------- Segurança ----------

// Cabeçalhos de segurança HTTP. CSP liberado para inline script/style porque
// o frontend é HTML/JS simples sem bundler; imagens liberadas de qualquer
// origem https (logo, fotos de produto, QR code em base64).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(hpp());

// CORS: em produção só aceita o próprio domínio do site; em desenvolvimento
// libera geral para facilitar o teste local.
app.use(
  cors({
    origin: isProd ? process.env.APP_URL || false : true,
    credentials: true,
  })
);

// Guarda o corpo bruto da requisição (necessário para validar a assinatura
// do webhook do Stripe) enquanto ainda faz o parse normal em JSON para o resto da API.
app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(cookieParser());

// Limite geral de requisições por IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

// Limite mais rígido nas rotas de autenticação, para dificultar força bruta
// de login e criação em massa de contas.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
});
app.use("/api/auth", authLimiter);

// Registro de visitas só nas páginas do site (não em chamadas de API)
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return trackVisit(req, res, next);
  next();
});

// Arquivos estáticos do site
app.use(express.static(path.join(__dirname, "public")));

// Atalhos de URL sem ".html" (ex: /admin -> /admin.html)
const friendlyRoutes = {
  "/admin": "/admin.html",
  "/produtos": "/produtos.html",
  "/produto": "/produto.html",
  "/suporte": "/suporte.html",
  "/login": "/login.html",
  "/registro": "/registro.html",
  "/minha-conta": "/minha-conta.html",
};
Object.entries(friendlyRoutes).forEach(([from, to]) => {
  app.get(from, (req, res) => {
    const queryIndex = req.originalUrl.indexOf("?");
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
    res.redirect(to + query);
  });
});

// Rotas de API
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/webhooks", webhookRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Configurações públicas (links de suporte, aviso do site) — editáveis pelo admin
app.get("/api/config", async (req, res) => {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    res.json({
      discordUrl: (settings && settings.discordUrl) || process.env.SUPPORT_DISCORD_URL || "",
      whatsappUrl: (settings && settings.whatsappUrl) || process.env.SUPPORT_WHATSAPP_URL || "",
      contactEmail: (settings && settings.contactEmail) || "",
      announcement: (settings && settings.announcement) || "",
    });
  } catch (err) {
    res.json({
      discordUrl: process.env.SUPPORT_DISCORD_URL || "",
      whatsappUrl: process.env.SUPPORT_WHATSAPP_URL || "",
      contactEmail: "",
      announcement: "",
    });
  }
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"), (err) => {
    if (err) res.status(404).json({ error: "Não encontrado." });
  });
});

async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return;

  const bcrypt = require("bcryptjs");
  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      name: process.env.ADMIN_NAME || "Admin",
      email,
      password: hashed,
      isAdmin: true,
    },
  });
  console.log(`Conta admin criada: ${email}`);
}

async function start() {
  try {
    await ensureAdmin();
  } catch (err) {
    console.error("Não foi possível garantir a conta admin:", err.message);
  }

  app.listen(PORT, () => {
    console.log(`NULLBANKER rodando na porta ${PORT}`);
  });
}

start();
