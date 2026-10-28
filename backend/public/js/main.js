/* =====================================================================
   NULLBANKER — comportamento comum a todas as páginas públicas
   (menu, sessão, modal de login/cadastro, tema e animações)
   ===================================================================== */

// true  = o modal de entrada NÃO pode ser fechado (site só navega logado)
// false = aparece uma vez por visita, mas dá para fechar e continuar vendo o site.
// Comprar e baixar exigem login em qualquer um dos dois modos.
const FORCE_LOGIN_ON_ENTRY = false;

const NB = {};

/* ---------- utilidades ---------- */

// Só aceita destino interno (evita redirecionar para outro site depois do login).
function safeNext(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return url.pathname + url.search + url.hash;
  } catch (e) {
    return null;
  }
}

function isLoggedIn() {
  return !!(API.token() && API.user());
}

/* ---------- menu e área de conta ---------- */

function renderAuthSlot() {
  const authSlot = document.querySelector("[data-auth-slot]");
  const nav = document.querySelector("nav.mainnav");
  if (!authSlot) return;

  const user = API.user();
  const html = user
    ? `<a href="/minha-conta.html">${esc(String(user.name || "").split(" ")[0] || "Minha conta")}</a>
       ${user.isAdmin ? '<a href="/admin.html">Painel</a>' : ""}
       <a href="#" data-logout class="btn-ghost-white">Sair</a>`
    : `<a href="#" data-open-login>Entrar</a>
       <a href="#" data-open-register class="btn-ghost-white">Criar conta</a>`;
  authSlot.innerHTML = html;

  // No celular as ações de conta ficam dentro do menu aberto.
  if (nav) {
    let mobile = nav.querySelector(".nav-auth-mobile");
    if (!mobile) {
      mobile = document.createElement("div");
      mobile.className = "nav-auth-mobile";
      nav.appendChild(mobile);
    }
    mobile.innerHTML = html;
  }

  document.querySelectorAll("[data-logout]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      API.logout("/");
    });
  });
  document.querySelectorAll("[data-open-login]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      NB.openAuth({ mode: "login" });
    });
  });
  document.querySelectorAll("[data-open-register]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      NB.openAuth({ mode: "register" });
    });
  });
}

function initNav() {
  const toggle = document.querySelector(".navtoggle");
  const nav = document.querySelector("nav.mainnav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) nav.classList.remove("open");
    });
  }
  renderAuthSlot();
}

/* ---------- rodapé com a logo ---------- */

function initFooterBrand() {
  document.querySelectorAll("footer .wrap").forEach((wrap) => {
    if (wrap.querySelector(".footer-brand")) return;
    const brand = document.createElement("div");
    brand.className = "footer-brand";
    brand.innerHTML = `<img src="/img/logo.png" data-fallback="/img/logo.svg" alt="NullBanker" /><span class="logo-text">NULLBANKER</span>`;
    wrap.prepend(brand);
  });
  setupImageFallbacks();
}

/* ---------- modal de login / cadastro ---------- */

