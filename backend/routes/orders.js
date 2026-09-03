const express = require("express");
const { prisma } = require("../db");
const { optionalAuth, requireAuth } = require("../middleware/auth");
const plumify = require("../services/plumify");

const router = express.Router();

// Os SDKs só são inicializados se a chave existir, para o site não quebrar
// enquanto as contas de gateway ainda não foram configuradas pelo dono do site.
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
}

let mpClient = null;
let mpPayment = null;
if (process.env.MP_ACCESS_TOKEN) {
  const { MercadoPagoConfig, Payment } = require("mercadopago");
  mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
  mpPayment = new Payment(mpClient);
}

const APP_URL = process.env.APP_URL || "http://localhost:3000";

// POST /api/orders -> cria um pedido e inicia o pagamento
router.post("/", optionalAuth, async (req, res) => {
  try {
    const {
      productId,
      paymentMethod,
      customerName,
      customerEmail,
      customerPhone,
      cpf,
      address,
    } = req.body;

    if (!productId || !paymentMethod || !customerName || !customerEmail) {
      return res.status(400).json({ error: "Dados incompletos para o pedido." });
    }
    if (!["credit_card", "pix"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Forma de pagamento inválida." });
    }

    const product = await prisma.product.findUnique({ where: { id: Number(productId) } });
    if (!product || !product.active) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    const pixGateway = plumify.isConfigured ? "plumify" : "mercadopago";

    const order = await prisma.order.create({
      data: {
        userId: req.user ? req.user.id : null,
        productId: product.id,
        customerName,
        customerEmail,
        paymentMethod,
        amount: product.price,
        status: "pending",
        gateway: paymentMethod === "credit_card" ? "stripe" : pixGateway,
      },
    });

    if (paymentMethod === "credit_card") {
      if (!stripe) {
        return res.status(503).json({
          error:
            "Pagamento por cartão ainda não configurado. Defina STRIPE_SECRET_KEY no servidor.",
        });
      }
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: customerEmail,
        line_items: [
          {
            price_data: {
              currency: "brl",
              product_data: { name: product.name },
              unit_amount: Math.round(product.price * 100),
            },
            quantity: 1,
          },
        ],
        metadata: { orderId: String(order.id) },
        success_url: `${APP_URL}/pedido-confirmado.html?order=${order.id}`,
        cancel_url: `${APP_URL}/produto.html?slug=${product.slug}&cancelado=1`,
      });

      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { gatewayPaymentId: session.id, gatewayCheckoutUrl: session.url },
      });

      return res.status(201).json({
        order: updated,
        checkoutUrl: session.url,
      });
    }

    // ---------- PIX ----------

    if (pixGateway === "plumify") {
      if (!address || !address.street || !address.number || !address.neighborhood || !address.city || !address.state || !address.zipCode) {
        return res.status(400).json({
          error: "Preencha o endereço completo (rua, número, bairro, cidade, estado e CEP) para gerar o Pix.",
        });
      }
      if (!cpf) {
        return res.status(400).json({ error: "Informe o CPF para gerar o Pix." });
      }

      try {
        const result = await plumify.createPixTransaction({
          amountInReais: product.price,
          title: product.name,
          customerName,
          customerEmail,
          customerPhone: customerPhone || "",
          customerCpf: cpf,
          address,
          postbackUrl: `${APP_URL}/api/webhooks/plumify`,
        });

        const updated = await prisma.order.update({
          where: { id: order.id },
          data: { gatewayPaymentId: result.hash },
        });

        return res.status(201).json({
          order: updated,
          pix: {
            qrCode: result.pixCode,
            qrCodeBase64: result.pixQrCodeBase64,
          },
        });
      } catch (plumifyErr) {
        console.error("Erro ao gerar Pix via Plumify:", plumifyErr);
        return res.status(502).json({ error: "Não foi possível gerar o Pix agora. Tente novamente em instantes." });
      }
    }

    // Fallback: Mercado Pago (usado apenas se o Plumify não estiver configurado)
    if (!mpPayment) {
      return res.status(503).json({
        error: "Pagamento via Pix ainda não configurado. Defina PLUMIFY_API_TOKEN (ou MP_ACCESS_TOKEN) no servidor.",
      });
    }

    const [firstName, ...rest] = customerName.split(" ");
    const payment = await mpPayment.create({
      body: {
        transaction_amount: product.price,
        description: product.name,
        payment_method_id: "pix",
        payer: {
          email: customerEmail,
          first_name: firstName || customerName,
          last_name: rest.join(" ") || "Cliente",
          identification: cpf ? { type: "CPF", number: String(cpf).replace(/\D/g, "") } : undefined,
        },
        notification_url: `${APP_URL}/api/webhooks/mercadopago`,
        metadata: { orderId: String(order.id) },
      },
    });

    const pixData = payment.point_of_interaction?.transaction_data;

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { gatewayPaymentId: String(payment.id) },
    });

    return res.status(201).json({
      order: updated,
      pix: {
        qrCode: pixData?.qr_code || null,
        qrCodeBase64: pixData?.qr_code_base64 || null,
        ticketUrl: pixData?.ticket_url || null,
      },
    });
  } catch (err) {
    console.error("Erro ao criar pedido:", err);
    res.status(500).json({ error: "Não foi possível processar o pedido." });
  }
});

// GET /api/orders/:id -> status do pedido (para a página de confirmação)
router.get("/:id", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: Number(req.params.id) },
      include: { product: true },
    });
    if (!order) return res.status(404).json({ error: "Pedido não encontrado." });
    res.json({ order });
  } catch (err) {
    console.error("Erro ao buscar pedido:", err);
    res.status(500).json({ error: "Não foi possível carregar o pedido." });
  }
});

// GET /api/orders -> pedidos do usuário logado
router.get("/", requireAuth, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ orders });
  } catch (err) {
    console.error("Erro ao listar pedidos:", err);
    res.status(500).json({ error: "Não foi possível carregar seus pedidos." });
  }
});

module.exports = router;
