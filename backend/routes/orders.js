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

    const product = await prisma.product.findUnique({ where: { id: Number(productId) } });
    if (!product || !product.active) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    const isFreeProduct = Number(product.price) <= 0;
    if (isFreeProduct && paymentMethod) {
      return res.status(400).json({
        error: "Este produto é grátis: entre na sua conta e baixe direto, sem pagamento.",
      });
    }

    // ---------- Decide o gateway ANTES de criar o pedido ----------
    const usePlumify = plumify.isConfigured;

    if (paymentMethod === "credit_card" && !usePlumify && !stripe) {
      return res.status(503).json({
        error:
          "Pagamento por cartão ainda não configurado. Defina PLUMIFY_API_TOKEN (ou STRIPE_SECRET_KEY) no servidor.",
      });
    }
    if (paymentMethod === "pix" && !usePlumify && !mpPayment) {
      return res.status(503).json({
        error:
          "Pagamento via Pix ainda não configurado. Defina PLUMIFY_API_TOKEN (ou MP_ACCESS_TOKEN) no servidor.",
      });
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
      // Plumify exige endereço completo + CPF para os dois meios.
      if (!hasFullAddress) {
        return res.status(400).json({
          error:
            "Preencha o endereço completo (rua, número, bairro, cidade, estado e CEP) para continuar.",
        });
      }
      if (!cpf) {
        return res.status(400).json({ error: "Informe o CPF para continuar." });
      }
      if (paymentMethod === "credit_card") {
        if (
          !card ||
          !card.number ||
          !card.cvv ||
          !card.expirationMonth ||
          !card.expirationYear ||
          !card.holderName
        ) {
          return res.status(400).json({ error: "Preencha todos os dados do cartão." });
        }
      }
    }

    // ---------- Cria o pedido (já com validações feitas) ----------
    const gatewayName = usePlumify
      ? "plumify"
      : paymentMethod === "credit_card"
      ? "stripe"
      : "mercadopago";

    const order = await prisma.order.create({
      data: {
        userId: req.user.id,
        productId: product.id,
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
            amountInReais: product.price,
            title: product.name,
            customerName,
            customerEmail,
            customerPhone: customerPhone || "",
            customerCpf: cpf,
            address,
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
          await prisma.order
            .update({ where: { id: order.id }, data: { status: "failed" } })
            .catch(() => {});
          return res.status(402).json({
            error: cardErr.message || "Não foi possível processar o pagamento com este cartão.",
          });
        }
      }

      // Stripe (fallback)
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
        await prisma.order
          .update({ where: { id: order.id }, data: { status: "failed" } })
          .catch(() => {});
        return res.status(502).json({ error: "Não foi possível iniciar o checkout." });
      }
    }

    // ---------- PIX ----------
    if (usePlumify) {
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
        await prisma.order
          .update({ where: { id: order.id }, data: { status: "failed" } })
          .catch(() => {});
        return res.status(502).json({
          error: "Não foi possível gerar o Pix agora. Tente novamente em instantes.",
        });
      }
    }

    // Mercado Pago (fallback)
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
            identification: cpf
              ? { type: "CPF", number: String(cpf).replace(/\D/g, "") }
              : undefined,
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
      await prisma.order
        .update({ where: { id: order.id }, data: { status: "failed" } })
        .catch(() => {});
      return res.status(502).json({
        error: "Não foi possível gerar o Pix agora. Tente novamente em instantes.",
      });
    }
  } catch (err) {
    console.error("Erro ao criar pedido:", err);
    res.status(500).json({ error: "Não foi possível processar o pedido." });
  }
});
});

module.exports = router;
