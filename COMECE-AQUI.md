# Comece aqui

App de aprovação de campanhas promocionais. Leva uns **30 minutos** para colocar no ar.
Não precisa saber programar e não precisa instalar nada no computador.

Custo: **R$ 0**. O volume de 5 coordenadores cabe folgado nos planos gratuitos.

---

## Parte 0 — Já usa a v1? Atualize para a v2 (20 min)

Pule esta parte se for uma instalação nova (vá para a Parte 1).

**Antes de tudo, o backup.** Supabase → **Database** → **Backups** e confira que há um backup de hoje
(no plano gratuito, exporte as tabelas `campanhas` e `perfis` em CSV pelo **Table Editor** → **Export**).

Depois, no **SQL Editor**, rode um arquivo por vez, na ordem (abra no bloco de notas, copie tudo, cole e **Run**):

1. `sql/migracoes/04-gestao-empresas-balconistas.sql` — cria empresas e balconistas. Deve dar `Success`.
2. `sql/migracoes/05-data-decisao-fuso.sql` — data da decisão no horário do Maranhão.
3. `sql/migracoes/06-validacao-v2.sql` — só confere. Precisa mostrar **12 linhas com `ok = true`**.
4. (Recomendado) `sql/migracoes/03-validacao.sql` — testa as regras fingindo ser cada tipo de usuário
   e desfaz tudo no final. Todas as linhas `ok = true`.

A v1 continua funcionando depois disso (as colunas novas são opcionais). Então publique a pasta nova
no Netlify (Parte 3, arrastando por cima do site que já existe) e abra o app no celular: o rodapé do
menu e do Perfil deve mostrar **Versão 2.0.0**. Se não mudar, feche e abra o app de novo.

**Deu errado? Volta atrás:** publique de novo a pasta da v1 e rode, nesta ordem,
`sql/migracoes/05-rollback.sql` e `sql/migracoes/04-rollback.sql`. Atenção: o rollback da 04 apaga as
empresas e balconistas cadastrados (as campanhas ficam intactas, com o nome em "cliente").

**Se alguma tela não carregar depois de publicar**, abra o console do navegador (F12): erro de
"Content Security Policy" quer dizer que falta liberar um endereço no arquivo `_headers`.

---

## Parte 1 — Criar o banco de dados (10 min)

1. Entre em **supabase.com** e crie uma conta (pode ser com a conta Google da empresa).
2. Clique em **New project**.
   - **Name:** `campanhas`
   - **Database Password:** deixe ele gerar uma e **guarde num lugar seguro** — você quase nunca vai usar, mas não dá para recuperar depois.
   - **Region:** escolha `South America (São Paulo)`, que é a mais perto.
3. Espere uns 2 minutos enquanto ele cria.
4. No menu da esquerda, clique em **SQL Editor** → **New query**.
5. Abra o arquivo `sql/schema.sql` num bloco de notas, **copie tudo** e cole ali.
6. Clique em **Run**. Deve aparecer `Success`. Pronto, o banco está montado.

---

## Parte 2 — Pegar as duas chaves (2 min)

1. Menu da esquerda → **Project Settings** (a engrenagem) → **Data API**.
2. Copie a **Project URL**. É algo como `https://abcdefgh.supabase.co`.
3. Ainda em Project Settings, vá em **API Keys** e copie a chave **anon** (às vezes aparece como *publishable*). É um texto longo.
4. Abra o arquivo **`config.js`** num bloco de notas e cole os dois valores nos lugares indicados:

```js
SUPABASE_URL: "https://abcdefgh.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
```

Salve o arquivo.

> **Essa chave pode ficar visível?** Pode. Ela sozinha não abre nada. Quem controla o acesso são
> as regras que você acabou de instalar no banco: sem login válido, ela não devolve um único dado.

---

## Parte 3 — Publicar o app (5 min)

