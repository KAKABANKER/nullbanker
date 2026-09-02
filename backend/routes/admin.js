const express = require("express");
const { prisma } = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.use(requireAdmin);

// GET /api/admin/stats -> números gerais para o topo do dashboard
router.get("/stats", async (req, res) => {
  try {
    const [totalVisits, totalOrders, paidOrders, revenueAgg, totalProducts, totalUsers] =
      await Promise.all([
        prisma.visit.count(),
        prisma.order.count(),
        prisma.order.count({ where: { status: "paid" } }),
        prisma.order.aggregate({ where: { status: "paid" }, _sum: { amount: true } }),
        prisma.product.count(),
        prisma.user.count(),
      ]);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentVisits = await prisma.visit.count({ where: { createdAt: { gte: since } } });

    res.json({
      totalVisits,
      recentVisits,
      totalOrders,
      paidOrders,
      revenue: revenueAgg._sum.amount || 0,
      totalProducts,
      totalUsers,
    });
  } catch (err) {
    console.error("Erro ao carregar estatísticas:", err);
    res.status(500).json({ error: "Não foi possível carregar as estatísticas." });
  }
});

// GET /api/admin/orders -> lista de pedidos (com filtro opcional de status)
router.get("/orders", async (req, res) => {
  try {
    const { status } = req.query;
    const orders = await prisma.order.findMany({
      where: status ? { status } : {},
      include: { product: true, user: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ orders });
  } catch (err) {
    console.error("Erro ao listar pedidos (admin):", err);
    res.status(500).json({ error: "Não foi possível carregar os pedidos." });
  }
});

// PUT /api/admin/orders/:id -> atualizar status manualmente
router.put("/orders/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const order = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { status },
    });
    res.json({ order });
  } catch (err) {
    console.error("Erro ao atualizar pedido:", err);
    res.status(500).json({ error: "Não foi possível atualizar o pedido." });
  }
});

// GET /api/admin/visits -> últimas visitas registradas
router.get("/visits", async (req, res) => {
  try {
    const visits = await prisma.visit.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ visits });
  } catch (err) {
    console.error("Erro ao listar visitas:", err);
    res.status(500).json({ error: "Não foi possível carregar as visitas." });
  }
});

// GET /api/admin/webhooks -> log bruto recebido dos gateways de pagamento
router.get("/webhooks", async (req, res) => {
  try {
    const webhooks = await prisma.webhookLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ webhooks });
  } catch (err) {
    console.error("Erro ao listar webhooks:", err);
    res.status(500).json({ error: "Não foi possível carregar os webhooks." });
  }
});

// GET /api/admin/users -> lista de usuários cadastrados, com contagem de pedidos
router.get("/users", async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isAdmin: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ users });
  } catch (err) {
    console.error("Erro ao listar usuários:", err);
    res.status(500).json({ error: "Não foi possível carregar os usuários." });
  }
});

// GET /api/admin/users/:id/orders -> pedidos de um cliente específico
router.get("/users/:id/orders", async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: Number(req.params.id) },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ orders });
  } catch (err) {
    console.error("Erro ao listar pedidos do cliente:", err);
    res.status(500).json({ error: "Não foi possível carregar os pedidos deste cliente." });
  }
});

// GET /api/admin/settings -> configurações atuais do site
router.get("/settings", async (req, res) => {
  try {
    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    res.json({ settings });
  } catch (err) {
    console.error("Erro ao carregar configurações:", err);
    res.status(500).json({ error: "Não foi possível carregar as configurações." });
  }
});

// PUT /api/admin/settings -> atualizar configurações do site
router.put("/settings", async (req, res) => {
  try {
    const { discordUrl, whatsappUrl, contactEmail, announcement } = req.body;
    const settings = await prisma.settings.upsert({
      where: { id: 1 },
      update: {
        ...(discordUrl !== undefined ? { discordUrl } : {}),
        ...(whatsappUrl !== undefined ? { whatsappUrl } : {}),
        ...(contactEmail !== undefined ? { contactEmail } : {}),
        ...(announcement !== undefined ? { announcement } : {}),
      },
      create: { id: 1, discordUrl, whatsappUrl, contactEmail, announcement },
    });
    res.json({ settings });
  } catch (err) {
    console.error("Erro ao salvar configurações:", err);
    res.status(500).json({ error: "Não foi possível salvar as configurações." });
  }
});

// PUT /api/admin/users/:id -> tornar/remover admin de um usuário
router.put("/users/:id", async (req, res) => {
  try {
    const { isAdmin } = req.body;
    const user = await prisma.user.update({
      where: { id: Number(req.params.id) },
      data: { isAdmin: Boolean(isAdmin) },
      select: { id: true, name: true, email: true, isAdmin: true },
    });
    res.json({ user });
  } catch (err) {
    console.error("Erro ao atualizar usuário:", err);
    res.status(500).json({ error: "Não foi possível atualizar o usuário." });
  }
});

module.exports = router;
