const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Preencha nome, e-mail e senha." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "E-mail inválido." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "A senha precisa ter ao menos 6 caracteres." });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "Já existe uma conta com este e-mail." });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, phone: phone || null },
    });

    const token = signToken(user);
    res
      .cookie("token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .status(201)
      .json({
        token,
        user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
      });
  } catch (err) {
    console.error("Erro no registro:", err);
    res.status(500).json({ error: "Não foi possível concluir o cadastro." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Informe e-mail e senha." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Credenciais inválidas." });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Credenciais inválidas." });

    const token = signToken(user);
    res
      .cookie("token", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .json({
        token,
        user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin },
      });
  } catch (err) {
    console.error("Erro no login:", err);
    res.status(500).json({ error: "Não foi possível entrar." });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token").json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/profile -> dados completos do usuário logado
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, phone: true, isAdmin: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    res.json({ user });
  } catch (err) {
    console.error("Erro ao carregar perfil:", err);
    res.status(500).json({ error: "Não foi possível carregar seus dados." });
  }
});

// PUT /api/auth/profile -> editar os próprios dados (nome, telefone, e-mail, senha)
router.put("/profile", requireAuth, async (req, res) => {
  try {
    const { name, phone, email, currentPassword, newPassword } = req.body;
    const data = {};

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: "O nome não pode ficar em branco." });
      data.name = name.trim();
    }

    if (phone !== undefined) {
      data.phone = phone ? phone.trim() : null;
    }

    if (email !== undefined && email.trim()) {
      if (!isValidEmail(email)) return res.status(400).json({ error: "E-mail inválido." });
      const existing = await prisma.user.findUnique({ where: { email: email.trim() } });
      if (existing && existing.id !== req.user.id) {
        return res.status(409).json({ error: "Este e-mail já está em uso por outra conta." });
      }
      data.email = email.trim();
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: "Informe sua senha atual para definir uma nova." });
      }
      const current = await prisma.user.findUnique({ where: { id: req.user.id } });
      const ok = await bcrypt.compare(currentPassword, current.password);
      if (!ok) return res.status(401).json({ error: "Senha atual incorreta." });
      if (newPassword.length < 6) {
        return res.status(400).json({ error: "A nova senha precisa ter ao menos 6 caracteres." });
      }
      data.password = await bcrypt.hash(newPassword, 10);
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
      select: { id: true, name: true, email: true, phone: true, isAdmin: true, createdAt: true },
    });

    // Reemite o token, pois nome/e-mail podem ter mudado
    const token = signToken(updated);

    res.json({ user: updated, token });
  } catch (err) {
    console.error("Erro ao atualizar perfil:", err);
    res.status(500).json({ error: "Não foi possível salvar suas informações." });
  }
});

module.exports = router;
