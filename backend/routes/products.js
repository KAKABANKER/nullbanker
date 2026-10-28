const express = require("express");
const { prisma } = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

function getClientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
}

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

function slugify(text) {
  return text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Nunca expõe o link do arquivo nas rotas públicas: só diz se existe e se é grátis.
function toPublic(product) {
  const { downloadUrl, ...rest } = product;
  return { ...rest, hasDownload: !!downloadUrl, isFree: Number(product.price) <= 0 };
}

// Aceita só links http(s) (ou caminho local começando com "/"); vazio vira null.
function cleanUrl(value) {
  if (value === undefined) return undefined;
  const v = String(value || "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v) || (v.startsWith("/") && !v.startsWith("//"))) return v.slice(0, 1000);
  throw new Error("INVALID_URL");
}

function cleanPrice(value) {
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error("INVALID_PRICE");
  return Math.round(n * 100) / 100;
}

// GET /api/products?q=busca -> lista pública (com busca opcional)
router.get("/", async (req, res) => {
  try {
    const { q } = req.query;
    const where = {
      active: true,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { shortDesc: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    res.json({ products: products.map(toPublic) });
  } catch (err) {
    console.error("Erro ao listar produtos:", err);
    res.status(500).json({ error: "Não foi possível carregar os produtos." });
  }
});

// GET /api/products/:slug -> detalhe público
router.get("/:slug", async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { slug: req.params.slug },
    });
    if (!product || !product.active) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }
    res.json({ product: toPublic(product) });
  } catch (err) {
    console.error("Erro ao buscar produto:", err);
    res.status(500).json({ error: "Não foi possível carregar o produto." });
  }
});

// POST /api/products -> criar (admin)
router.post("/", requireAdmin, async (req, res) => {
  try {
    const { name, shortDesc, description, price, imageUrl, images, features, downloadUrl } = req.body;
    if (!name || !shortDesc || !description || price == null) {
      return res.status(400).json({ error: "Preencha nome, descrição curta, descrição e preço." });
    }
    let slug = slugify(name);
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (existing) slug = `${slug}-${Date.now().toString(36)}`;

    const product = await prisma.product.create({
      data: {
        name,
        slug,
        shortDesc,
        description,
        price: cleanPrice(price),
        imageUrl: cleanUrl(imageUrl) || null,
        downloadUrl: cleanUrl(downloadUrl) || null,
        images: Array.isArray(images) ? images.filter(Boolean).slice(0, 12) : [],
        features: Array.isArray(features) ? features : [],
      },
    });
    await logAction(req, "product.create", { targetType: "Product", targetId: product.id, detail: { name } });
    res.status(201).json({ product });
  } catch (err) {
    if (err.message === "INVALID_URL") return res.status(400).json({ error: "Links de imagem e de download precisam começar com http:// ou https://." });
    if (err.message === "INVALID_PRICE") return res.status(400).json({ error: "Preço inválido. Use 0 para produto grátis." });
    console.error("Erro ao criar produto:", err);
    res.status(500).json({ error: "Não foi possível criar o produto." });
  }
});

// PUT /api/products/:id -> editar (admin)
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, shortDesc, description, price, imageUrl, images, features, active, downloadUrl } = req.body;
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(shortDesc !== undefined ? { shortDesc } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(price !== undefined ? { price: cleanPrice(price) } : {}),
        ...(imageUrl !== undefined ? { imageUrl: cleanUrl(imageUrl) } : {}),
        ...(downloadUrl !== undefined ? { downloadUrl: cleanUrl(downloadUrl) } : {}),
        ...(images !== undefined ? { images: Array.isArray(images) ? images.filter(Boolean).slice(0, 12) : [] } : {}),
        ...(features !== undefined ? { features } : {}),
        ...(active !== undefined ? { active: Boolean(active) } : {}),
      },
    });
    await logAction(req, "product.update", { targetType: "Product", targetId: id });
    res.json({ product });
  } catch (err) {
    if (err.message === "INVALID_URL") return res.status(400).json({ error: "Links de imagem e de download precisam começar com http:// ou https://." });
    if (err.message === "INVALID_PRICE") return res.status(400).json({ error: "Preço inválido. Use 0 para produto grátis." });
    console.error("Erro ao editar produto:", err);
    res.status(500).json({ error: "Não foi possível editar o produto." });
  }
});

// DELETE /api/products/:id -> remover (admin)
// Produto que já tem pedidos não pode ser apagado (o histórico de vendas
// depende dele): nesse caso ele é apenas desativado e some da loja.
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const orderCount = await prisma.order.count({ where: { productId: id } });
    if (orderCount > 0) {
      await prisma.product.update({ where: { id }, data: { active: false } });
      await logAction(req, "product.deactivate", { targetType: "Product", targetId: id, detail: { orders: orderCount } });
      return res.json({ ok: true, deactivated: true, orders: orderCount });
    }
    await prisma.product.delete({ where: { id } });
    await logAction(req, "product.delete", { targetType: "Product", targetId: id });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error("Erro ao remover produto:", err);
    res.status(500).json({ error: "Não foi possível remover o produto." });
  }
});

module.exports = router;