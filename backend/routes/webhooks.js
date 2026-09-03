const express = require("express");
const { prisma } = require("../db");

const router = express.Router();

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

// POST /api/webhooks/stripe
// req.rawBody é preenchido pelo "verify" do express.json() no server.js
// e é o que a Stripe exige para validar a assinatura do evento.
router.post("/stripe", async (req, res) => {
  let event = req.body;

  if (stripe && process.env.STRIPE_WEBHOOK_SECRET) {
    const signature = req.headers["stripe-signature"];
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Assinatura do webhook Stripe inválida:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }

  try {
    await prisma.webhookLog.create({
      data: { gateway: "stripe", eventType: event.type, payload: event },
    });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = Number(session.metadata?.orderId);
      if (orderId) {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: "paid", gatewayPaymentId: session.id },
        });
      }
    } else if (
      event.type === "checkout.session.expired" ||
      event.type === "payment_intent.payment_failed"
    ) {
      const session = event.data.object;
      const orderId = Number(session.metadata?.orderId);
      if (orderId) {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: "failed" },
        });
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Erro ao processar webhook Stripe:", err);
    res.status(500).json({ error: "Erro ao processar webhook." });
  }
});

// POST /api/webhooks/mercadopago
router.post("/mercadopago", async (req, res) => {
  try {
    await prisma.webhookLog.create({
      data: { gateway: "mercadopago", eventType: req.body?.type || req.body?.topic, payload: req.body },
    });

    const paymentId = req.body?.data?.id || req.query.id;
    if (paymentId && mpPayment) {
      const payment = await mpPayment.get({ id: paymentId });
      const orderId = Number(payment.metadata?.order_id || payment.metadata?.orderId);

      let status = "pending";
      if (payment.status === "approved") status = "paid";
      else if (payment.status === "rejected") status = "failed";
      else if (payment.status === "cancelled") status = "cancelled";
      else if (payment.status === "refunded") status = "refunded";

      if (orderId) {
        await prisma.order.update({
          where: { id: orderId },
          data: { status, gatewayPaymentId: String(payment.id) },
        });
      } else {
        // fallback: tenta casar pelo gatewayPaymentId já salvo na criação do pedido
        await prisma.order
          .updateMany({
            where: { gatewayPaymentId: String(payment.id) },
            data: { status },
          })
          .catch(() => {});
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Erro ao processar webhook Mercado Pago:", err);
    res.status(500).json({ error: "Erro ao processar webhook." });
  }
});

// POST /api/webhooks/plumify
router.post("/plumify", async (req, res) => {
  try {
    const { hash, status } = req.body || {};

    await prisma.webhookLog.create({
      data: { gateway: "plumify", eventType: status || null, payload: req.body },
    });

    if (hash && status) {
      let mappedStatus = null;
      if (status === "paid") mappedStatus = "paid";
      else if (status === "refused" || status === "chargedback") mappedStatus = "failed";
      else if (status === "refunded") mappedStatus = "refunded";
      else if (status === "canceled" || status === "cancelled") mappedStatus = "cancelled";

      if (mappedStatus) {
        await prisma.order
          .updateMany({
            where: { gatewayPaymentId: String(hash) },
            data: { status: mappedStatus },
          })
          .catch(() => {});
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Erro ao processar webhook Plumify:", err);
    res.status(500).json({ error: "Erro ao processar webhook." });
  }
});

module.exports = router;
