const express = require("express");
const bcrypt = require("bcryptjs");
const { prisma } = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.use(requireAdmin);

function getClientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
}

// Registra uma ação administrativa sensível. Nunca deixa o log derrubar a
// requisição principal caso algo dê errado ao gravar.
async function logAction(req, action, { targetType, targetId, detail } = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        adminId: req.user ? req.user.id : null,
        action,
        targetType: targetType || null,
        targetId: targetId !== undefined && targetId !== null ? String(targetId) : null,
        detail: detail || undefined,
        ip: getClientIp(req),
      },
    });
  } catch (err) {
    console.error("Não foi possível gravar o log de auditoria:", err);
  }
}

// GET /api/admin/stats -> números gerais para o topo do dashboard
router.get("/stats", async (req, res) => {
  try {
    const [totalVisits, totalOrders, paidOrders, revenueAgg, totalProducts, totalUsers, pendingOrders] =
      await Promise.all([
        prisma.visit.count(),
        prisma.order.count(),
        prisma.order.count({ where: { status: "paid" } }),
        prisma.order.aggregate({ where: { status: "paid" }, _sum: { amount: true } }),
        prisma.product.count(),
        prisma.user.count(),
        prisma.order.count({ where: { status: "pending" } }),
      ]);

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentVisits = await prisma.visit.count({ where: { createdAt: { gte: since } } });

    res.json({
      totalVisits,
      recentVisits,
      totalOrders,
      paidOrders,
      pendingOrders,
      revenue: revenueAgg._sum.amount || 0,
      totalProducts,
      totalUsers,
    });
  } catch (err) {
    console.error("Erro ao carregar estatísticas:", err);
    res.status(500).json({ error: "Não foi possível carregar as estatísticas." });
  }
});

// GET /api/admin/stats/revenue-daily -> receita paga por dia (últimos 30 dias), para o gráfico do dashboard
router.get("/stats/revenue-daily", async (req, res) => {
  try {
    const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    since.setHours(0, 0, 0, 0);

    const paidOrders = await prisma.order.findMany({
      where: { status: "paid", updatedAt: { gte: since } },
      select: { amount: true, updatedAt: true },
    });

    const buckets = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      buckets[d.toISOString().slice(0, 10)] = 0;
    }
    paidOrders.forEach((o) => {
      const key = o.updatedAt.toISOString().slice(0, 10);
      if (buckets[key] !== undefined) buckets[key] += o.amount;
    });

    const days = Object.entries(buckets).map(([date, total]) => ({ date, total }));
    res.json({ days });
  } catch (err) {
    console.error("Erro ao carregar receita diária:", err);
    res.status(500).json({ error: "Não foi possível carregar o gráfico de receita." });
  }
});