1. Junte todos os arquivos desta pasta num único ZIP, ou deixe a pasta pronta.
2. Entre em **app.netlify.com/drop**.
3. **Arraste a pasta inteira** para dentro da página. Só isso.
4. Em segundos ele devolve um endereço tipo `https://algo-aleatorio.netlify.app`.
5. Clique em **Site configuration → Change site name** para trocar por algo decente, tipo
   `campanhas-suaempresa`. O endereço vira `https://campanhas-suaempresa.netlify.app`.

Guarde esse endereço: é o seu app.

---

## Parte 4 — Liberar o login por e-mail (3 min)

1. Volte no Supabase → **Authentication** → **URL Configuration**.
2. Em **Site URL**, cole o endereço do Netlify (`https://campanhas-suaempresa.netlify.app`).
3. Em **Redirect URLs**, adicione o mesmo endereço.
4. Salve.
5. Vá em **Authentication** → **Sign In / Providers** e **desligue "Allow new users to sign up"**.
   Salve.

> Os passos 1–4 fazem o link de redefinição de senha funcionar. O passo 5 é segurança: com o
> cadastro aberto, qualquer pessoa na internet consegue criar uma conta e entrar como
> coordenador. Com ele desligado, só você cadastra gente (Parte 5).

---

## Parte 5 — Virar o aprovador (2 min)

1. No Supabase → **Authentication** → **Users** → **Add user** → **Create new user**: seu e-mail,
   uma senha e marque **Auto Confirm User**.
2. Abra o app e entre com esse e-mail e senha.
3. Volte no Supabase → **SQL Editor** → **New query** e rode isto, trocando pelo seu e-mail:

```sql
update perfis set papel = 'aprovador' where email = 'seu.email@empresa.com.br';
```

4. No app, saia e entre de novo. Agora você é o aprovador — só você vê os botões de decisão.

> **Todo mundo que entra vira coordenador automaticamente.** Só quem você promover com esse
> comando pode aprovar. É proposital: assim ninguém libera verba por engano.

---

## Parte 6 — Instalar no celular (1 min)

Mande o endereço para os 5 coordenadores. Cada um faz o seguinte:

**Android (Chrome):** abrir o link → menu de três pontinhos → **Instalar aplicativo**.

**iPhone (Safari):** abrir o link → botão de compartilhar (o quadradinho com a seta) →
**Adicionar à Tela de Início**.

O ícone fica na tela junto com os outros apps, abre em tela cheia e ninguém percebe que é um site.

---

## Como funciona no dia a dia

O coordenador abre o app e toca no **+**. Escolhe a empresa (ou cadastra na hora), preenche e envia.
Com pagamento Swile, escolhe o balconista da empresa e os dados de quem recebe vêm preenchidos.

No seu celular, **Início** mostra a fila e o botão **Revisar a mais antiga**. A tela de detalhe tem
o custo total e a régua de meta. **Aprovar** espera 5 segundos (dá para tocar em *Desfazer*) e já
abre a próxima. **Reprovar** pede o motivo — tem motivos prontos — e o coordenador lê depois.

**Gestão** tem as empresas e os balconistas (qualquer usuário ativo cadastra e edita; nada é
apagado, só desativado). O **Histórico** guarda tudo que já foi decidido. Em **Perfil**, o botão
baixa o Excel com investimento LYNKZ, indústria, rebate estimado, custo total, CNPJ e o motivo de
cada reprova.

---

## Regras que estão travadas no banco (ninguém contorna)

- Só quem tem papel de `aprovador` consegue mudar o status. Um coordenador que tente fazer isso
  pelo navegador recebe erro do próprio banco de dados.
- Toda campanha nasce como **Pendente**. Não dá para criar algo já aprovado.
- Uma campanha já decidida **não pode ser decidida de novo**. Se tentar, o banco recusa.
- Reprova **sem motivo** é bloqueada.
- **Nada pode ser apagado.** O histórico é permanente.
- Quem aprovou e em que data são carimbados pelo banco, não pelo app — não tem como falsificar.

---

## Perguntas que vão aparecer

**Entrou um coordenador novo.** Supabase → **Authentication** → **Users** → **Add user** →
**Send invitation** (ele recebe um e-mail para criar a senha) ou **Create new user** (você define
uma senha provisória e ele troca depois em "Esqueci minha senha"). Ele entra como coordenador.

