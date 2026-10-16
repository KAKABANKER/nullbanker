function initNav() {
  const toggle = document.querySelector(".navtoggle");
  const nav = document.querySelector("nav.mainnav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    // Fecha o menu ao tocar em um link (mobile)
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) nav.classList.remove("open");
    });
  }

  const authSlot = document.querySelector("[data-auth-slot]");
  if (!authSlot) return;

  const user = API.user();
  const html = user
    ? `<a href="/minha-conta.html">${esc(String(user.name || "").split(" ")[0] || "Minha conta")}</a>
       <a href="#" data-logout class="btn-ghost-white">Sair</a>`
    : `<a href="/login.html">Entrar</a>
       <a href="/registro.html" class="btn-ghost-white">Criar conta</a>`;
  authSlot.innerHTML = html;

  // No celular as ações de conta ficam dentro do menu aberto.
  if (nav) {
    const mobile = document.createElement("div");
    mobile.className = "nav-auth-mobile";
    mobile.innerHTML = html;
    nav.appendChild(mobile);
  }

  document.querySelectorAll("[data-logout]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      API.logout();
    });
  });
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
      const inner = document.createElement("div");
      inner.className = "wrap";
      inner.textContent = config.announcement;
      bar.appendChild(inner);
      document.body.prepend(bar);
    }
  } catch (e) {
    // silencioso: se a API não responder, os links mantêm o placeholder
  }
}

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

document.addEventListener("DOMContentLoaded", () => {
  initNav();
  loadSupportLinks();
  initScrollAnimations();
});
