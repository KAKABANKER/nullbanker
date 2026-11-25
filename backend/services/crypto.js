const crypto = require("crypto");

// Criptografa credenciais sensíveis de terceiros (API/hash da Plumify de cada
// vendedor) antes de salvar no banco. Nunca guardamos esses valores em texto puro.
//
// ENCRYPTION_KEY precisa ser uma string de 64 caracteres hex (32 bytes). Gere com:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const RAW_KEY = process.env.ENCRYPTION_KEY || "";
const KEY = /^[0-9a-f]{64}$/i.test(RAW_KEY) ? Buffer.from(RAW_KEY, "hex") : null;

const isConfigured = !!KEY;

function encrypt(plainText) {
  if (!KEY) throw new Error("ENCRYPTION_KEY_NOT_CONFIGURED");
  if (plainText === null || plainText === undefined || plainText === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // formato: iv.tag.dados, tudo em base64 — fácil de guardar numa coluna String
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

function decrypt(stored) {
  if (!KEY) throw new Error("ENCRYPTION_KEY_NOT_CONFIGURED");
  if (!stored) return null;
  const [ivB64, tagB64, dataB64] = String(stored).split(".");
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return dec.toString("utf8");
  } catch (err) {
    return null; // chave errada, dado corrompido, etc. — trata como "não configurado"
  }
}

// Só os últimos caracteres, para a pessoa confirmar qual token salvou sem reexibi-lo.
function maskTail(plainText, visible = 4) {
  const s = String(plainText || "");
  if (s.length <= visible) return "•".repeat(s.length);
  return "•".repeat(Math.min(8, s.length - visible)) + s.slice(-visible);
}

module.exports = { isConfigured, encrypt, decrypt, maskTail };
