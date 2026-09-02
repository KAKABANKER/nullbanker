function initNav() {
  const toggle = document.querySelector(".navtoggle");
  const nav = document.querySelector("nav.mainnav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => nav.classList.toggle("open"));
  }

  const authSlot = document.querySelector("[data-auth-slot]");
  if (authSlot) {
    const user = API.user();
    if (user) {
      authSlot.innerHTML = `
        <a href="/minha-conta.html">${user.name.split(" ")[0]}</a>
        <a href="#" id="logoutLink" class="btn-ghost-white">Sair</a>
      `;
      const logoutLink = document.getElementById("logoutLink");
      logoutLink.addEventListener("click", (e) => {
        e.preventDefault();
        API.logout();
      });
    } else {
      authSlot.innerHTML = `
        <a href="/login.html">Entrar</a>
        <a href="/registro.html" class="btn-ghost-white">Criar conta</a>
      `;
    }
  }
}

let siteConfig = {};

async function loadSupportLinks() {
  try {
    const config = await API.get("/config");
    siteConfig = config;
    document.querySelectorAll("[data-discord-link]").forEach((el) => {
      if (config.discordUrl) el.href = config.discordUrl;
    });
    document.querySelectorAll("[data-whatsapp-link]").forEach((el) => {
      if (config.whatsappUrl) el.href = config.whatsappUrl;
    });
    document.querySelectorAll("[data-contact-email]").forEach((el) => {
      if (config.contactEmail) {
        el.href = `mailto:${config.contactEmail}`;
        el.textContent = config.contactEmail;
      }
    });
    if (config.announcement) {
      const bar = document.createElement("div");
      bar.className = "announcement-bar";
      bar.innerHTML = `<div class="wrap">${config.announcement}</div>`;
      document.body.prepend(bar);
    }
  } catch (e) {
    // silencioso: se a API não responder, os links mantêm o placeholder
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initNav();
  loadSupportLinks();
});
