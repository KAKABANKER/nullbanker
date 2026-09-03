const API_TOKEN = process.env.PLUMIFY_API_TOKEN;
const OFFER_HASH = process.env.PLUMIFY_OFFER_HASH;

const isConfigured = !!API_TOKEN && !!OFFER_HASH;

/**
 * Cria uma transação Pix na Plumify.
 * Documentação repassada pelo cliente — payload e resposta seguem o formato
 * usado no projeto de referência dele.
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
  if (!isConfigured) {
    throw new Error("PLUMIFY_NOT_CONFIGURED");
  }

  const amountCents = Math.round(Number(amountInReais) * 100);

  const payload = {
    amount: amountCents,
    offer_hash: OFFER_HASH,
    payment_method: "pix",
    customer: {
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
    },
    cart: [
      {
        product_hash: OFFER_HASH,
        title,
        price: amountCents,
        quantity: 1,
      },
    ],
    expire_in_days: 1,
    postback_url: postbackUrl,
  };

  const response = await fetch(
    `https://api.plumify.com.br/api/public/v1/transactions?api_token=${API_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (!response.ok || !data.pix || !data.pix.pix_qr_code) {
    const message = (data && (data.message || data.error)) || "Erro ao gerar pagamento Pix.";
    throw new Error(message);
  }

  return {
    hash: data.hash,
    pixCode: data.pix.pix_qr_code,
    pixQrCodeBase64: data.pix.pix_qr_code_base64 || null,
  };
}

module.exports = { isConfigured, createPixTransaction };
