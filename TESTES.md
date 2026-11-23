# Testes — LYNKZ Campanhas

Quatro camadas, todas automáticas e sem tocar no banco de produção. O GitHub roda as quatro a cada
push (`.github/workflows/testes.yml`).

| Camada | Comando | O que cobre | Resultado em 18/11/2026 |
|---|---|---|---|
| Regras e scripts | `npm test` | Custo, faixas, CPF, CNPJ, máscaras, valores pt-BR, datas no fuso, Excel; planilhas antigas → linhas; clientes do Qlik (Engine API simulada) | 26 de 26 (v2.3.0) |
| Banco | `npm run test:banco` | Instalação nova, migração v1 → v2 → v2.3 com dados antigos, permissões por papel, triggers, cargas do Qlik e das planilhas, unir empresas, idempotência, rollback | todas ok (v2.3.0) |
| Navegador | `npm run test:e2e` | Todas as telas e fluxos, celular e desktop, acessibilidade (inclusive modo escuro), Excel, modo offline, banco desatualizado | 75 de 75 (v2.3.0) |
| Cloudflare | `npx wrangler deploy --dry-run` | Configuração de publicação válida, 44 arquivos de `public/` | ok |

Além disso, foram feitas checagens manuais nesta rodada:

- **Runtime do Cloudflare** (`wrangler dev`): cabeçalhos de segurança presentes, `sql/`, `tests/`, `dev/`,
  `.md`, `wrangler.jsonc` e `package.json` dão 404, app abre sem nenhum bloqueio de CSP.
- **nginx 1.24** com `deploy/nginx.conf`: `nginx -t` ok, cabeçalhos em todas as rotas, HTTP → HTTPS, app abre.
- **Análise estática** dos 23 módulos: sintaxe, imports apontando para exports existentes, nenhum import sem uso.

---

## Como rodar

**Regras** (só precisa do Node 18+):
```bash
npm test
```

**Banco** (precisa de um PostgreSQL 15+ local; cria e apaga bancos `campanhas_teste_*`):
```bash
npm run test:banco
# ou, se o Postgres for de outro usuário:
PSQL="sudo -u postgres psql" bash tests/banco/rodar.sh
```

**Navegador** (instala o Chromium do Playwright uma vez):
```bash
cd tests/e2e && npm install && npx playwright install chromium && cd ../..
npm run test:e2e                 # todos (≈ 2 min)
node tests/e2e/rodar.mjs gestão  # só os que têm "gestão" no nome
```
Capturas de tela de todas as telas (390 e 1440 px), o Excel gerado e `relatorio.json` ficam em
`tests/e2e/saida/`. Em caso de falha, sai uma captura `FALHA-…png` do momento do erro.

**Ver o app sem banco:**
```bash
npm run dev      # http://localhost:8000/?papel=aprovador  ou  ?papel=coordenador
```

---

## O que os testes de navegador verificam

Rodam contra o Supabase simulado (`dev/supabase-simulado.js`), que imita as regras do banco: só o
aprovador decide, dados Swile só para aprovador e solicitante, balconista da mesma empresa, CPF único.

**Acesso:** login (validação, usuário errado, entrada), "esqueci minha senha" com bloqueio de 60 s,
link expirado, link com `token_hash` (só gasta o código ao confirmar), "Crie sua nova senha" (tamanho,
confirmação, volta ao login), tokens fora da barra de endereço.

**Navegação:** todas as rotas, item do menu marcado, título da aba, rota inválida, Voltar do navegador,
link direto para uma campanha, menu do celular (abre, trava o fundo, fecha com Esc), "Pular para o conteúdo".

**Campanhas e decisão:** contagens por status, busca sem acento e por código, filtro de laboratório,
"Só as minhas", lista e detalhe lado a lado (desktop) ou um de cada vez (celular), dados Swile
protegidos, aprovar → desfazer → aprovar e abrir a próxima, reprovar com motivo obrigatório e motivos
rápidos, Esc sem gravar, reenviar com ajustes.

**Nova campanha:** obrigatórios marcados e foco no primeiro, combo só com teclado, Swile com
balconista preenchendo os 5 dados, edição atualizando o cadastro, empresa com um balconista já
escolhido, "outra pessoa" virando balconista, CPF repetido barrado, empresa cadastrada pelo combo,
rebate e datas, resumo de custo ao vivo, rascunho sem dados pessoais, descartar rascunho, e
**atualização ao vivo de outra campanha sem apagar o que está sendo digitado**.

**Ao vivo:** aviso ao aprovador quando outro coordenador envia campanha.

**Gestão:** lista, busca pelo nome do balconista, desativadas, cadastro com validação e CNPJ
repetido, edição de empresa, cadastro/edição/desativação de balconista, desativação de empresa,
"Nova campanha" a partir da ficha.

**Histórico, Perfil, PWA:** contagens e busca; Excel (1 linha por campanha, 37 colunas, datas e
moeda formatadas); sair apaga o rascunho; faixa "Sem conexão"; service worker guarda o app e ele abre
sem internet; modo escuro.

**Todas as telas em 360, 390, 768, 1024, 1280 e 1440 px:** nenhuma rolagem lateral. Em 390 e
1440 px, auditoria de acessibilidade automática (axe-core, WCAG 2.1 AA) em 20 telas, incluindo login
e diálogo: **0 problemas**.

---

## Problemas encontrados e corrigidos nesta rodada

| Onde | Problema | Correção |
|---|---|---|
| Gestão | Editar empresa ou balconista pelo diálogo não atualizava a ficha na tela: a atualização era ignorada enquanto o diálogo estava aberto e não era refeita depois | A tela agora espera o diálogo fechar e redesenha |
| Service worker | Guardava `index.html`, que o Cloudflare redireciona para `/`; sem internet, a abertura do app falharia | Guarda `./`; versão 2.0.1 para os celulares trocarem o cache |
| Raiz do projeto | `app.js` da v1 (1.107 linhas) esquecido na raiz; `_redirects` só funcionava no Netlify | Removidos; o site agora é só `public/` |
| Código | Dois `export` sem uso (`miniRegua`, `telaAcessoVisivel`) | Viraram funções internas |

Comportamentos conferidos e mantidos como estão (decisão de produto, não erro):
- Coordenador abre Campanhas em "Todas" + "Só as minhas"; aprovador abre em "Pendentes".
- Os filtros da lista valem até fechar o app.

## O que os testes não cobrem

- O Supabase real (rede, e-mails de senha, Realtime de verdade). Use a lista do passo 5 de `PUBLICAR.md` depois de publicar.
- Safari do iPhone (os testes usam Chromium). Vale abrir no iPhone de alguém da equipe antes de avisar todo mundo.
