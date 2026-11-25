const crypto = require("crypto");

// ============================================
// CREDENCIAIS PLUMIFY
// A conta "oficial" (da própria NULLBANKER) continua vindo só de variáveis
// de ambiente — nunca direto no código.
//   PLUMIFY_API_TOKEN       token da API (painel da Plumify da casa)
//   PLUMIFY_OFFER_HASH      hash da oferta/produto
//   PLUMIFY_WEBHOOK_SECRET  (opcional) segredo do webhook; se ausente, é
//                           derivado automaticamente do JWT_SECRET
//
// Cada vendedor da loja pode usar a PRÓPRIA conta Plumify (ver services/crypto.js
// e routes/seller.js) — nesse caso as credenciais chegam por parâmetro em vez de
// virem daqui.
// ============================================
const PLATFORM_CREDS = {
  apiToken: process.env.PLUMIFY_API_TOKEN || "",
  offerHash: process.env.PLUMIFY_OFFER_HASH || "",
};

const WEBHOOK_SECRET =
  process.env.PLUMIFY_WEBHOOK_SECRET ||
  (process.env.JWT_SECRET
    ? crypto.createHmac("sha256", process.env.JWT_SECRET).update("plumify-webhook").digest("hex")
    : "");

// A API da Plumify exige "operation_type". O valor 1 é o que plataformas do mesmo
// tipo documentam para venda comum — CONFIRME na documentação da Plumify.
// Se for outro número, defina PLUMIFY_OPERATION_TYPE no Render (sem mexer no código).
const OPERATION_TYPE = Number(process.env.PLUMIFY_OPERATION_TYPE) || 1;

const API_BASE = "https://api.plumify.com.br/api/public/v1";

function isConfigured(creds) {
  const c = creds || PLATFORM_CREDS;
  return !!c.apiToken && !!c.offerHash;
}

/**
 * Anexa um token próprio (não fornecido pela Plumify) na query string da
 * postback_url. Isso não substitui uma eventual assinatura de webhook da
 * própria gateway, mas evita que qualquer pessoa que descubra a URL do
 * webhook consiga forjar confirmações de pagamento — só aceitamos o POST
 * se o token bater com o configurado no servidor (ver PLUMIFY_WEBHOOK_SECRET).
 * Esse segredo é nosso (não da Plumify), então vale para TODOS os vendedores
 * da loja — não precisa ser um por conta.
 */
function signedPostbackUrl(postbackUrl) {
  if (!WEBHOOK_SECRET) return postbackUrl;
  const separator = postbackUrl.includes("?") ? "&" : "?";
  return `${postbackUrl}${separator}wt=${encodeURIComponent(WEBHOOK_SECRET)}`;
}

function verifyWebhookToken(token) {
  // Falha fechada: sem segredo (ou sem token na requisição) nada é aceito.
  if (!WEBHOOK_SECRET) return false;
  if (!token) return false;
  const a = Buffer.from(String(token));
  const b = Buffer.from(String(WEBHOOK_SECRET));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function buildCustomer({ customerName, customerEmail, customerPhone, customerCpf, address }) {
  const a = address || {};
  return {
    name: customerName,
    email: customerEmail,
    phone_number: customerPhone,
    document: (customerCpf || "").replace(/\D/g, ""),
    street_name: a.street || "",
    number: a.number || "",
    neighborhood: a.neighborhood || "",
    city: a.city || "",
    state: a.state || "",
    zip_code: (a.zipCode || "").replace(/\D/g, ""),
  };
}

async function callPlumify(creds, payload) {
  const response = await fetch(`${API_BASE}/transactions?api_token=${creds.apiToken}`, {
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
    console.error("Plumify respondeu com erro:", response.status, JSON.stringify(data));
    const message = (data && (data.message || data.error)) || "Erro ao comunicar com a Plumify.";
    throw new Error(message);
  }

  return data;
}

/**
 * Cria uma transação Pix na Plumify.
 * `creds` é { apiToken, offerHash } — da plataforma (produto oficial) ou de um
 * vendedor específico (produto do marketplace). Se omitido, usa a plataforma.
 */
async function createPixTransaction({
  creds,
  amountInReais,
  title,
  customerName,
  customerEmail,
  customerPhone,
  customerCpf,
  address,
  postbackUrl,
}) {
  const c = creds || PLATFORM_CREDS;
  if (!isConfigured(c)) throw new Error("PLUMIFY_NOT_CONFIGURED");

  const amountCents = Math.round(Number(amountInReais) * 100);

  const payload = {
    amount: amountCents,
    offer_hash: c.offerHash,
    operation_type: OPERATION_TYPE,
    payment_method: "pix",
    customer: buildCustomer({ customerName, customerEmail, customerPhone, customerCpf, address }),
    cart: [{ product_hash: c.offerHash, title, price: amountCents, quantity: 1, operation_type: OPERATION_TYPE }],
    expire_in_days: 1,
    postback_url: signedPostbackUrl(postbackUrl),
  };

  const data = await callPlumify(c, payload);

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
 */
async function createCreditCardTransaction({
  creds,
  amountInReais,
  title,
  customerName,
  customerEmail,
  customerPhone,
  customerCpf,
  address,
  postbackUrl,
  card,
  installments,
}) {
  const c = creds || PLATFORM_CREDS;
  if (!isConfigured(c)) throw new Error("PLUMIFY_NOT_CONFIGURED");
  if (!card || !card.number || !card.cvv || !card.expirationMonth || !card.expirationYear || !card.holderName) {
    throw new Error("Dados do cartão incompletos.");
  }

  const amountCents = Math.round(Number(amountInReais) * 100);
  const cleanNumber = String(card.number).replace(/\s+/g, "");

  const payload = {
    amount: amountCents,
    offer_hash: c.offerHash,
    operation_type: OPERATION_TYPE,
    payment_method: "credit_card",
    installments: Math.min(12, Math.max(1, Math.floor(Number(installments)) || 1)),
    customer: buildCustomer({ customerName, customerEmail, customerPhone, customerCpf, address }),
    cart: [{ product_hash: c.offerHash, title, price: amountCents, quantity: 1, operation_type: OPERATION_TYPE }],
    card: {
      number: cleanNumber,
      cvv: String(card.cvv),
      expiration_month: String(card.expirationMonth).padStart(2, "0"),
      expiration_year: String(card.expirationYear),
      holder_name: card.holderName,
    },
    postback_url: signedPostbackUrl(postbackUrl),
  };

  const data = await callPlumify(c, payload);

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
  PLATFORM_CREDS,
  isConfigured,
  createPixTransaction,
  createCreditCardTransaction,
  verifyWebhookToken,
};
