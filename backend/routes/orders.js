const express = require("express");
const { prisma } = require("../db");
const { requireAuth } = require("../middleware/auth");
const plumify = require("../services/plumify");
const { decrypt } = require("../services/crypto");

const router = express.Router();

// Os SDKs só são inicializados se a chave existir, para o site não quebrar
// enquanto as contas de gateway ainda não foram configuradas pelo dono do site.
// Stripe e Mercado Pago só servem para os produtos OFICIAIS (sem vendedor) —
// produtos do marketplace são sempre pela Plumify do próprio vendedor.
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
}

let mpPayment = null;
if (process.env.MP_ACCESS_TOKEN) {
  const { MercadoPagoConfig, Payment } = require("mercadopago");
  const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
  mpPayment = new Payment(mpClient);
}

const APP_URL = process.env.APP_URL || "http://localhost:3000";

// Credenciais Plumify a usar para ESTE produto: do vendedor (marketplace) ou
// da plataforma (produto oficial). Retorna null se não há Plumify configurada
// para esse caso (aí o chamador decide se cai pra Stripe/Mercado Pago ou erro).
function creditsFor(product) {
  if (product.sellerId) {
    if (!product.seller || !product.seller.plumifyConfigured) return null;
    const apiToken = decrypt(product.seller.plumifyApiToken);
    const offerHash = decrypt(product.seller.plumifyOfferHash);
    if (!apiToken || !offerHash) return null;
    return { apiToken, offerHash };
  }
  return plumify.isConfigured(plumify.PLATFORM_CREDS) ? plumify.PLATFORM_CREDS : null;
}

