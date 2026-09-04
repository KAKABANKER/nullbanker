const crypto = require("crypto");

const API_TOKEN = process.env.PLUMIFY_API_TOKEN;
const OFFER_HASH = process.env.PLUMIFY_OFFER_HASH;
const WEBHOOK_SECRET = process.env.PLUMIFY_WEBHOOK_SECRET;
const API_BASE = "https://api.plumify.com.br/api/public/v1";

const isConfigured = !!API_TOKEN && !!OFFER_HASH;

/**
 * Anexa um token próprio (não fornecido pela Plumify) na query string da
 * postback_url. Isso não substitui uma eventual assinatura de webhook da
 * própria gateway, mas evita que qualquer pessoa que descubra a URL do
 * webhook consiga forjar confirmações de pagamento — só aceitamos o POST
 * se o token bater com o configurado no servidor (ver PLUMIFY_WEBHOOK_SECRET).
 */
function signedPostbackUrl(postbackUrl) {
  if (!WEBHOOK_SECRET) return postbackUrl;
  const separator = postbackUrl.includes("?") ? "&" : "?";
  return `${postbackUrl}${separator}wt=${encodeURIComponent(WEBHOOK_SECRET)}`;
}

function verifyWebhookToken(token) {
  if (!WEBHOOK_SECRET) return true; // nenhum segredo configurado ainda: não bloqueia
  if (!token) return false;
  const a = Buffer.from(String(token));
  const b = Buffer.from(String(WEBHOOK_SECRET));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function buildCustomer({ customerName, customerEmail, customerPhone, customerCpf, address }) {
  return {
    name: customerName,
    email: customerEmail,
    phone_number: customerPhone,
    document: (customerCpf || "").replace(/\D/g, ""),
    street_name: address.street,
    number: address.number,
    neighborhood: address.neighborhood,
    city: address.city,
    state: address.state,
    zip_code: (address.zipCode || "").replace(/\D/g, ""),
  };
}

async function callPlumify(payload) {
  const response = await fetch(`${API_BASE}/transactions?api_token=${API_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch (e) {
    throw new Error(`Resposta inválida da Plumify (status ${response.status}).`);
  }

  if (!response.ok) {
    // Loga a resposta crua para facilitar diagnóstico caso algum campo do
    // payload não bata com o que a Plumify espera (ex: nome de atributo do cartão).
    console.error("Plumify respondeu com erro:", response.status, JSON.stringify(data));
    const message = (data && (data.message || data.error)) || "Erro ao comunicar com a Plumify.";
    throw new Error(message);
  }

  return data;
}

/**
 * Cria uma transação Pix na Plumify.
 */
async function createPixTransaction({
  amountInReais,
  title,
  customerName,
  customerEmail,
  customerPhone,
  customerCpf,
  address,
  postbackUrl,
}) {
  if (!isConfigured) throw new Error("PLUMIFY_NOT_CONFIGURED");

  const amountCents = Math.round(Number(amountInReais) * 100);

  const payload = {
    amount: amountCents,
    offer_hash: OFFER_HASH,
    payment_method: "pix",
    customer: buildCustomer({ customerName, customerEmail, customerPhone, customerCpf, address }),
    cart: [{ product_hash: OFFER_HASH, title, price: amountCents, quantity: 1 }],
    expire_in_days: 1,
    postback_url: signedPostbackUrl(postbackUrl),
  };

  const data = await callPlumify(payload);

  if (!data.pix || !data.pix.pix_qr_code) {
    throw new Error(data.message || "Erro ao gerar pagamento Pix.");
  }

  return {
    hash: data.hash,
    status: data.payment_status || data.status || "pending",
    pixCode: data.pix.pix_qr_code,
    pixQrCodeBase64: data.pix.pix_qr_code_base64 || null,
  };
}

/**
 * Cria uma transação de cartão de crédito na Plumify.
 *
 * IMPORTANTE: não consegui acessar a documentação de cartão da Plumify
 * (docs.plumify.com.br é renderizada via JS e não retornou conteúdo
 * indexável no momento desta integração) — o payload de Pix acima veio de
 * um projeto de referência seu. O bloco `card` abaixo segue o padrão mais
 * comum usado por gateways com esse mesmo formato de payload (offer_hash /
 * cart / postback_url). Antes de usar em produção:
 *   1. Confirme os nomes exatos dos campos do cartão no painel/documentação
 *      da sua conta Plumify (Configurações > API ou Central de Ajuda).
 *   2. Faça um teste com um cartão de teste, se a Plumify oferecer sandbox.
 *   3. Se algum campo estiver errado, o erro cru retornado pela API fica
 *      registrado no log do servidor (console.error em callPlumify) para
 *      facilitar o ajuste rápido.
 */
async function createCreditCardTransaction({
  amountInReais,
  title,
  customerName,
  customerEmail,
  customerPhone,
  customerCpf,
  address,
  postbackUrl,
  card, // { number, holderName, expirationMonth, expirationYear, cvv }
  installments,
}) {
  if (!isConfigured) throw new Error("PLUMIFY_NOT_CONFIGURED");
  if (!card || !card.number || !card.cvv || !card.expirationMonth || !card.expirationYear || !card.holderName) {
    throw new Error("Dados do cartão incompletos.");
  }

  const amountCents = Math.round(Number(amountInReais) * 100);
  const cleanNumber = String(card.number).replace(/\s+/g, "");

  const payload = {
    amount: amountCents,
    offer_hash: OFFER_HASH,
    payment_method: "credit_card",
    installments: Math.max(1, Number(installments) || 1),
    customer: buildCustomer({ customerName, customerEmail, customerPhone, customerCpf, address }),
    cart: [{ product_hash: OFFER_HASH, title, price: amountCents, quantity: 1 }],
    card: {
      number: cleanNumber,
      cvv: String(card.cvv),
      expiration_month: String(card.expirationMonth).padStart(2, "0"),
      expiration_year: String(card.expirationYear),
      holder_name: card.holderName,
    },
    postback_url: signedPostbackUrl(postbackUrl),
  };

  const data = await callPlumify(payload);

  const status = (data.payment_status || data.status || "").toLowerCase();
  const approved = ["paid", "approved", "captured"].includes(status);
  const refused = ["refused", "declined", "not_authorized", "denied"].includes(status);

  if (refused) {
    throw new Error(data.message || "Cartão recusado. Verifique os dados e tente novamente.");
  }

  return {
    hash: data.hash,
    status: approved ? "paid" : "pending",
    cardLast4: cleanNumber.slice(-4),
    cardBrand: data.card && data.card.brand ? data.card.brand : null,
  };
}

module.exports = {
  isConfigured,
  createPixTransaction,
  createCreditCardTransaction,
  verifyWebhookToken,
};