function buildAuthModal() {
  if (document.getElementById("authModal")) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "authModal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "authModalTitle");
  overlay.innerHTML = `
    <div class="modal-box auth-modal">
      <button type="button" class="modal-close" id="authClose" aria-label="Fechar">×</button>
      <img class="auth-modal-logo" src="/img/logo.png" data-fallback="/img/logo.svg" alt="NullBanker" />
      <h3 id="authModalTitle">Entre para continuar</h3>
      <p class="auth-modal-hint" id="authHint"></p>
      <div class="tabs auth-tabs">
        <button type="button" data-mode="login" class="active">Entrar</button>
        <button type="button" data-mode="register">Criar conta</button>
      </div>
      <div class="msg" id="authMsg"></div>
      <form id="authForm" novalidate>
        <div class="field" data-only="register"><label for="authName">Nome completo</label><input type="text" id="authName" autocomplete="name" /></div>
        <div class="field"><label for="authEmail">E-mail</label><input type="email" id="authEmail" autocomplete="email" /></div>
        <div class="field" data-only="register"><label for="authPhone">Telefone (opcional)</label><input type="tel" id="authPhone" autocomplete="tel" /></div>
        <div class="field"><label for="authPassword">Senha</label><input type="password" id="authPassword" autocomplete="current-password" /></div>
        <button type="submit" class="btn btn-primary btn-block" id="authSubmit">Entrar</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  setupImageFallbacks();

  overlay.querySelectorAll(".auth-tabs button").forEach((btn) =>
    btn.addEventListener("click", () => setAuthMode(btn.dataset.mode))
  );
  document.getElementById("authClose").addEventListener("click", closeAuth);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && overlay.dataset.dismissible === "1") closeAuth();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open") && overlay.dataset.dismissible === "1") closeAuth();
  });
  document.getElementById("authForm").addEventListener("submit", submitAuth);
}

let authState = { mode: "login", onSuccess: null };

function setAuthMode(mode) {
  authState.mode = mode;
  const overlay = document.getElementById("authModal");
  overlay.querySelectorAll(".auth-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  overlay.querySelectorAll("[data-only='register']").forEach((el) => (el.style.display = mode === "register" ? "block" : "none"));
  document.getElementById("authSubmit").textContent = mode === "register" ? "Criar conta" : "Entrar";
  document.getElementById("authPassword").autocomplete = mode === "register" ? "new-password" : "current-password";
  document.getElementById("authModalTitle").textContent = mode === "register" ? "Crie sua conta" : "Entre para continuar";
  const msg = document.getElementById("authMsg");
  msg.className = "msg";
  msg.textContent = "";
}

NB.openAuth = function ({ mode = "login", hint = "", onSuccess = null, dismissible = true } = {}) {
  buildAuthModal();
  const overlay = document.getElementById("authModal");
  authState.onSuccess = onSuccess;
  overlay.dataset.dismissible = dismissible ? "1" : "0";
  document.getElementById("authClose").style.display = dismissible ? "flex" : "none";
  document.getElementById("authHint").textContent = hint;
  setAuthMode(mode);
  overlay.classList.add("open");
  document.body.classList.add("modal-open");
  setTimeout(() => document.getElementById(mode === "register" ? "authName" : "authEmail").focus(), 60);
};

function closeAuth() {
  const overlay = document.getElementById("authModal");
  if (!overlay) return;
  overlay.classList.remove("open");
  document.body.classList.remove("modal-open");
}

async function submitAuth(e) {
  e.preventDefault();
  const msg = document.getElementById("authMsg");
  const btn = document.getElementById("authSubmit");
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const register = authState.mode === "register";
  msg.className = "msg";
  msg.textContent = "";

  const fail = (text) => {
    msg.textContent = text;
    msg.className = "msg error";
  };
  if (!email || !password) return fail("Preencha e-mail e senha.");
  if (register && !document.getElementById("authName").value.trim()) return fail("Informe seu nome.");
  if (register && password.length < 6) return fail("A senha precisa ter ao menos 6 caracteres.");

  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Aguarde...";
  try {
    const body = register
      ? { name: document.getElementById("authName").value.trim(), email, phone: document.getElementById("authPhone").value.trim(), password }
      : { email, password };
    const data = await API.post(register ? "/auth/register" : "/auth/login", body);
    API.setToken(data.token);
    API.setUser(data.user);
    closeAuth();
    document.getElementById("authForm").reset();
    renderAuthSlot();
    if (authState.onSuccess) authState.onSuccess(data.user);
    else window.location.reload();
  } catch (err) {
    fail(err.message || "Não foi possível continuar.");
    btn.disabled = false;
    btn.textContent = label;
    return;
  }
  btn.disabled = false;
  btn.textContent = label;
}

// Exige login antes de continuar (comprar / baixar). Depois do login, segue direto
// para a ação que o visitante queria, sem perder a página.
NB.requireLogin = function (hint, callback) {
  if (isLoggedIn()) return callback(API.user());
  NB.openAuth({ mode: "login", hint, onSuccess: callback });
};

// Sessão expirada em qualquer chamada da API: pede login de novo.
API.onUnauthorized = () => {
  renderAuthSlot();
  NB.openAuth({ mode: "login", hint: "Sua sessão expirou. Entre novamente para continuar." });
};

// Baixa um produto (grátis com login, ou comprado). O link só é entregue pelo servidor
// depois de conferir o direito de acesso.
NB.download = async function (productId, button) {
  NB.requireLogin("Entre ou crie uma conta para baixar.", async () => {
    const original = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "Liberando..."; }
    try {
      const { url } = await API.get(`/downloads/${productId}`);
      window.location.href = url;
      toast("Download liberado. Ele fica no seu histórico em Minha conta.", "success");
    } catch (err) {
      toast(err.message || "Não foi possível baixar.", "error");
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  });
};

/* ---------- configuração pública (links, aviso, tema) ---------- */

let siteConfig = {};

function shade(hex, amount) {
  // amount > 0 clareia (mistura com branco); amount < 0 escurece (mistura com preto)
  const n = parseInt(hex.slice(1), 16);
  const target = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  const ch = (v) => Math.round(v + (target - v) * k);
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function applyTheme(cfg) {
  const root = document.documentElement;
  if (cfg.themeAccent && /^#[0-9a-f]{6}$/i.test(cfg.themeAccent)) {
    root.style.setProperty("--gold", cfg.themeAccent);
    root.style.setProperty("--gold-l", shade(cfg.themeAccent, 0.32));
    root.style.setProperty("--gold-d", shade(cfg.themeAccent, -0.35));
  }
  if (cfg.siteName) {
    document.querySelectorAll(".logo-text").forEach((el) => (el.textContent = cfg.siteName.toUpperCase()));
    document.title = document.title.replace(/NULLBANKER/gi, cfg.siteName);
  }
  if (cfg.logoUrl) {
    document.querySelectorAll(".logo img, .footer-brand img, .auth-modal-logo").forEach((img) => (img.src = cfg.logoUrl));
    const fav = document.querySelector('link[rel="icon"]');
    if (fav) fav.href = cfg.logoUrl;
  }
}

async function loadSiteConfig() {
  try {
    const cached = JSON.parse(localStorage.getItem("nb_config") || "null");
    if (cached) applyTheme(cached);
  } catch (e) { /* sem cache */ }

  try {
    const config = await API.get("/config");
    siteConfig = config;
    localStorage.setItem("nb_config", JSON.stringify({
      themeAccent: config.themeAccent, siteName: config.siteName, logoUrl: config.logoUrl,
    }));
    applyTheme(config);

    document.querySelectorAll("[data-discord-link]").forEach((el) => { if (config.discordUrl) el.href = config.discordUrl; });
    document.querySelectorAll("[data-whatsapp-link]").forEach((el) => { if (config.whatsappUrl) el.href = config.whatsappUrl; });
    document.querySelectorAll("[data-contact-email]").forEach((el) => {
      if (config.contactEmail) {
        el.href = `mailto:${config.contactEmail}`;
        el.textContent = config.contactEmail;
      }
    });
    if (config.announcement && !document.querySelector(".announcement-bar")) {
      const bar = document.createElement("div");
      bar.className = "announcement-bar";
      const inner = document.createElement("div");
      inner.className = "wrap";
      inner.textContent = config.announcement;
      bar.appendChild(inner);
      document.body.prepend(bar);
    }
  } catch (e) {
    // silencioso: sem API os links mantêm o valor padrão
  }
}

/* ---------- animações de rolagem ---------- */

function initScrollAnimations() {
  const targets = document.querySelectorAll("section:not(.hero) > .wrap > *, .fade-in-up");
  targets.forEach((el) => el.classList.add("fade-in-up"));

  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("in-view"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  targets.forEach((el) => observer.observe(el));
}

/* ---------- modal de entrada (uma vez por visita) ---------- */

function maybeShowEntryModal() {
  const page = window.location.pathname;
  if (isLoggedIn()) return;
  if (/\/(login|registro)(\.html)?$/.test(page)) return;
  if (sessionStorage.getItem("nb_entry_seen")) return;
  sessionStorage.setItem("nb_entry_seen", "1");
  setTimeout(() => {
    // Se a pessoa já abriu o login (ex.: clicou em Comprar), não troca o modal nem apaga a ação dela.
    const modal = document.getElementById("authModal");
    if (isLoggedIn() || (modal && modal.classList.contains("open"))) return;
    NB.openAuth({
      mode: "login",
      hint: "Entre ou crie sua conta para comprar e baixar sites.",
      dismissible: !FORCE_LOGIN_ON_ENTRY,
    });
  }, 1500);
}

document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initFooterBrand();
  loadSiteConfig();
  initScrollAnimations();
  maybeShowEntryModal();
});
