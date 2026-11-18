# Publicar — GitHub, Cloudflare e servidor próprio

O app é **só arquivos estáticos**: a pasta `public/` é o site inteiro. Não há etapa de build.
O banco e o login ficam no Supabase, que não muda de lugar em nenhuma das opções abaixo.

Nos exemplos, `campanhas.lynkz.com.br` é o endereço sugerido. Troque pelo que for usar.

| Etapa | Onde | Tempo |
|---|---|---|
| 1. Banco na v2 | Supabase | 15 min (só se ainda não fez a Parte 0 do `COMECE-AQUI.md`) |
| 2. Código no GitHub | github.com | 5 min |
| 3. Site no Cloudflare | dash.cloudflare.com | 10 min |
| 4. Login apontando para o endereço novo | Supabase | 3 min |
| 5. Testar no ar | celular e computador | 10 min |
| 6. Aposentar o Netlify | app.netlify.com | 5 min + 30 dias de redirecionamento |

---

## 1. Banco na v2

Siga a **Parte 0** do `COMECE-AQUI.md` (backup → migrações 04, 05 → validação 06 com 12 linhas `true`).
A v1 continua funcionando no Netlify durante a troca.

---

## 2. Código no GitHub

1. Em **github.com/new**: nome `Campanhas-Lynkz`, **Private**, sem README, sem .gitignore.
2. Envie o código. Esta pasta já é um repositório git com o histórico. Escolha um jeito:

   **GitHub Desktop:** *File → Add local repository* → escolha a pasta → *Publish repository*
   (deixe marcado *Keep this code private*).

   **Terminal:**
   ```bash
   cd Campanhas-Lynkz
   git remote add origin https://github.com/<sua-conta>/Campanhas-Lynkz.git
   git push -u origin main
   ```
3. Confira em **Actions** que o fluxo **testes** rodou e passou (unidade, banco, navegador, Cloudflare).

> A chave do Supabase em `public/config.js` é a pública (*publishable*): ela não abre nada sem login.
> Mesmo assim, mantenha o repositório **privado**. Nunca coloque no repositório a senha do banco nem a
> chave `service_role`.

---

## 3. Site no Cloudflare (Workers, só arquivos estáticos)

1. **dash.cloudflare.com** → *Workers & Pages* → *Create* → *Import a repository*.
2. Conecte a conta do GitHub e escolha `Campanhas-Lynkz`.
3. Configure:
   - **Project name:** `campanhas-lynkz` — **igual** ao `name` do `wrangler.jsonc`. Se forem diferentes, o deploy
     vai para outro Worker e o site no ar não muda.
   - **Build command:** deixe vazio
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** `/`
   - Variáveis: nenhuma (as chaves públicas estão em `public/config.js`)
4. *Save and Deploy*. Em menos de um minuto sai `https://campanhas-lynkz.<sua-conta>.workers.dev` (o atual: `https://campanhas-lynkz.lucas-melonio.workers.dev`).
5. **Domínio da empresa:** no projeto → *Settings* → *Domains & Routes* → *Add* → *Custom domain* →
   `campanhas.lynkz.com.br`. Isso exige que o DNS de `lynkz.com.br` esteja no Cloudflare. Se o DNS estiver
   em outro provedor, use o endereço `workers.dev` ou peça ao TI para mover o DNS.

Daí em diante, **cada push na `main` publica sozinho**. Outros branches geram versões de prévia sem
mexer no site no ar.

**Voltar uma versão:** projeto → *Deployments* → versão anterior → *Rollback*. Leva segundos.

O que o Cloudflare lê do repositório:
- `wrangler.jsonc`: publica só `public/` (`sql/`, `tests/`, `dev/` e os `.md` nunca vão para o ar).
- `public/_headers`: CSP, proteção contra iframe, cache do `sw.js` e do `config.js`.

---

## 4. Login apontando para o endereço novo

Supabase → **Authentication** → **URL Configuration**:

