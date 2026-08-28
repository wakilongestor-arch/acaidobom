# Integrações protegidas — Açaí do Bom

O GitHub Pages publica somente a interface. Tokens da Meta e de gateways **nunca** devem ser colocados em HTML, JavaScript público ou no painel. As funções deste projeto usam Supabase Edge Functions para manter as credenciais protegidas.

## 1. Preparar o banco

Execute `database/migrations/002_integrations.sql` no SQL Editor do Supabase.

## 2. WhatsApp Cloud API da Meta

Crie um aplicativo na Meta for Developers, adicione o produto WhatsApp e obtenha o `Phone Number ID` e um token permanente de usuário do sistema. Depois configure os Secrets:

```bash
supabase secrets set META_WHATSAPP_TOKEN="TOKEN_PERMANENTE"
supabase secrets set META_PHONE_NUMBER_ID="PHONE_NUMBER_ID"
supabase secrets set META_ORDER_RECIPIENT="556993817951"
supabase secrets set META_API_VERSION="v23.0"
supabase functions deploy whatsapp-order
```

No painel, abra **Configurações → WhatsApp Cloud API**, ative a integração e publique. A função sempre envia para o número protegido em `META_ORDER_RECIPIENT`; o cliente não escolhe o destinatário.

Observação: fora da janela de atendimento de 24 horas da Meta, mensagens ao cliente exigem template aprovado. Esta função envia a nota para o WhatsApp interno da loja.

## 3. Gateway/checkout futuro

A função `create-checkout` usa um contrato genérico. Defina a URL da API e o token do provedor:

```bash
supabase secrets set CHECKOUT_API_URL="https://api-do-provedor/checkout"
supabase secrets set CHECKOUT_API_TOKEN="TOKEN_DO_GATEWAY"
supabase functions deploy create-checkout
```

A API deve aceitar `reference`, `amount`, `currency`, `customer`, `items` e `metadata`, e retornar `checkoutUrl` (HTTPS) e, opcionalmente, `id`. Para Mercado Pago, Pagar.me ou Stripe, adapte apenas o corpo da função ao SDK/contrato oficial antes de ativar no painel.

## 4. Teste seguro

Faça um pedido pequeno, confirme se ele aparece na coluna **Novos**, verifique `notification_status` no Supabase e só então habilite para clientes. Se o WhatsApp ou gateway falhar, o pedido continua salvo no painel e não é duplicado.

