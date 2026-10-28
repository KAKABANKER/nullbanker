const express = require("express");
const { prisma } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function getClientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
}

const cardFields = { id: true, name: true, slug: true, imageUrl: true, price: true, downloadUrl: true };

function toCard(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    imageUrl: product.imageUrl,
    price: product.price,
    isFree: Number(product.price) <= 0,
    hasDownload: !!product.downloadUrl,
  };
}

// GET /api/downloads/:productId
// Só entrega o link de quem tem direito: produto grátis (com login) OU compra paga.
// Cada download autorizado fica registrado no histórico.
router.get("/downloads/:productId", requireAuth, async (req, res) => {
  try {
    const productId = Number(req.params.productId);
    if (!Number.isInteger(productId)) return res.status(404).json({ error: "Produto não encontrado." });

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ error: "Produto não encontrado." });
    if (!product.downloadUrl) {
      return res.status(404).json({ error: "Este produto ainda não tem arquivo disponível para download." });
    }

    const isFree = Number(product.price) <= 0;
    let allowed = req.user.isAdmin || (isFree && product.active);
    if (!allowed) {
      const paid = await prisma.order.findFirst({
        where: { userId: req.user.id, productId, status: "paid" },
        select: { id: true },
      });
      allowed = !!paid;
    }
    if (!allowed) {
      return res.status(403).json({
        error: isFree ? "Este produto não está disponível." : "Você precisa comprar este produto para baixar.",
      });
    }

    await prisma.download.create({
      data: { userId: req.user.id, productId, ip: getClientIp(req).slice(0, 64) },
    });

    res.json({ url: product.downloadUrl, name: product.name });
  } catch (err) {
    console.error("Erro ao liberar download:", err);
    res.status(500).json({ error: "Não foi possível liberar o download." });
  }
});

// GET /api/library -> "Meus Sites" (comprados + grátis baixados) e histórico de downloads
router.get("/library", requireAuth, async (req, res) => {
  try {
    const [orders, downloads] = await Promise.all([
      prisma.order.findMany({
        where: { userId: req.user.id, status: "paid" },
        include: { product: { select: cardFields } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.download.findMany({
        where: { userId: req.user.id },
        include: { product: { select: cardFields } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);

    const sites = new Map();
    orders.forEach((o) => {
      if (o.product && !sites.has(o.product.id)) {
        sites.set(o.product.id, { ...toCard(o.product), source: "purchase", since: o.createdAt });
      }
    });
    downloads.forEach((d) => {
      if (d.product && Number(d.product.price) <= 0 && !sites.has(d.product.id)) {
        sites.set(d.product.id, { ...toCard(d.product), source: "free", since: d.createdAt });
      }
    });

    res.json({
      sites: [...sites.values()],
      downloads: downloads.map((d) => ({
        id: d.id,
        createdAt: d.createdAt,
        product: d.product ? { id: d.product.id, name: d.product.name, slug: d.product.slug } : null,
      })),
    });
  } catch (err) {
    console.error("Erro ao carregar biblioteca:", err);
    res.status(500).json({ error: "Não foi possível carregar seus sites." });
  }
});

module.exports = router;