// POST /api/orders -> cria um pedido e inicia o pagamento
router.post("/", requireAuth, async (req, res) => {
  try {
    const {
      productId,
      paymentMethod,
      customerName,
      customerEmail,
      customerPhone,
      cpf,
      address,
      card,
      installments,
    } = req.body;

    if (!productId || !paymentMethod || !customerName || !customerEmail) {
      return res.status(400).json({ error: "Dados incompletos para o pedido." });
    }
    if (!["credit_card", "pix"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Forma de pagamento inválida." });
    }

    const product = await prisma.product.findUnique({
      where: { id: Number(productId) },
      include: { seller: { select: { id: true, plumifyApiToken: true, plumifyOfferHash: true, plumifyConfigured: true } } },
    });
    if (!product || !product.active || product.status !== "approved") {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    // Produto grátis não passa por checkout: baixa direto pela biblioteca.
    if (Number(product.price) <= 0) {
      return res.status(400).json({
        error: "Este produto é grátis: entre na sua conta e baixe direto, sem pagamento.",
      });
    }

    // ---------- Decide o gateway ANTES de criar o pedido ----------
    const isMarketplace = !!product.sellerId;
    const creds = creditsFor(product);
    const usePlumify = !!creds;

    if (isMarketplace && !usePlumify) {
      return res.status(503).json({
        error: "O vendedor deste produto ainda não configurou o recebimento. Tente novamente mais tarde.",
      });
    }
    if (!isMarketplace) {
      if (paymentMethod === "credit_card" && !usePlumify && !stripe) {
        return res.status(503).json({
          error: "Pagamento por cartão ainda não configurado. Defina PLUMIFY_API_TOKEN (ou STRIPE_SECRET_KEY) no servidor.",
        });
      }
      if (paymentMethod === "pix" && !usePlumify && !mpPayment) {
        return res.status(503).json({
          error: "Pagamento via Pix ainda não configurado. Defina PLUMIFY_API_TOKEN (ou MP_ACCESS_TOKEN) no servidor.",
        });
      }
    }

    // ---------- Validações específicas (antes de criar o pedido) ----------
    const hasFullAddress =
      address &&
      address.street &&
      address.number &&
      address.neighborhood &&
      address.city &&
      address.state &&
      address.zipCode;

    if (usePlumify) {
      // Pix exige endereço completo; cartão não pede endereço (decisão do produto).
      if (paymentMethod === "pix" && !hasFullAddress) {
        return res.status(400).json({
          error: "Preencha o endereço completo (rua, número, bairro, cidade, estado e CEP) para gerar o Pix.",
        });
      }
      if (!cpf) {
        return res.status(400).json({ error: "Informe o CPF para continuar." });
      }
      if (paymentMethod === "credit_card") {
        if (!card || !card.number || !card.cvv || !card.expirationMonth || !card.expirationYear || !card.holderName) {
          return res.status(400).json({ error: "Preencha todos os dados do cartão." });
        }
      }
    }

    // ---------- Cria o pedido (já com validações feitas) ----------
    const gatewayName = usePlumify ? "plumify" : paymentMethod === "credit_card" ? "stripe" : "mercadopago";

    const order = await prisma.order.create({
      data: {
        userId: req.user.id,
        productId: product.id,
        sellerId: product.sellerId || null,
        customerName,
        customerEmail,
        paymentMethod,
        amount: product.price,
        status: "pending",
        gateway: gatewayName,
      },
    });

    // ---------- Cartão de crédito ----------
    if (paymentMethod === "credit_card") {
      if (usePlumify) {
        try {
          const result = await plumify.createCreditCardTransaction({
            creds,
            amountInReais: product.price,
            title: product.name,
            customerName,
            customerEmail,
            customerPhone: customerPhone || "",
            customerCpf: cpf,
            address: hasFullAddress
              ? address
              : { zipCode: "", street: "", number: "", neighborhood: "", city: "", state: "" },
            card,
            installments,
            postbackUrl: `${APP_URL}/api/webhooks/plumify`,
          });

          const updated = await prisma.order.update({
            where: { id: order.id },
            data: {
              gatewayPaymentId: result.hash,
              status: result.status,
              cardLast4: result.cardLast4,
              cardBrand: result.cardBrand,
            },
          });

          return res.status(201).json({ order: updated });
        } catch (cardErr) {
          console.error("Erro ao cobrar cartão via Plumify:", cardErr);
          await prisma.order.update({ where: { id: order.id }, data: { status: "failed" } }).catch(() => {});
          return res.status(402).json({
            error: cardErr.message || "Não foi possível processar o pagamento com este cartão.",
          });
        }
      }

      // Stripe (fallback — só para produto oficial)
      try {
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

        return res.status(201).json({ order: updated, checkoutUrl: session.url });
      } catch (stripeErr) {
        console.error("Erro ao criar sessão Stripe:", stripeErr);
        await prisma.order.update({ where: { id: order.id }, data: { status: "failed" } }).catch(() => {});
        return res.status(502).json({ error: "Não foi possível iniciar o checkout." });
      }
    }

    // ---------- PIX ----------
    if (usePlumify) {
      try {
        const result = await plumify.createPixTransaction({
          creds,
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
          pix: { qrCode: result.pixCode, qrCodeBase64: result.pixQrCodeBase64 },
        });
      } catch (plumifyErr) {
        console.error("Erro ao gerar Pix via Plumify:", plumifyErr);
        await prisma.order.update({ where: { id: order.id }, data: { status: "failed" } }).catch(() => {});
        return res.status(502).json({ error: "Não foi possível gerar o Pix agora. Tente novamente em instantes." });
      }
    }

    // Mercado Pago (fallback — só para produto oficial)
    try {
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
    } catch (mpErr) {
      console.error("Erro ao gerar Pix via Mercado Pago:", mpErr);
      await prisma.order.update({ where: { id: order.id }, data: { status: "failed" } }).catch(() => {});
      return res.status(502).json({ error: "Não foi possível gerar o Pix agora. Tente novamente em instantes." });
    }
  } catch (err) {
    console.error("Erro ao criar pedido:", err);
    res.status(500).json({ error: "Não foi possível processar o pedido." });
  }
});

// GET /api/orders/:id -> status do pedido (para a página de confirmação)
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: "Pedido não encontrado." });
    const order = await prisma.order.findUnique({
      where: { id },
      include: { product: { select: { name: true } } },
    });
    if (!order) return res.status(404).json({ error: "Pedido não encontrado." });
    res.json({
      order: {
        id: order.id,
        status: order.status,
        amount: order.amount,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt,
        product: { name: order.product ? order.product.name : "" },
      },
    });
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
