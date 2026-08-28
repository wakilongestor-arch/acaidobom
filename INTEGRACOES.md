# Integrações protegidas — Açaí do Bom

O GitHub Pages publica somente a interface. Tokens da Meta e de gateways **nunca** devem ser colocados em HTML, JavaScript público ou no painel. As funções deste projeto usam Supabase Edge Functions para manter as credenciais protegidas.

## 1. Preparar o banco

Execute, nesta ordem, no SQL Editor do Supabase:

1. `database/migrations/002_integrations.sql`
2. `database/migrations/003_make_order_automation.sql`

A migração 003 cria as configurações privadas, o histórico dos webhooks, os indicadores de envio de e-mail e a permissão administrativa para excluir pedidos.

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

<a id="make-mailgun"></a>

## 4. Make + Mailgun para e-mails automáticos

O fluxo é automático: o cardápio salva o pedido, a função protegida `order-email` envia os dados ao webhook do Make e o módulo Mailgun dispara o e-mail. O pedido continua salvo mesmo se a automação estiver temporariamente fora do ar.

### 4.1 Publicar a função protegida

No terminal conectado ao projeto Supabase:

```bash
supabase functions deploy order-email --no-verify-jwt
```

Essa função precisa aceitar o pedido público recém-criado. Por isso a verificação padrão do gateway é desativada somente nela; o próprio código limita a notificação inicial a pedidos recentes, impede duplicidade e exige uma sessão administrativa válida para teste e mudanças de status.

As variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas automaticamente pelo Supabase à Edge Function. Não coloque a chave `service_role` no GitHub nem no painel.

### 4.2 Criar o cenário no Make

1. No Make, crie um cenário novo.
2. Adicione **Webhooks → Custom webhook** e dê o nome `Açaí do Bom - Pedidos`.
3. Copie a URL gerada. Ela começa com `https://hook...make.com/`.
4. Adicione o módulo **Mailgun → Send an Email** logo depois do webhook.
5. Conecte a conta Mailgun usando a chave privada da API.
6. Mapeie os campos recebidos desta forma:

| Campo no Mailgun | Campo recebido do webhook |
|---|---|
| From | `email.from` |
| To | `email.to` |
| Reply-To | `email.replyTo` |
| Subject | `email.subject` |
| HTML | `email.html` |
| Text | `email.text` |

7. Salve o cenário e deixe-o **ON**. Ative o processamento sequencial do webhook para preservar a ordem das mensagens em momentos de muitos pedidos.

Não é necessário criar vários cenários. O mesmo módulo usa o campo dinâmico `email.to`: em `order.created` ele envia a nota completa à loja; nas mudanças de status ele envia a atualização personalizada ao cliente.

### 4.3 Conectar pelo painel

1. Entre em `https://acaidobom.com.br/sistema/admin/`.
2. Abra **Configurações → E-mails automáticos · Make + Mailgun**.
3. Cole a URL copiada do Make, ative a automação e clique em **Publicar alterações**.
4. Clique em **Testar webhook** e confira a execução no Make e o e-mail no Mailgun.

A URL fica em `private_settings`, protegida pelas regras do Supabase. Ela não é enviada ao navegador dos clientes e não faz parte do catálogo público.

### 4.4 Eventos enviados

| Evento | Destinatário | Quando acontece |
|---|---|---|
| `integration.test` | Loja | Botão Testar webhook |
| `order.created` | Loja | Cliente finaliza o pedido |
| `order.confirmed` | Cliente | Administrador confirma o pedido |
| `order.preparing` | Cliente | Pedido entra em preparo |
| `order.out_for_delivery` | Cliente | Pedido sai para entrega |
| `order.completed` | Cliente | Pedido é concluído |
| `order.cancelled` | Cliente | Pedido é cancelado |
| `order.payment_paid` | Cliente | Pagamento é confirmado separadamente |
| `order.payment_refunded` | Cliente | Pagamento é estornado |

Cada chamada também inclui `order`, `customer`, `address`, `items`, `totals`, a nota em texto e o e-mail pronto em HTML. O histórico em `order_webhook_events` impede duplicidade da mesma atualização e permite auditoria.

### 4.5 Configurar o domínio no Mailgun

Cadastre e valide um domínio de envio no Mailgun antes de usar um remetente `@acaidobom.com.br`. Se estiver usando apenas o domínio sandbox do Mailgun, os destinatários também precisam estar autorizados no sandbox. Depois de validar o domínio, use em **E-mail dos pedidos** no painel um endereço pertencente a esse domínio.

## 5. Teste seguro

Faça um pedido pequeno e confirme este roteiro:

1. O pedido aparece em **Pedidos → Hoje → Novos**.
2. O e-mail da nota chega à loja automaticamente.
3. Ao clicar em **Confirmar pedido**, o card pula para **Confirmados**.
4. O cliente recebe o e-mail personalizado de confirmação.
5. Ao marcar como pago, a identificação visual muda imediatamente.
6. A exclusão só acontece depois da confirmação no painel.

Para WhatsApp, verifique também `notification_status`. Para e-mail, verifique `store_email_status`, `customer_email_status` e `order_webhook_events`. Se WhatsApp, Make, Mailgun ou gateway falhar, o pedido continua salvo no painel.
