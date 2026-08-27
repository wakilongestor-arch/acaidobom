# Açaí do Bom — GitHub Pages + Supabase

Cardápio digital responsivo com produtos, adicionais por etapas, carrinho, checkout, endereço de entrega, nota personalizada, WhatsApp, PIX, painel administrativo e gestão de pedidos.

## Endereços

- Cardápio: `https://wakilongestor-arch.github.io/acaidobom/`
- Painel: `https://wakilongestor-arch.github.io/acaidobom/sistema/admin/`

## Ativação do Supabase

1. Crie um projeto gratuito em [supabase.com](https://supabase.com/).
2. Abra **SQL Editor**, cole todo o arquivo `database/supabase.sql` e execute.
3. Em **Authentication > Users**, crie o usuário administrador.
4. Em **Authentication > Providers > Email**, desative novos cadastros públicos.
5. Em **Project Settings > API**, copie a **Project URL** e a chave pública **anon**.
6. Abra `assets/js/supabase-config.js` e preencha os dois valores.
7. Acesse o painel e clique em **Publicar alterações** uma vez para enviar o catálogo inicial ao banco.

Nunca coloque a chave `service_role` no código. A chave `anon` é a chave pública correta para o navegador; as regras RLS do arquivo SQL protegem os dados.

## Ativação do GitHub Pages

Em **Settings > Pages > Build and deployment**, escolha **GitHub Actions**. O workflow `Publicar no GitHub Pages` fará a publicação automática a cada alteração na branch `main`.

## Funcionamento dos pedidos

O pedido é salvo no Supabase e aparece no painel. A nota completa também é preparada para confirmação pelo WhatsApp e por e-mail. PIX, dinheiro, cartão na entrega e link de pagamento podem ser configurados no painel.

Para envio de WhatsApp totalmente automático, sem o cliente clicar em confirmar, é necessário conectar uma API oficial do WhatsApp/Meta. O cardápio continua funcionando sem essa integração.