1. **Site URL:** `https://campanhas.lynkz.com.br` (sem barra no final).
2. **Redirect URLs:** adicione `https://campanhas.lynkz.com.br/**`. Durante a transição, **mantenha** também o
   endereço do Netlify, para os links de senha já enviados continuarem valendo.
3. Se trocou o modelo do e-mail de senha (seção "link expirado" do `COMECE-AQUI.md`), ele usa
   `{{ .SiteURL }}`: com o passo 1 feito, os e-mails já saem com o endereço novo.

---

## 5. Testar no ar

- [ ] Abrir o endereço novo no computador: o rodapé do menu mostra **Versão 2.0.1**.
- [ ] Entrar com um coordenador e com o aprovador.
- [ ] Criar uma campanha de teste com Swile e balconista; aprovar; reprovar outra com motivo.
- [ ] Cadastrar e editar uma empresa e um balconista na Gestão.
- [ ] Baixar o Excel no Perfil.
- [ ] Pedir "Esqueci minha senha" e conferir que o link do e-mail abre o endereço **novo**.
- [ ] No celular: instalar (Android: *Instalar aplicativo*; iPhone: *Adicionar à Tela de Início*).
- [ ] F12 → Console: nenhum erro vermelho de "Content Security Policy".

---

## 6. Aposentar o Netlify

O app instalado nos celulares está preso ao endereço antigo (é assim que todo app web funciona).
Por isso:

1. **Avise a equipe:** remover o ícone antigo e instalar de novo pelo endereço novo. Será preciso
   entrar de novo. Rascunhos não enviados no app antigo não passam para o novo.
2. **Redirecione o endereço antigo:** no Netlify, abra o site antigo → *Deploys* → arraste a pasta
   `deploy/netlify-redirecionar/` (troque antes o endereço dentro dos dois arquivos). Quem abrir o link
   antigo cai no novo.
3. Depois de uns 30 dias, tire o endereço do Netlify das *Redirect URLs* do Supabase e apague o site.

---

## 7. Servidor próprio da empresa (TI)

Requisitos: qualquer servidor web que sirva arquivos estáticos **com HTTPS** (sem HTTPS o app não
instala no celular e o Supabase recusa o login).

1. Copie `public/` para o servidor (ex.: `/var/www/lynkz-campanhas/public`).
2. **nginx:** use `deploy/nginx.conf` e `deploy/lynkz-seguranca.conf` (testados com nginx 1.24: mesmos
   cabeçalhos do Cloudflare, `sw.js` e `config.js` sem cache, 404 para arquivos internos).
   **Apache/IIS:** reproduza os cabeçalhos de `public/_headers`. Não é preciso nenhuma regra de reescrita,
   porque as rotas usam `#`.
3. Supabase → URL Configuration: inclua o endereço do servidor (passo 4).
4. **Atualizar:** `git pull` e copie `public/` de novo. Nada a compilar.
5. Se o app passar a ser servido por um domínio do Supabase próprio (self-hosted) ou por outra CDN, libere o
   endereço no CSP (`public/_headers` **e** `deploy/lynkz-seguranca.conf`).

O app continua dependendo de três endereços externos, todos com versão fixa:

| Endereço | Para quê | Se o servidor não tiver internet aberta |
|---|---|---|
| `*.supabase.co` | banco e login | obrigatório |
| `esm.sh` | biblioteca do Supabase (2.119.0) | baixe o arquivo e sirva de `public/vendor/` |
| `cdn.sheetjs.com` | Excel, só ao exportar (0.20.3) | idem |
| `fonts.googleapis.com` / `gstatic` | fonte Instrument Sans | opcional (o app cai na fonte do sistema) |

---

## Toda nova versão

1. Mude o código e rode `npm test` e `npm run test:e2e` (ver `TESTES.md`).
2. Suba `VERSAO` em `public/config.js` **e** em `public/sw.js` (os dois iguais).
3. Mudou o banco? Crie `sql/migracoes/NN-…sql` com rollback, espelhe no `sql/schema.sql` e rode
   `npm run test:banco`. Aplique no Supabase **antes** de publicar o app.
4. `git commit` + `git push`. O GitHub roda os testes e o Cloudflare publica.
