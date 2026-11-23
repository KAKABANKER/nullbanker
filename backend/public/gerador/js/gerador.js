(function () {
  "use strict";

  // ATENÇÃO: em produção, mova este token para um backend proxy.
  // Como o site é estático, o token fica exposto no navegador.
  const API_TOKEN = "29336|RZWXMgoRa13Jtum9ArQtr10t9N02Rn8W";
  const API_BASE = "https://api.invertexto.com/v1";

  const $ = (id) => document.getElementById(id);

  function setLoading(id, on) {
    const el = $(id);
    if (el) el.closest(".generator-card").classList.toggle("loading", on);
  }

  function showError(id, message) {
    const el = $(id);
    if (el) el.innerHTML = `<span class="msg-error">${escapeHtml(message)}</span>`;
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  async function apiGet(path, params = {}) {
    const url = new URL(`${API_BASE}${path}`);
    url.searchParams.set("token", API_TOKEN);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });
    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Erro ${res.status}: ${text || res.statusText}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res;
  }

  // 1. Gerador de Pessoas
  async function gerarPessoas() {
    const qty = Math.min(Math.max(parseInt($("fakerQty").value) || 1, 1), 10);
    const fields = $("fakerFields").value;
    setLoading("fakerResult", true);
    try {
      const resultados = [];
      for (let i = 0; i < qty; i++) {
        const data = await apiGet("/faker", { locale: "pt_BR", fields });
        resultados.push(data);
      }
      $("fakerResult").innerHTML = `<pre>${escapeHtml(JSON.stringify(resultados.length === 1 ? resultados[0] : resultados, null, 2))}</pre>`;
    } catch (e) {
      showError("fakerResult", e.message);
    } finally {
      setLoading("fakerResult", false);
    }
  }

  // 2. QR Code
  async function gerarQrcode() {
    const text = $("qrText").value.trim();
    if (!text) return showError("qrResult", "Informe o texto ou URL.");
    const color = $("qrColor").value.trim() || "#000000";
    const label = $("qrLabel").value.trim();
    setLoading("qrResult", true);
    try {
      const url = new URL(`${API_BASE}/qrcode`);
      url.searchParams.set("token", API_TOKEN);
      url.searchParams.set("text", text);
      url.searchParams.set("foreground", color);
      url.searchParams.set("scale", "6");
      if (label) url.searchParams.set("label", label);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Falha ao gerar QR Code.");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      $("qrResult").innerHTML = `<img src="${objUrl}" alt="QR Code gerado" />`;
    } catch (e) {
      showError("qrResult", e.message);
    } finally {
      setLoading("qrResult", false);
    }
  }

  // 3. Código de Barras
  async function gerarBarcode() {
    const text = $("barText").value.trim();
    if (!text) return showError("barResult", "Informe o valor do código.");
    const type = $("barType").value;
    setLoading("barResult", true);
    try {
      const url = new URL(`${API_BASE}/barcode`);
      url.searchParams.set("token", API_TOKEN);
      url.searchParams.set("text", text);
      url.searchParams.set("type", type);
      url.searchParams.set("scale", "3");
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Falha ao gerar código de barras.");
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      $("barResult").innerHTML = `<img src="${objUrl}" alt="Código de barras gerado" />`;
    } catch (e) {
      showError("barResult", e.message);
    } finally {
      setLoading("barResult", false);
    }
  }

  // 4. Validador CPF/CNPJ
  async function validarDocumento() {
    const value = $("valDoc").value.trim();
    if (!value) return showError("valResult", "Informe o documento.");
    setLoading("valResult", true);
    try {
      const data = await apiGet("/validator", { value });
      const ok = data.valid
        ? '<span class="msg-success">Documento válido</span>'
        : '<span class="msg-error">Documento inválido</span>';
      $("valResult").innerHTML = `
        <div class="result-row"><span class="result-label">Status</span><span class="result-value">${ok}</span></div>
        <div class="result-row"><span class="result-label">Formatado</span><span class="result-value">${escapeHtml(data.formatted || "—")}</span></div>
      `;
    } catch (e) {
      showError("valResult", e.message);
    } finally {
      setLoading("valResult", false);
    }
  }

  // 5. Número por Extenso
  async function converterExtenso() {
    const number = $("extNumber").value.trim();
    if (!number) return showError("extResult", "Informe um número.");
    const language = $("extLang").value;
    const currency = $("extCurrency").value;
    setLoading("extResult", true);
    try {
      const data = await apiGet("/number-to-words", { number, language, currency });
      $("extResult").innerHTML = `<pre>${escapeHtml(data.text || JSON.stringify(data, null, 2))}</pre>`;
    } catch (e) {
      showError("extResult", e.message);
    } finally {
      setLoading("extResult", false);
    }
  }

  // 6. Consulta de CEP
  async function consultarCep() {
    const cep = $("cepInput").value.replace(/\D/g, "");
    if (cep.length !== 8) return showError("cepResult", "CEP deve ter 8 dígitos.");
    setLoading("cepResult", true);
    try {
      const data = await apiGet(`/cep/${cep}`);
      $("cepResult").innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
    } catch (e) {
      showError("cepResult", e.message);
    } finally {
      setLoading("cepResult", false);
    }
  }

  // 7. Conversor de Moedas
  async function consultarMoeda() {
    const pair = $("curPair").value;
    setLoading("curResult", true);
    try {
      const data = await apiGet(`/currency/${pair}`);
      const key = Object.keys(data)[0];
      const info = data[key];
      $("curResult").innerHTML = `
        <div class="result-row"><span class="result-label">Par</span><span class="result-value">${escapeHtml(key)}</span></div>
        <div class="result-row"><span class="result-label">Preço</span><span class="result-value">${escapeHtml(String(info.price))}</span></div>
        <div class="result-row"><span class="result-label">Atualizado</span><span class="result-value">${new Date(info.timestamp * 1000).toLocaleString("pt-BR")}</span></div>
      `;
    } catch (e) {
      showError("curResult", e.message);
    } finally {
      setLoading("curResult", false);
    }
  }

  // 8. Tabela Fipe (lista de marcas)
  async function listarFipe() {
    const type = $("fipeType").value;
    setLoading("fipeResult", true);
    try {
      const data = await apiGet(`/fipe/brands/${type}`);
      const marcas = Array.isArray(data) ? data : (data.brands || data);
      $("fipeResult").innerHTML = `<pre>${escapeHtml(JSON.stringify(marcas, null, 2))}</pre>`;
    } catch (e) {
      showError("fipeResult", e.message);
    } finally {
      setLoading("fipeResult", false);
    }
  }

  // 9. Localizador de IP
  async function localizarIp() {
    const ip = $("ipInput").value.trim();
    if (!ip) return showError("ipResult", "Informe um endereço IP.");
    setLoading("ipResult", true);
    try {
      const data = await apiGet(`/geoip/${encodeURIComponent(ip)}`);
      $("ipResult").innerHTML = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
    } catch (e) {
      showError("ipResult", e.message);
    } finally {
      setLoading("ipResult", false);
    }
  }

  // 10. Validador de Email
  async function validarEmail() {
    const email = $("emailInput").value.trim();
    if (!email) return showError("emailResult", "Informe um e-mail.");
    setLoading("emailResult", true);
    try {
      const data = await apiGet(`/email-validator/${encodeURIComponent(email)}`);
      const ok = data.valid_format && data.valid_mx;
      $("emailResult").innerHTML = `
        <div class="result-row"><span class="result-label">Formato</span><span class="result-value">${data.valid_format ? '<span class="msg-success">válido</span>' : '<span class="msg-error">inválido</span>'}</span></div>
        <div class="result-row"><span class="result-label">MX (DNS)</span><span class="result-value">${data.valid_mx ? '<span class="msg-success">válido</span>' : '<span class="msg-error">inválido</span>'}</span></div>
        <div class="result-row"><span class="result-label">Descartável</span><span class="result-value">${data.disposable ? '<span class="msg-error">sim</span>' : '<span class="msg-success">não</span>'}</span></div>
        <div class="result-row"><span class="result-label">Resultado</span><span class="result-value">${ok && !data.disposable ? '<span class="msg-success">aprovado</span>' : '<span class="msg-error">reprovado</span>'}</span></div>
      `;
    } catch (e) {
      showError("emailResult", e.message);
    } finally {
      setLoading("emailResult", false);
    }
  }

  // Bind dos botões
  const actions = {
    faker: gerarPessoas,
    qrcode: gerarQrcode,
    barcode: gerarBarcode,
    validator: validarDocumento,
    extenso: converterExtenso,
    cep: consultarCep,
    currency: consultarMoeda,
    fipeBrands: listarFipe,
    geoip: localizarIp,
    emailValidator: validarEmail,
  };

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fn = actions[btn.dataset.action];
      if (fn) fn();
    });
  });
})();
