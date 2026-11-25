const express = require("express");
const { prisma } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { encrypt, isConfigured: cryptoConfigured, maskTail } = require("../services/crypto");

const router = express.Router();

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

// ============================================
// Meus produtos (vendedor)
// ============================================

// GET /api/my/products -> todos os meus produtos (qualquer status)
router.get("/products", requireAuth, async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { sellerId: req.user.id },
      include: { _count: { select: { orders: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ products });
  } catch (err) {
    console.error("Erro ao listar meus produtos:", err);
    res.status(500).json({ error: "Não foi possível carregar seus produtos." });
  }
});

// POST /api/my/products -> cria um produto novo na loja (entra como "pending")
router.post("/products", requireAuth, async (req, res) => {
  try {
    const { name, shortDesc, description, price, imageUrl, images, features, downloadUrl } = req.body;
    if (!name || !shortDesc || !description || price == null) {
      return res.status(400).json({ error: "Preencha nome, descrição curta, descrição e preço." });
    }

    let slug = slugify(name);
    if (await prisma.product.findUnique({ where: { slug } })) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

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
        sellerId: req.user.id,
        status: "pending", // revisão do admin antes de aparecer na loja
      },
    });
    res.status(201).json({ product });
  } catch (err) {
    if (err.message === "INVALID_URL") return res.status(400).json({ error: "Links de imagem e de download precisam começar com http:// ou https://." });
    if (err.message === "INVALID_PRICE") return res.status(400).json({ error: "Preço inválido. Use 0 para produto grátis." });
    console.error("Erro ao criar produto do vendedor:", err);
    res.status(500).json({ error: "Não foi possível criar o produto." });
  }
});

// PUT /api/my/products/:id -> edita um produto MEU
router.put("/products/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing || existing.sellerId !== req.user.id) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

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
    res.json({ product });
  } catch (err) {
    if (err.message === "INVALID_URL") return res.status(400).json({ error: "Links de imagem e de download precisam começar com http:// ou https://." });
    if (err.message === "INVALID_PRICE") return res.status(400).json({ error: "Preço inválido. Use 0 para produto grátis." });
    console.error("Erro ao editar produto do vendedor:", err);
    res.status(500).json({ error: "Não foi possível editar o produto." });
  }
});

// DELETE /api/my/products/:id -> remove (ou oculta, se já teve pedidos)
router.delete("/products/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing || existing.sellerId !== req.user.id) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    const orderCount = await prisma.order.count({ where: { productId: id } });
    if (orderCount > 0) {
      await prisma.product.update({ where: { id }, data: { active: false } });
      return res.json({ ok: true, deactivated: true, orders: orderCount });
    }
    await prisma.product.delete({ where: { id } });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error("Erro ao remover produto do vendedor:", err);
    res.status(500).json({ error: "Não foi possível remover o produto." });
  }
});

// ============================================
// Minhas vendas
// ============================================

// GET /api/my/sales -> pedidos dos MEUS produtos
router.get("/sales", requireAuth, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { sellerId: req.user.id },
      include: { product: { select: { name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const revenue = orders.filter((o) => o.status === "paid").reduce((sum, o) => sum + Number(o.amount), 0);
    res.json({ orders, revenue });
  } catch (err) {
    console.error("Erro ao listar vendas:", err);
    res.status(500).json({ error: "Não foi possível carregar suas vendas." });
  }
});

// ============================================
// Financeiro (credenciais Plumify do vendedor)
// ============================================

// GET /api/my/finance -> status (nunca devolve o token/hash reais)
router.get("/finance", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { storeName: true, storeBio: true, plumifyConfigured: true, plumifyOfferHash: true },
    });
    // O hash da oferta não é tão sensível quanto o token, então mostramos só os
    // últimos caracteres criptografados mesmo assim, por cautela.
    res.json({
      storeName: user.storeName || "",
      storeBio: user.storeBio || "",
      plumifyConfigured: user.plumifyConfigured,
      cryptoReady: cryptoConfigured,
    });
  } catch (err) {
    console.error("Erro ao carregar financeiro:", err);
    res.status(500).json({ error: "Não foi possível carregar seus dados financeiros." });
  }
});

// PUT /api/my/finance -> salva a Plumify do vendedor (criptografada) e os dados da loja
router.put("/finance", requireAuth, async (req, res) => {
  try {
    if (!cryptoConfigured) {
      return res.status(503).json({
        error: "O servidor ainda não está pronto para guardar credenciais de pagamento (ENCRYPTION_KEY ausente). Avise o administrador.",
      });
    }

    const { storeName, storeBio, plumifyApiToken, plumifyOfferHash } = req.body || {};
    const data = {};

    if (storeName !== undefined) data.storeName = String(storeName).trim().slice(0, 60) || null;
    if (storeBio !== undefined) data.storeBio = String(storeBio).trim().slice(0, 300) || null;

    if (plumifyApiToken !== undefined || plumifyOfferHash !== undefined) {
      const token = String(plumifyApiToken || "").trim();
      const hash = String(plumifyOfferHash || "").trim();
      if (!token || !hash) {
        return res.status(400).json({ error: "Preencha o token da API e o hash da oferta da Plumify." });
      }
      data.plumifyApiToken = encrypt(token);
      data.plumifyOfferHash = encrypt(hash);
      data.plumifyConfigured = true;
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: { storeName: true, storeBio: true, plumifyConfigured: true },
    });
    res.json(user);
  } catch (err) {
    console.error("Erro ao salvar financeiro:", err);
    res.status(500).json({ error: "Não foi possível salvar seus dados financeiros." });
  }
});

// DELETE /api/my/finance -> remove as credenciais Plumify (loja do vendedor fica sem recebimento)
router.delete("/finance", requireAuth, async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { plumifyApiToken: null, plumifyOfferHash: null, plumifyConfigured: false },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover credenciais financeiras:", err);
    res.status(500).json({ error: "Não foi possível remover suas credenciais." });
  }
});

module.exports = router;
