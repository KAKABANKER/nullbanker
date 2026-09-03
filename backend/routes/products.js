const express = require("express");
const { prisma } = require("../db");
const { requireAdmin } = require("../middleware/auth");

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
    res.json({ products });
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
    res.json({ product });
  } catch (err) {
    console.error("Erro ao buscar produto:", err);
    res.status(500).json({ error: "Não foi possível carregar o produto." });
  }
});

// POST /api/products -> criar (admin)
router.post("/", requireAdmin, async (req, res) => {
  try {
    const { name, shortDesc, description, price, imageUrl, images, features } = req.body;
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
        price: Number(price),
        imageUrl: imageUrl || null,
        images: Array.isArray(images) ? images : [],
        features: Array.isArray(features) ? features : [],
      },
    });
    res.status(201).json({ product });
  } catch (err) {
    console.error("Erro ao criar produto:", err);
    res.status(500).json({ error: "Não foi possível criar o produto." });
  }
});

// PUT /api/products/:id -> editar (admin)
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, shortDesc, description, price, imageUrl, images, features, active } = req.body;
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(shortDesc !== undefined ? { shortDesc } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(price !== undefined ? { price: Number(price) } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(images !== undefined ? { images: Array.isArray(images) ? images : [] } : {}),
        ...(features !== undefined ? { features } : {}),
        ...(active !== undefined ? { active: Boolean(active) } : {}),
      },
    });
    res.json({ product });
  } catch (err) {
    console.error("Erro ao editar produto:", err);
    res.status(500).json({ error: "Não foi possível editar o produto." });
  }
});

// DELETE /api/products/:id -> remover (admin)
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.product.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover produto:", err);
    res.status(500).json({ error: "Não foi possível remover o produto." });
  }
});

module.exports = router;
