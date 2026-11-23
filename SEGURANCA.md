# Segurança: o que o app faz e o que você configura

O código cobre o que dá para cobrir no código (banco, Worker, cabeçalhos, sem CDN). Algumas proteções só existem como configuração nos painéis do Supabase, do Cloudflare e do GitHub. Elas estão na seção 2, em ordem de importância.

## 1. O que já está no código (v2.6.0)

| Camada | Proteção |
|---|---|
| Banco (RLS) | Só usuário **ativo** lê ou grava. Só o aprovador decide. Nada é apagado. Dados Swile só para aprovador e solicitante. Permissão por coluna (o app não grava carimbos, `importada`, código do Qlik) |
| Banco (10) | **Conta nova entra desativada** (a gerência libera). Limites de tamanho de texto e de faixa de valor. Limite de gravações por pessoa por hora. Auditoria de mudança de papel e ativo |
| Worker `/api/qlik/compras` | Exige login do Supabase + perfil ativo. Só aceita POST com JSON de até 2 KB, vindo do próprio site. **20 consultas por minuto por usuário.** Bloqueia busca por expressão (`=`), busca numérica (`<`, `>`) e curinga sozinho (`*`). A mensagem crua do Qlik não vai para a tela. Cabeçalhos de segurança na resposta |
| Navegador | CSP fechada: scripts só do próprio site (supabase-js e SheetJS em `public/vendor/`, sem CDN). Conexão só com o projeto do Supabase do `config.js`. HSTS, COOP, CORP, `X-Frame-Options: DENY`, `nosniff`, Permissions-Policy restrita |
| Código | Todo HTML passa por `html\`\`` (escapa tudo). Nenhum `eval`. Tokens de e-mail saem da barra de endereço |
| Segredos | Chave do Qlik só no Worker (`wrangler secret`). service_role só no `.env` local e nos secrets do GitHub. `.env` e `dados-privados/` fora do Git |
| GitHub | Actions só com leitura do repositório. Dependabot avisa sobre versões com correção de segurança |

## 2. O que você precisa configurar (painéis)

### Supabase → Authentication

1. **Sign In / Providers → Email → "Allow new users to sign up": DESLIGAR.** Hoje está ligado: qualquer pessoa cria conta pelo endereço público. Com a migração 10 ela entra desativada, mas é melhor nem deixar criar. Para cadastrar alguém: Authentication → Users → **Invite user**.
2. **Policies / Passwords:** tamanho mínimo **10**. Exigir letras e números. Se o plano permitir, ligar **"Leaked password protection"** (recusa senhas que já vazaram).
3. **URL Configuration:** *Site URL* = endereço do app. *Redirect URLs* = só o endereço do app, **sem** curinga (`*`).
4. **Rate Limits:** manter os padrões (e-mails por hora, tentativas de login).
5. **Sessions:** se o plano permitir, "Inactivity timeout" de 8 h.
6. **MFA:** ligar o TOTP e pedir aos aprovadores que ativem (o app ainda não tem a tela de MFA; ver o relatório).

### Supabase → banco

- Rodar `sql/migracoes/10-seguranca.sql` e depois `10-validacao.sql` (8 linhas `true`; a 8ª só fica `true` quando existir um aprovador).
- Liberar uma pessoa: `update perfis set ativo = true, nome = 'Nome Sobrenome' where email = '…';`
- Ver quem mudou papel/ativo: `select * from auditoria_perfis order by feito_em desc;`
- Opcional, se houver 2 aprovadores ou mais: `10b-opcional-sem-autoaprovacao.sql` (quem pede não aprova).
- Database → Backups: conferir que o backup diário está ligado.

### Cloudflare

- O limite de 20 consultas/min do Worker já vai no `wrangler.jsonc` (`ratelimits`).
- Opcional: Security → WAF → regra de rate limit em `/api/*` (por IP, ex.: 60/min) e Bot Fight Mode.
- Segredo do Qlik: `npx wrangler secret put QLIK_API_KEY` (nunca no `wrangler.jsonc`).

### GitHub

- Settings → Code security: ligar **Secret scanning** e **Push protection** (bloqueia commit com chave).
- Settings → Branches: proteger a `main` (exigir os testes passando antes do merge).

### Chaves que já circularam

O `.zip` do projeto que foi enviado em 23/11/2026 tinha o `.env` com a **service_role** do Supabase e a **chave de API do Qlik**. Troque as duas:

- Supabase → Project Settings → API Keys → gerar nova secret key e revogar a antiga. Depois atualize o `.env` e o secret `SUPABASE_SERVICE_ROLE_KEY` no GitHub.
- Qlik Cloud → Chaves de API → apagar a antiga e gerar outra. Depois atualize o `.env`, `npx wrangler secret put QLIK_API_KEY` e o secret do GitHub.

Ao compartilhar o projeto, use um zip **sem** `.env`, `dados-privados/` e `node_modules/` (o `git archive` já faz isso: `git archive -o projeto.zip HEAD`).

## 3. Trocar a versão do supabase-js ou do SheetJS

Os dois ficam em `public/vendor/` com a versão no nome (ex.: `supabase-2.119.0.js`):

1. `npm pack @supabase/supabase-js@<versão>` e copie `package/dist/umd/supabase.js` para `public/vendor/supabase-<versão>.js`.
2. Troque o nome no `public/index.html` e no `ARQUIVOS` do `public/sw.js`, e suba a `VERSAO`.
3. `npm test` e `npm run test:e2e` (o lote S confere que nenhum script vem de CDN).