// GET /api/admin/orders -> lista de pedidos (com filtro opcional de status e busca)
router.get("/orders", async (req, res) => {
  try {
    const { status, q } = req.query;
    const where = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { customerName: { contains: q, mode: "insensitive" } },
              { customerEmail: { contains: q, mode: "insensitive" } },
              { gatewayPaymentId: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const orders = await prisma.order.findMany({
      where,
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

// GET /api/admin/orders/export -> exporta os pedidos filtrados em CSV
router.get("/orders/export", async (req, res) => {
  try {
    const { status, q } = req.query;
    const where = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { customerName: { contains: q, mode: "insensitive" } },
              { customerEmail: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const orders = await prisma.order.findMany({
      where,
      include: { product: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const header = [
      "id",
      "data",
      "cliente",
      "email",
      "produto",
      "valor",
      "forma_pagamento",
      "gateway",
      "status",
      "id_transacao_gateway",
    ];
    const rows = orders.map((o) =>
      [
        o.id,
        o.createdAt.toISOString(),
        o.customerName,
        o.customerEmail,
        o.product ? o.product.name : "",
        o.amount,
        o.paymentMethod,
        o.gateway || "",
        o.status,
        o.gatewayPaymentId || "",
      ]
        .map(escape)
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");

    await logAction(req, "orders.export", { targetType: "Order", detail: { count: orders.length, status: status || null, q: q || null } });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pedidos-${Date.now()}.csv"`);
    res.send("\uFEFF" + csv); // BOM para acentuação abrir certo no Excel
  } catch (err) {
    console.error("Erro ao exportar pedidos:", err);
    res.status(500).json({ error: "Não foi possível exportar os pedidos." });
  }
});

// PUT /api/admin/orders/:id -> atualizar status manualmente
router.put("/orders/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const id = Number(req.params.id);
    const before = await prisma.order.findUnique({ where: { id } });
    const order = await prisma.order.update({ where: { id }, data: { status } });

    await logAction(req, "order.status_update", {
      targetType: "Order",
      targetId: id,
      detail: { from: before ? before.status : null, to: status },
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
    const { gateway } = req.query;
    const webhooks = await prisma.webhookLog.findMany({
      where: gateway ? { gateway } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ webhooks });
  } catch (err) {
    console.error("Erro ao listar webhooks:", err);
    res.status(500).json({ error: "Não foi possível carregar os webhooks." });
  }
});

// GET /api/admin/audit-log -> ações administrativas sensíveis registradas
router.get("/audit-log", async (req, res) => {
  try {
    const logs = await prisma.auditLog.findMany({
      include: { admin: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ logs });
  } catch (err) {
    console.error("Erro ao listar log de auditoria:", err);
    res.status(500).json({ error: "Não foi possível carregar o log de auditoria." });
  }
});

// GET /api/admin/users -> lista de usuários cadastrados, com contagem de pedidos e busca opcional
router.get("/users", async (req, res) => {
  try {
    const { q } = req.query;
    const users = await prisma.user.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {},
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isAdmin: true,
        createdAt: true,
        lastLoginAt: true,
        lastLoginIp: true,
        lockedUntil: true,
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

    await logAction(req, "settings.update", { targetType: "Settings", targetId: 1, detail: req.body });

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
    const id = Number(req.params.id);
    const user = await prisma.user.update({
      where: { id },
      data: { isAdmin: Boolean(isAdmin) },
      select: { id: true, name: true, email: true, isAdmin: true },
    });

    await logAction(req, isAdmin ? "user.grant_admin" : "user.revoke_admin", {
      targetType: "User",
      targetId: id,
    });

    res.json({ user });
  } catch (err) {
    console.error("Erro ao atualizar usuário:", err);
    res.status(500).json({ error: "Não foi possível atualizar o usuário." });
  }
});

// DELETE /api/admin/users/:id -> excluir conta de um cliente
router.delete("/users/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (req.user && req.user.id === id) {
      return res.status(400).json({ error: "Você não pode excluir a própria conta por aqui." });
    }

    // Mantém o histórico de pedidos (nome/e-mail já ficam salvos no próprio pedido),
    // só desvincula da conta que será removida.
    await prisma.order.updateMany({ where: { userId: id }, data: { userId: null } });
    await prisma.user.delete({ where: { id } });

    await logAction(req, "user.delete", { targetType: "User", targetId: id });

    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao excluir usuário:", err);
    res.status(500).json({ error: "Não foi possível excluir este usuário." });
  }
});

// PUT /api/admin/users/:id/reset-password -> definir uma nova senha para o cliente
router.put("/users/:id/reset-password", async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "A nova senha precisa ter ao menos 6 caracteres." });
    }
    const id = Number(req.params.id);
    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id },
      // Zera tentativas/bloqueio de login ao redefinir a senha manualmente.
      data: { password: hashed, loginAttempts: 0, lockedUntil: null },
    });

    await logAction(req, "user.reset_password", { targetType: "User", targetId: id });

    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao redefinir senha do usuário:", err);
    res.status(500).json({ error: "Não foi possível redefinir a senha deste usuário." });
  }
});

// PUT /api/admin/users/:id/unlock -> remove um bloqueio de login ativo
router.put("/users/:id/unlock", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.user.update({
      where: { id },
      data: { loginAttempts: 0, lockedUntil: null },
    });

    await logAction(req, "user.unlock", { targetType: "User", targetId: id });

    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao desbloquear usuário:", err);
    res.status(500).json({ error: "Não foi possível desbloquear este usuário." });
  }
});

// DELETE /api/admin/visits -> apaga todo o log de visitas
router.delete("/visits", async (req, res) => {
  try {
    const result = await prisma.visit.deleteMany({});
    await logAction(req, "visits.clear", { detail: { count: result.count } });
    res.json({ ok: true, count: result.count });
  } catch (err) {
    console.error("Erro ao limpar visitas:", err);
    res.status(500).json({ error: "Não foi possível limpar as visitas." });
  }
});

// DELETE /api/admin/webhooks -> apaga todo o log de webhooks recebidos
router.delete("/webhooks", async (req, res) => {
  try {
    const result = await prisma.webhookLog.deleteMany({});
    await logAction(req, "webhooks.clear", { detail: { count: result.count } });
    res.json({ ok: true, count: result.count });
  } catch (err) {
    console.error("Erro ao limpar webhooks:", err);
    res.status(500).json({ error: "Não foi possível limpar os webhooks." });
  }
});

// DELETE /api/admin/audit-log -> apaga o histórico de ações administrativas
router.delete("/audit-log", async (req, res) => {
  try {
    const result = await prisma.auditLog.deleteMany({});
    // Registrado depois de limpar: fica pelo menos 1 linha marcando que a limpeza aconteceu.
    await logAction(req, "audit_log.clear", { detail: { count: result.count } });
    res.json({ ok: true, count: result.count });
  } catch (err) {
    console.error("Erro ao limpar log de auditoria:", err);
    res.status(500).json({ error: "Não foi possível limpar o log de auditoria." });
  }
});

// DELETE /api/admin/orders/cleanup -> remove pedidos falhos/cancelados (nunca pagos ou pendentes)
router.delete("/orders/cleanup", async (req, res) => {
  try {
    const result = await prisma.order.deleteMany({
      where: { status: { in: ["failed", "cancelled"] } },
    });
    await logAction(req, "orders.cleanup_failed", { detail: { count: result.count } });
    res.json({ ok: true, count: result.count });
  } catch (err) {
    console.error("Erro ao limpar pedidos falhos/cancelados:", err);
    res.status(500).json({ error: "Não foi possível limpar esses pedidos." });
  }
});

module.exports = router;
