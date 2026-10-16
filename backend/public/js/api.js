const API = {
  base: "/api",

  token() {
    return localStorage.getItem("nb_token");
  },

  setToken(token) {
    if (token) localStorage.setItem("nb_token", token);
    else localStorage.removeItem("nb_token");
  },

  setUser(user) {
    if (user) localStorage.setItem("nb_user", JSON.stringify(user));
    else localStorage.removeItem("nb_user");
  },

  user() {
    try {
      return JSON.parse(localStorage.getItem("nb_user"));
    } catch (e) {
      return null;
    }
  },

  async request(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(this.base + path, {
      ...options,
      headers,
      credentials: "include",
    });

    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }

    // Sessão expirada/inválida: limpa o que ficou salvo no navegador e avisa a página.
    if (
      (res.status === 401 && !path.startsWith("/auth/login") && !path.startsWith("/auth/register")) ||
      (res.status === 403 && path.startsWith("/admin"))
    ) {
      this.setToken(null);
      this.setUser(null);
      if (typeof this.onUnauthorized === "function") this.onUnauthorized();
    }

    if (!res.ok) {
      const error = new Error((data && data.error) || "Erro inesperado.");
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  },

  get(path) {
    return this.request(path, { method: "GET" });
  },
  post(path, body) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  },
  put(path, body) {
    return this.request(path, { method: "PUT", body: JSON.stringify(body) });
  },
  del(path) {
    return this.request(path, { method: "DELETE" });
  },

  // Encerra a sessão também no servidor (apaga o cookie httpOnly) — antes só
  // o localStorage era limpo e o cookie continuava valendo.
  async logout(redirectTo = "/login.html") {
    try {
      await fetch(this.base + "/auth/logout", { method: "POST", credentials: "include" });
    } catch (e) {
      /* segue mesmo se o servidor não responder */
    }
    this.setToken(null);
    this.setUser(null);
    window.location.href = redirectTo;
  },
};

// Escapa texto antes de colocar em innerHTML (nomes, e-mails, user-agents etc.
// vêm de terceiros e nunca podem ser tratados como HTML).
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatBRL(value) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}
