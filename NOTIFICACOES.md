# Aviso de campanha nova para o aprovador (plano — C3 da v2.9)

> **Ainda não está ligado.** A função está pronta em `supabase/functions/avisar-aprovador/`, mas só funciona
> depois dos passos abaixo, que precisam de uma conta de e-mail e de segredos no Supabase. Nada disso foi feito.

## O que faz

Quando alguém envia uma campanha, os **administradores ativos** recebem um e-mail com código, empresa,
laboratório, campanha, quem enviou, custo total (e % da meta) e o link direto para a campanha no app.
Quem enviou não recebe, mesmo que seja administrador. Campanhas importadas das planilhas antigas não avisam.

**Privacidade:** o e-mail **nunca** leva os dados Swile (CPF, e-mail, telefone, nascimento de quem recebe).
O teste `tests/aviso.test.mjs` confere isso.

## Como funciona

```
App → enviar_campanha (insert em campanhas)
        └─ Database Webhook do Supabase (INSERT em public.campanhas)
              └─ Edge Function avisar-aprovador  (confere o segredo do webhook)
                    ├─ lê os administradores ativos (perfis, papel = aprovador)
                    └─ manda o e-mail pelo Resend
```

Se o e-mail falhar, a campanha **continua gravada** (o webhook roda depois do insert). O aprovador
ainda vê a campanha no app, no contador do menu e no aviso de tempo real.

## Custo

R$ 0 no volume da LYNKZ: o plano grátis do Resend manda 3.000 e-mails por mês (100 por dia) e as
Edge Functions do Supabase têm 500 mil chamadas grátis por mês.

## Passo a passo (uns 30 min)

1. **Resend** (resend.com): crie a conta, verifique o domínio `lynkz.com.br` (registros DNS que o TI coloca)
   e gere uma API key só de envio.
2. **Segredos no Supabase** (na pasta do projeto, com `npx supabase login` e `npx supabase link`):
   ```bash
   npx supabase secrets set WEBHOOK_SECRET="<uma frase longa e aleatória>"
   npx supabase secrets set RESEND_API_KEY="<chave do Resend>"
   npx supabase secrets set AVISO_REMETENTE="LYNKZ Campanhas <campanhas@lynkz.com.br>"
   npx supabase secrets set APP_URL="https://campanhas-lynkz.lucas-melonio.workers.dev"
   ```
3. **Publicar a função** (sem exigir login de usuário: quem chama é o webhook, que manda o segredo):
   ```bash
   npx supabase functions deploy avisar-aprovador --no-verify-jwt
   ```
4. **Webhook**: Supabase → Database → Webhooks → *Create a new hook*:
   tabela `campanhas`, evento **Insert**, tipo *Supabase Edge Functions*, função `avisar-aprovador`,
   método POST, cabeçalho `x-webhook-secret` com o mesmo valor do `WEBHOOK_SECRET`.
5. **Testar**: envie uma campanha de teste pelo app. Os administradores ativos devem receber o e-mail
   em até 1 minuto. Erros aparecem em Supabase → Edge Functions → avisar-aprovador → Logs.

**Desligar:** desative o webhook (passo 4). Nada no app depende dele.

## Segunda etapa (depois): aviso no celular (Web Push)

Para o app instalado no celular avisar mesmo fechado:
- gerar um par de chaves VAPID e guardar a pública no `config.js`;
- no Perfil, botão "Receber avisos neste aparelho" (pede permissão e grava a inscrição numa tabela nova,
  `inscricoes_push`, com RLS: cada um só vê as suas);
- o `sw.js` ganha o evento `push` (mostra a notificação) e `notificationclick` (abre `#/campanhas/:id`);
- a mesma Edge Function manda o push para as inscrições dos administradores.

No iPhone, Web Push só funciona com o app **instalado na tela de início** (iOS 16.4 ou mais novo).
