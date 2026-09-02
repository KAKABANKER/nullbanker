const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const products = [
  {
    name: "Site Institucional",
    slug: "site-institucional",
    shortDesc: "Presença profissional para sua marca ou negócio.",
    description:
      "Site institucional responsivo, com páginas de apresentação, serviços e contato. Ideal para empresas e profissionais que precisam de uma presença online sólida e rápida.",
    price: 497,
    features: [
      "Design responsivo (celular, tablet e desktop)",
      "Até 5 páginas",
      "Formulário de contato",
      "Otimização básica para buscadores (SEO)",
      "Entrega em até 7 dias úteis",
    ],
  },
  {
    name: "Loja Virtual",
    slug: "loja-virtual",
    shortDesc: "E-commerce completo com pagamento integrado.",
    description:
      "Plataforma de vendas online com catálogo de produtos, carrinho, checkout e integração com cartão de crédito e Pix. Painel para você gerenciar pedidos e estoque.",
    price: 1497,
    features: [
      "Catálogo de produtos ilimitado",
      "Checkout com cartão e Pix",
      "Painel de gestão de pedidos",
      "Emails automáticos de confirmação",
      "Suporte na primeira configuração",
    ],
  },
  {
    name: "Landing Page",
    slug: "landing-page",
    shortDesc: "Página única de alta conversão para campanhas.",
    description:
      "Página de captura ou vendas otimizada para conversão, pensada para campanhas de tráfego pago ou lançamentos de produto.",
    price: 297,
    features: [
      "Estrutura orientada a conversão",
      "Integração com pixel de anúncios",
      "Formulário de captura de leads",
      "Entrega em até 3 dias úteis",
    ],
  },
  {
    name: "Sistema Sob Medida",
    slug: "sistema-sob-medida",
    shortDesc: "Aplicação web personalizada para o seu processo.",
    description:
      "Desenvolvimento de sistema web sob medida: dashboards, painéis internos, automações e integrações com APIs de terceiros, de acordo com a necessidade do seu negócio.",
    price: 2997,
    features: [
      "Levantamento de requisitos",
      "Banco de dados dedicado",
      "Painel administrativo",
      "Suporte técnico pós-entrega",
    ],
  },
];

async function main() {
  for (const p of products) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: p,
      create: p,
    });
  }
  console.log(`Seed concluído: ${products.length} produtos.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