**Um coordenador saiu da empresa.** No Supabase → **Table Editor** → tabela `perfis` → desmarque
`ativo` na linha dele. Ele perde o acesso na hora — o banco recusa consultas e solicitações de
quem está desativado, não só a tela (desde a Parte A da migração de segurança, aplicada em 27/10/2026).

**Quero mudar as faixas de cor.** Abra o `config.js`, mude `FAIXA_VERDE` e `FAIXA_AMARELA`
(`0.08` é 8%) e publique de novo arrastando a pasta no Netlify.

**A marca oficial já está aplicada.** O vermelho do sistema é o `#E11F1C`, amostrado do arquivo
original da logo. Se a marca mudar, troque o `assets/logo.png` e rode de novo o passo que gera os ícones.

**Quero mudar as cores da marca.** Abra o `css/tokens.css`. Ele concentra todas as cores (claro
e escuro), cantos arredondados e sombras. Mudar `--red` ali troca a cor de ação do app inteiro.

**Quero adicionar um laboratório.** Mesma coisa: `config.js`, lista `LABORATORIOS`.

**Perdi tudo?** Não. Os dados ficam no Supabase, não no app. Republicar o site não apaga nada.

**Chega notificação empurrada no celular?** Ainda não. Hoje o app avisa quando está aberto, e a
bolinha vermelha mostra a fila quando você abre. Push de verdade é o próximo passo — o caminho
mais simples é um e-mail automático para você a cada campanha nova.

**Alguém esqueceu a senha.** Na tela de acesso, a pessoa toca em **Esqueci minha senha**, digita
o e-mail e recebe um link. O link abre a tela **Crie sua nova senha** e depois pede login com a
senha nova. O link vale por tempo limitado (padrão: 1 hora) e funciona uma vez só; se pedir dois,
só o mais recente vale. Você também pode disparar pelo Supabase → **Authentication** → **Users**
→ menu da linha → **Send password recovery**.

**O link de senha abre dizendo "expirado" mesmo clicado na hora.** Antivírus de e-mail
corporativo (Outlook/Microsoft Defender, Mimecast etc.) costumam "visitar" o link antes da pessoa
e gastam o uso único. A solução é trocar o modelo do e-mail para que o código só seja gasto
quando a pessoa tocar num botão dentro do app: Supabase → **Authentication** → **Emails** →
**Reset Password** → apague o conteúdo do campo **Body** e cole:

```html
<h2>Redefinir senha</h2>
<p>Recebemos um pedido para criar uma nova senha no app LYNKZ Campanhas.</p>
<p><a href="{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=recovery">Criar nova senha</a></p>
<p>O link vale por tempo limitado e funciona uma única vez. Se você não pediu,
ignore este e-mail: sua senha atual continua valendo.</p>
```

Salve. Para funcionar, o **Site URL** (Authentication → URL Configuration) precisa ser
exatamente `https://lynkz-campanhas.netlify.app`, **sem barra no final**. O app entende
os dois formatos de link, o padrão e este.

---

## Arquivos desta pasta

| Arquivo | O que é |
|---|---|
| `config.js` | **O que você edita no dia a dia:** chaves, marca, versão e listas |
| `index.html` | A casca das telas |
| `css/` | O sistema visual (`tokens.css` tem todas as cores) |
| `js/` | A lógica: login, telas, cálculos, aprovação, cadastro, Excel |
| `sql/schema.sql` | O banco de dados completo, para instalação nova |
| `sql/migracoes/` | Atualizações do banco, com volta atrás e validação |
| `manifest.json`, `sw.js` | O que faz virar app instalável |
| `_headers`, `_redirects` | Segurança no Netlify (não publicam `sql/`, `tests/`, `dev/` nem os `.md`) |
| `assets/` | Logo e ícones |
| `tests/`, `dev/` | Testes e simulador para quem mexe no código (ver `CLAUDE.md`) |
