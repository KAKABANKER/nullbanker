# NULLBANKER

Site de vendas de sites/sistemas, com backend Node.js + Express + PostgreSQL (Prisma),
frontend em HTML/CSS/JS puro (preto e branco), autenticação, checkout com cartão
(Stripe) e Pix (Mercado Pago), e um painel admin com estatísticas, pedidos, visitantes
e log de webhooks.

## Estrutura

```
nullbanker/
├── backend/
│   ├── server.js
│   ├── db.js
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── seed.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── products.js
│   │   ├── orders.js
│   │   ├── admin.js
│   │   └── webhooks.js
│   ├── middleware/
│   │   ├── auth.js
│   │   └── visitTracker.js
│   ├── public/            (frontend: index, produtos, produto, suporte, login, registro, admin...)
│   ├── package.json
│   └── .env.example
├── render.yaml
└── README.md
```

Como o frontend é servido pelo próprio Express (pasta `public`), **não existe processo
de build separado**: um único serviço no Render serve tudo (site + API).

## 1. Rodando localmente

Pré-requisitos: Node.js 18+, um PostgreSQL (local ou na nuvem — pode usar o do Render,
Railway, Neon, Supabase etc).

```bash
cd backend
cp .env.example .env
# edite o .env com sua DATABASE_URL, JWT_SECRET, etc.

npm install
npx prisma migrate dev --name init
npm run prisma:seed     # cria os produtos de exemplo
npm start
```

O site sobe em `http://localhost:3000`. A conta admin definida em `ADMIN_EMAIL` /
`ADMIN_PASSWORD` no `.env` é criada automaticamente no primeiro start — acesse
`/admin.html` para entrar no painel.

> **Já tinha o projeto rodando antes e só atualizou os arquivos?** O schema do banco
> mudou (campo `phone` no usuário e tabela `Settings`). Rode `npm install` de novo
> (para instalar `helmet`, `hpp` e `multer`) e depois `npx prisma migrate dev --name add-settings-and-phone`
> para atualizar as tabelas sem perder os dados existentes.

## 2. Configurando os pagamentos

### Cartão de crédito (Stripe)
1. Crie uma conta em https://dashboard.stripe.com
2. Pegue a **Secret Key** e coloque em `STRIPE_SECRET_KEY`
3. Crie um endpoint de webhook apontando para `https://SEU_DOMINIO/api/webhooks/stripe`,
   ouvindo o evento `checkout.session.completed` (e opcionalmente `checkout.session.expired`,
   `payment_intent.payment_failed`)
4. Copie o **Signing secret** do webhook para `STRIPE_WEBHOOK_SECRET`

### Pix (Mercado Pago)
1. Crie uma aplicação em https://www.mercadopago.com.br/developers
2. Pegue o **Access Token** de produção e coloque em `MP_ACCESS_TOKEN`
3. O código já envia `notification_url` automaticamente apontando para
   `https://SEU_DOMINIO/api/webhooks/mercadopago` — não precisa configurar nada manualmente
   no painel do Mercado Pago para isso funcionar

Sem essas chaves configuradas, o site funciona normalmente, mas o botão de finalizar
pedido retorna um aviso claro de que aquele meio de pagamento ainda não foi configurado
(em vez de simular um pagamento falso).

## 3. Deploy no Render

O jeito mais rápido é usar o `render.yaml` incluído (Render → **New** → **Blueprint**,
apontando para o repositório):

1. Suba este projeto para um repositório no GitHub/GitLab
2. No Render, crie um **Blueprint** a partir do repositório — ele já vai criar o banco
   Postgres e o serviço web automaticamente, usando `render.yaml`
3. Depois do primeiro deploy, preencha as variáveis marcadas como `sync: false` no
   painel do Render (APP_URL, ADMIN_EMAIL, ADMIN_PASSWORD, chaves do Stripe/Mercado
   Pago, links de Discord/WhatsApp)
4. Rode o seed uma vez pelo **Shell** do Render:
   ```
   node prisma/seed.js
   ```

Se preferir criar o serviço manualmente (sem Blueprint): tipo **Web Service**, root
directory `backend`, build command `npm install && npx prisma migrate deploy`, start
command `npm start`, e crie um banco Postgres separado para pegar a `DATABASE_URL`.

## 4. Onde editar o quê

- **Textos e preços dos produtos padrão**: `backend/prisma/seed.js`
- **Links de Discord/WhatsApp**: variáveis `SUPPORT_DISCORD_URL` e `SUPPORT_WHATSAPP_URL`
  no `.env` (aparecem automaticamente no rodapé e na página de suporte)
- **Visual (cores, tipografia, layout)**: `backend/public/css/style.css`
- **Painel admin**: `backend/public/admin.html` + rotas em `backend/routes/admin.js`

## 5. O que o painel admin mostra

- Receita total (pedidos pagos) e contagem de pedidos
- Visitantes registrados por página, com IP e navegador
- Log bruto de cada webhook recebido do Stripe/Mercado Pago (para conferir o que a
  gateway está de fato enviando)
- Lista de pedidos com filtro por status e opção de alterar o status manualmente
- CRUD de produtos com upload de imagem
- Lista de usuários cadastrados, com contagem e detalhe dos pedidos de cada cliente
- **Configurações**: links de Discord/WhatsApp, e-mail de contato e um aviso opcional
  exibido no topo do site — tudo editável sem precisar mexer no `.env` ou fazer
  redeploy

## 6. Sobre a logo

A logo atual está referenciada por um link direto (hotlink) de uma imagem hospedada
no Pinterest. Isso funciona para visualizar, mas tem duas ressalvas:

1. **Não é confiável a longo prazo** — o Pinterest pode bloquear o carregamento em
   outros sites ou remover a imagem a qualquer momento.
2. **Direitos de uso** — se essa imagem não foi criada por você, vale confirmar que
   você tem permissão para usá-la comercialmente como logo antes de publicar o site.

Para hospedar a logo localmente (recomendado): salve o arquivo em
`backend/public/img/logo.png` e troque as ocorrências da URL do Pinterest por
`/img/logo.png` nos arquivos HTML (está no `<a class="logo">` de cada página e no
`<link rel="icon">`).

## 7. Segurança aplicada

- Cabeçalhos de segurança HTTP via `helmet` (proteção contra clickjacking, MIME
  sniffing, etc.)
- Proteção contra HTTP Parameter Pollution via `hpp`
- Limite de requisições por IP (`express-rate-limit`), com limite mais rígido nas
  rotas de login/registro para dificultar força bruta
- Senhas com hash `bcrypt`, nunca armazenadas em texto puro
- CORS restrito ao domínio do site em produção
- Tokens JWT assinados com segredo próprio (`JWT_SECRET`), expiram em 7 dias
- Todas as consultas ao banco passam pelo Prisma (parametrizadas), sem risco de
  SQL injection por concatenação de string
