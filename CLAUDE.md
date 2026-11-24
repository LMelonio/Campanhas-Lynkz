# Projeto: Aprovação de Campanhas Promocionais — LYNKZ (v2.4)

App de celular e computador (PWA) onde coordenadores de campo solicitam campanhas promocionais
para empresas clientes e a gerência aprova ou reprova. Empresas e balconistas ficam cadastrados.
Tudo fica registrado e exporta para Excel.

## Stack

HTML, CSS e JavaScript puros, em módulos ESM. **Sem framework e sem etapa de build:** o que está em
`public/` é exatamente o que vai para o ar. O `package.json` da raiz só traz ferramentas (wrangler para
publicar, scripts de teste); o app não depende de nenhum pacote npm.
Banco e autenticação: Supabase (`public/js/lib/supabase.js`, versão fixa via esm.sh).
Publicação: GitHub → Cloudflare Workers (só arquivos estáticos, `wrangler.jsonc`). Ver `PUBLICAR.md`.
Servidor próprio da empresa: qualquer servidor web servindo `public/` (ver `deploy/nginx.conf`).

Essa simplicidade é proposital: quem mantém o projeto não é desenvolvedor.
**Não introduza React, Vue, Tailwind, bundler ou etapa de build sem que seja pedido.**

## Arquivos

```
public/                  ← TUDO que vai para o ar (raiz do site)
  index.html             só a casca: #splash, #acesso, #app (topo, menu, conteúdo, barra inferior)
  config.js              chaves do Supabase, marca, VERSAO e listas dos menus. O usuário edita este.
  manifest.json  sw.js  _headers (CSP e cache; lido pelo Cloudflare)
  assets/                logo.png, logo-branca.png, icon-*.png
  css/  tokens.css (ÚNICO lugar com cor)  base.css (casca)  componentes.css  telas.css
  js/   app.js (rotas e ctx)  acesso.js (login e senha)  exportar.js (Excel)
        lib/    regras.js (funções puras)  dom.js (html``)  supabase.js  url-auth.js
        dados/  campanhas.js  cadastros.js  erros.js  saude.js (confere se o banco tem as tabelas)
        ui/     icones.js  avisos.js  campos.js  combo.js  pecas.js  cadastro-dialogos.js
                estado.js (carregando/erro/vazio)  senha.js (campo de senha)  copiar.js
        telas/  inicio.js  campanhas.js  detalhe.js  nova.js  historico.js  gestao.js  perfil.js
sql/          schema.sql (instalação nova)  migracoes/ (00–11, com rollback e validação)
scripts/      package.json (ws, xlsx — só dos scripts) · sincronizar-clientes-qlik.mjs · importar-planilhas.mjs · de-para-empresas.json
              lib/ env.mjs (.env) · qlik.mjs (Engine API) · planilhas.mjs (xlsx → linhas) · supabase-rpc.mjs
              Só rodam no computador ou no GitHub Actions, com o .env. NUNCA importados por public/.
tests/        regras.test.mjs · scripts.test.mjs (unidade) · banco/ (Postgres) · e2e/ (navegador)   → TESTES.md
dev/          servidor.mjs (servidor local) · supabase-simulado.js (banco falso em memória)
deploy/       nginx.conf (servidor próprio)
wrangler.jsonc  package.json  .github/workflows/testes.yml
```

## Rotas

`#/inicio` · `#/campanhas` · `#/campanhas/:id` · `#/nova` · `#/nova/de/:id` (reenviar com ajustes) ·
`#/historico` · `#/gestao` · `#/gestao/empresas/:id` · `#/perfil` · `#/usuarios` (só administrador)

Links `<a href="#/…">` passam pelo roteador (`pushState` com índice); o "Voltar" do topo usa o
histórico do app quando existe.

## Interfaces dos módulos

- **Tela:** `export function montar(el, ctx, params) → desmontar` e, opcional, `export function atualizar(params)`
  (troca de parâmetro sem remontar — usado em campanhas e gestão).
- **ctx:** `perfil`, `ehAprovador`, `campanhas`, `cadastros`, `toast`, `navegar(rota, {substituir})`,
  `cabecalho({titulo, voltar, acoes})`, `barraDeAcao(bool)` (esconde a barra inferior no celular), `remontar()`, `sair()`.
- **campanhas:** `carregado`, `carregar()`, `todas()`, `porId()`, `pendentes()` (mais antiga primeiro),
  `assinar(fn) → desligar`, `aoVivo()`, `criar(campos)`, `enviar({campanha, balconista, notas})`, `decidir(id, status, motivo)`, `parar()`.
  Lê sempre a view `campanhas_app`. No tempo real relê **só a linha** do evento.
- **cadastros:** `carregado`, `carregar()`, `empresas({inativas})`, `empresa(id)`, `balconista(id)`,
  `balconistasDa(id, {inativos})`, `salvarEmpresa(dados, id?)`, `salvarBalconista(dados, id?)`, `assinar(fn)`, `aoVivo()`.
- **erros:** `exigir({data, error})` lança `ErroApp` com mensagem em português (e `campo`, quando dá para saber).
  Erro sem tradução vira "Não foi possível concluir agora" na tela; o texto original vai só para o console.
- **saude:** `conferirBanco() → { ok, falta: [{tabela, migracao}], erro }`. Faltou tabela → `app.js` mostra
  "Sistema em atualização" e nenhuma tela abre até "Tentar de novo" dar certo.
- **estado:** `estadoLista({ carregado, erro, vazioSe, vazioConteudo })` → html ou `null` (aí a tela desenha os itens).
  `campanhas.erro` / `cadastros.erro` guardam o erro da última carga. Botão `[data-tentar-de-novo]` é tratado no `app.js`.
  Erro de carga vira a faixa `#faixa-erro`; `toast` fica só para confirmações e erro de uma ação que acabou de ser feita.
- **senha:** `campoSenha({ id, rotulo, novo, autocomplete, extraRotulo })` + `ligarSenha(raiz, { email })` (olho,
  Caps Lock, força). Tem `data-campo` e `.campo-erro`: funciona com `aplicarErros`.
- **copiar:** `botaoCopiar(texto, rotulo, aviso)` + `ligarCopiar(raiz, toast)`.
- **campos (busca):** `campoBusca({ id, rotulo, valor, placeholder })` + `ligarBusca(raiz)` (× de 44 px e Esc limpam).
- **Rotas com query:** `params.query` (ex.: `#/campanhas?status=Aprovada&mes=atual&rebate=1`); a lista mostra um chip com ×.
- **avisos:** `toast(msg, {acao, duracao, tom, aoFechar})`, `abrirDialogo({titulo, descricao, corpo, acoes, aoAbrir, antesDeFechar})`, `confirmar()`.
- **campos:** `campo`, `selecao`, `areaTexto`, `interruptor`, `ligarMascaras(raiz)`, `aplicarErros(raiz, {id: msg})`.

## Clientes do Qlik e histórico (v2.3)

- `empresas` tem `codigo_cliente`, `nome_fantasia`, `uf`, `vendedor`, `origem` ('app' | 'qlik' | 'planilha'), `sincronizado_em`.
  Empresa com `codigo_cliente`: nome, CNPJ e cidade só mudam pela sincronização (trigger `ao_proteger_qlik`);
  no app o diálogo trava esses campos e grava só telefone e observações. Use `ehDoQlik(e)` de `dados/cadastros.js`.
- Busca de empresa (Gestão e Nova): `textoBuscaEmpresa(e, balconistas)` — nome, fantasia, código, cidade, UF, CNPJ, vendedor, balconistas.
- `cadastros.carregar()` lê em blocos de 1.000 (`range`) — o Supabase corta em 1.000 linhas. Gestão desenha 60 por vez.
- `campanhas.importada = true`: veio de planilha antiga (selo "Importada", origem no detalhe, coluna Origem no Excel).
  O app não grava essa coluna (fora do grant de insert em `reaplicar_permissoes_campanhas`).
- Cargas: `importar_clientes_qlik(jsonb)` e `importar_historico_planilha(jsonb)`, só service_role / SQL Editor.
  Chaves no `.env` (modelo em `.env.exemplo`), nunca em `public/`. Passo a passo: `QLIK-E-HISTORICO.md`.
- Simulador: `?muitas=1500` cria 1.500 clientes do Qlik para testar volume.

## Compras no Qlik e notas fiscais (v2.4)

- `worker/index.js` (Cloudflare Worker, só `/api/*`; o resto é arquivo estático) consulta o Qlik pela Engine API.
  `worker/qlik-engine.js` não conhece plataforma: recebe um "soquete" e é testado em Node (`tests/qlik-compras.test.mjs`).
  A chave `QLIK_API_KEY` é segredo do Worker; **nunca** vai para `public/` nem para `wrangler.jsonc`.
- Campos, filtros e expressão do valor vêm de `QLIK_CAMPOS`, `QLIK_FILTROS`, `QLIK_EXPRESSAO_VALOR` (variáveis do Worker).
  Valor vindo do usuário só entra na expressão por `valorSeguro()` (sem aspas, chaves, `$`, `;`).
- App: `dados/qlik.js` (`consultarCompras`, `padraoFornecedor`), quadro "Compras e notas fiscais" em `telas/nova.js`,
  `campanhas.salvarNotas/notasDa`. Notas ficam em `campanha_notas` (só o solicitante grava, só Pendente, imutável).
- Marca opcional (v2.5): `marca` no pedido filtra total/notas; a resposta traz `marcas` (sempre sem o filtro) e a escolha vai em `campanhas.compras_marca` (migração 09).
- Qlik simulado para `npm run dev` e e2e: `dev/qlik-simulado.mjs` (código terminado em 0 = comprou só de outros; em 00 = Qlik sem nada do cliente). Passo a passo: `NOTAS-FISCAIS-QLIK.md`.
- **Toda expressão mandada ao Qlik usa `{1<…>}`** (e `Only({1} …)` dentro de busca por expressão, como o período): o app abre
  com as seleções salvas de quem usou por último e, sem o `1`, tudo saía R$ 0,00 (v2.8.1). Vale para a consulta de compras
  (`expressao()`/`montarConjunto()` em `worker/qlik-engine.js`) e para a sincronização (`MEDIDA_PADRAO` em `scripts/lib/qlik.mjs`, só atacado).
- **Devoluções (v2.9, migração 13):** o total do Qlik já desconta; a nota devolvida vem com o valor cheio e, no atacado,
  `Nota Fiscal Origem` vem vazio (o Qlik não diz qual foi). O Worker manda `devolucoes` (= soma das notas − total) e marca
  `provavel_devolucao` nas notas cuja soma (1 a 3, mesma série) fecha exatamente com o devolvido (`acharDevolvidas`).
  Nada sai da lista: a nota fica riscada, com o selo "Provável devolução", fora da soma e sem marcar. A linha
  "Devoluções no período: −R$ X (Y notas)" aparece sempre que `devolucoes > 0` (`textoDevolucoes()` em `lib/regras.js`).
  A campanha grava `compras_devolucoes` e `compras_devolvidas` (jsonb) pelo `enviar_campanha`; o detalhe mostra igual.
  Limites no banco (`campanhas_devolucoes_faixa`): devoluções de 0 a R$ 10 milhões; lista de até 50 notas
  (`LIMITES.compras_devolucoes`/`compras_devolvidas`, conferidos por `tests/regras.test.mjs`). Nulas = site 2.8.1 ou sem consulta.
  A conferência do aprovador no Qlik compara total **e** devoluções.
- Total zero: o Worker manda `cliente_total` (sem o laboratório) e a Nova explica o caso. R$ 0,00 em tudo? `npm run qlik:diagnosticar` (v2.8.1).

## Segurança (v2.6) — não enfraquecer

- Sem CDN: supabase-js (UMD, `window.supabase`) e SheetJS ficam em `public/vendor/` com a versão no nome. CSP `script-src 'self'`.
  `connect-src` só para o projeto do Supabase do `config.js` (trocou de projeto? `_headers`, `deploy/lynkz-seguranca.conf` e `index.html`; o lote S confere).
- `public/sw.js`: `ARQUIVOS` lista todos os módulos (o lote S confere). Página e `config.js` rede primeiro; o resto cópia guardada + atualização em segundo plano.
- Migração 10: conta nova entra **desativada**; limites de texto/valor; limite de gravações por hora; `auditoria_perfis`.
- Worker: `codigoSeguro()`/`padraoSeguro()` para tudo que entra numa expressão do Qlik (nada de `=`, `<`, `>`, aspas, curinga sozinho);
  origem igual ao site; JSON de até 2 KB; 20 consultas/min por usuário (`LIMITE_QLIK`); erro cru do Qlik (`interno`) só no log.
- Detalhe: aprovador tem "Conferir no Qlik agora" (o total enviado vem do aparelho de quem pediu).
- Checklist dos painéis (Supabase, Cloudflare, GitHub): `SEGURANCA.md`.

## Envio da campanha e limites (v2.7)

- A tela Nova só monta o pedido e chama `campanhas.enviar({ campanha, balconista, notas })`. Quem grava
  balconista + campanha + notas é a função `enviar_campanha()` (migração 11, security invoker, tudo ou nada).
  Não volte a gravar em três chamadas na tela. Status e solicitante são impostos pelo banco.
- Limites de valor e texto: `LIMITES` em `lib/regras.js`, com os mesmos números das constraints
  `campanhas_valores_faixa` e `campanhas_textos_tamanho` (`tests/regras.test.mjs` compara com `sql/schema.sql`).
  Mudou uma constraint? Mude `LIMITES` junto.
- Cartões de campanha e empresa **não** levam `aria-label`: o nome vem do conteúdo e o axe barra rótulo que não repete o texto visível (WCAG 2.5.3).
- Simulador: tem `sb.rpc('enviar_campanha')` atômico e a faixa de valores da campanha.

## Usuários e balconistas (v2.8)

- Na tela, papel `aprovador` = **Administrador** e `coordenador` = **Usuário** (`ROTULO_PAPEL`/`rotuloPapel()` em `lib/regras.js`).
  No banco os nomes continuam os mesmos: não renomeie as policies nem a CHECK de `perfis.papel`.
- `#/usuarios` (`telas/usuarios.js` + `dados/usuarios.js`): o administrador libera contas, troca papel, nome e acesso.
  Só pela função `definir_perfil()` (migração 12, security definer): confere `eh_aprovador()`, ninguém tira o
  próprio papel nem o próprio acesso, tudo vai para `auditoria_perfis`. `perfis` continua sem UPDATE pela API.
  O primeiro administrador é feito uma vez no SQL Editor (topo da migração 12).
- Empresas vêm do Qlik: **não existe mais "Cadastrar empresa"** (nem na Gestão nem no combo da Nova). `dialogoEmpresa` só edita.
- Até **2 balconistas por empresa, contando os desativados** (`LIMITES.balconistas_por_empresa`; gatilho
  `limitar_balconistas_empresa` da migração 12, que não vale para SQL Editor/service_role). Para trocar a pessoa, edita-se o cadastro.
  `tests/regras.test.mjs` confere o número com `sql/schema.sql`.
- Gestão: "Cadastrar balconista" abre `dialogoBalconista(null)` — passo 1 escolhe a empresa (combo com "x de 2"), passo 2 os dados
  (fieldset travado até haver empresa com vaga). Na ficha, `dialogoBalconista(empresaId)`.
- Nova: com 2 cadastros na empresa, some "Outra pessoa"; escolhe-se um dos balconistas ativos.
- Simulador: `perfis` ficam no banco simulado (com a conta nova `u-novo`, desativada), `sb.rpc('definir_perfil')` e o limite de 2.

## v2.9 — decisão na lista, passos no celular, carga leve

- Decisão: `ui/decisao.js` (`aprovarComDesfazer`, `reprovarComMotivo`, `desfazerAprovacao`, `botoesDecisao`) é a ÚNICA lógica
  de aprovar/reprovar; detalhe e lista usam o mesmo. Uma aprovação em espera por vez; quem desenha assina `assinarDecisao`.
  Os botões da lista ficam no rodapé do cartão (`cartao(c, { rodape })`), fora do link.
- Nova: abaixo de 900 px, 3 passos por CSS (`data-passo` nas seções, `data-passo-atual` em `.nova`). Mesmo formulário:
  campo novo precisa de `data-passo` na seção certa. `continuar()` valida só o passo; `enviar()` vai ao passo do 1º erro.
- `VERSAO_APP` em `js/app.js` = `VERSAO` de `config.js` e `sw.js` (o lote S confere). Diferença → recarrega 1× por aba.
- Carga: `dados/cadastros.js` lê só `COLUNAS` (coluna nova usada na tela entra lá) e só empresas ativas;
  as desativadas vêm por `carregarInativas()` (Gestão "Mostrar desativadas" ou `empresa(id)` que não achou).
- Contas sem acesso: `usuarios.semAcesso()`/`assinar` (`dados/usuarios.js`), no menu e no Início do administrador.
- Texto de leitura no mínimo `--t-13`; `--t-12` só em selos, régua, contadores, botões pequenos e rótulos curtos (teste D5).
- Busca: placeholder curto + `dica` (vai para `aria-describedby`) em `campoBusca`.
- Aviso por e-mail: `supabase/functions/avisar-aprovador/` + `NOTIFICACOES.md` — **não publicado**. E-mail nunca leva `swile_*`.

## Regras de código

- Português do Brasil em nomes, comentários e textos.
- **HTML só com `html\`\``** (`js/lib/dom.js`), que escapa toda interpolação. Proibido montar HTML
  concatenando string. `bruto()` só para SVG fixo do próprio código, nunca dado do banco.
- Datas: `dataBR()`/`dataCivil()` no fuso `America/Fortaleza` (`FUSO` em regras.js). Nunca `toISOString().slice(0,10)`.
- Valores digitados: `lerValor()` (aceita `1.234,56`, `2.000`, `1234.56`). Exibição: `brl()`, `brl0()`, `pct()`.
- Formulário nunca é redesenhado por evento externo (tempo real). Listas redesenham só a lista.
- Ver no navegador: `node dev/servidor.mjs` (banco simulado) ou `node dev/servidor.mjs --real`. ESM não funciona por `file://`.
- **Nunca** copie `dev/supabase-simulado.js` para dentro de `public/`.
- Antes de enviar mudança: `npm test`, `npm run test:e2e` e, se mexeu no banco, `npm run test:banco` (ver `TESTES.md`).
- Tela, botão ou fluxo novo: acrescente o teste em `tests/e2e/rodar.mjs`.
- **Módulo novo em `public/js/`:** acrescente o `<link rel="modulepreload">` no `public/index.html` (o teste falha se faltar).
- Valor em reais na tela: classe `.valor` (não deixa "R$" sozinho no fim da linha).
- Simulador: `?sem=tabela` (banco desatualizado), `?falhar=tabela` (rede caiu), senha que começa com "errad" é recusada.
- Subiu versão? Troque `VERSAO` em `public/config.js` **e** em `public/sw.js` (as duas iguais).
- Endereço externo novo (CDN, API)? Libere no CSP de `public/_headers` **e** de `deploy/nginx.conf`.

## Design

- Vermelho oficial **`#E11F1C`** = cor de **ação** (botão primário, item ativo). Alerta usa `--red-ink` em texto.
- **Cores só em `css/tokens.css`** (claro e escuro). Conferir: `grep -n "#[0-9A-Fa-f]\{3,6\}\|rgb(" css/*.css`
  só pode achar `tokens.css`.
- Todo texto com contraste ≥ 4,5:1. Erro de campo: borda 2 px + ícone + texto (nunca só cor).
- Fonte Instrument Sans; números grandes em `.num-display`. Escala 12/14/16/20/28/40, espaço base 4,
  raios `--r-panel` > `--r-ctrl` > `--r-pill`, alvo de toque `--tap` (44 px).
- < 900 px: topo fixo + barra inferior (Início, Campanhas, +, Gestão, Menu) + menu deslizante.
  ≥ 900 px: menu lateral fixo. ≥ 1100 px: régua ao lado do formulário Nova. ≥ 1200 px: lista e detalhe lado a lado.
- Toast no celular embaixo; no desktop no alto à direita (não cobre os botões de decisão).

## Regras de negócio

**Custo total = investimento LYNKZ + indústria + rebate estimado** (`meta × %`, limitado pelo teto).
A régua usa o **total**, nunca só a verba. `calc()` em `js/lib/regras.js` é a fonte única dessa conta.
Faixas da régua: `FAIXA_VERDE` e `FAIXA_AMARELA` no `config.js`.

## Segurança — não enfraquecer

As regras vivem no banco (RLS, triggers, permissões por coluna). A tela só esconde botões.

- Só `aprovador` altera `status`; toda campanha nasce `Pendente`; decidida não muda; reprova exige motivo.
- `aprovador_nome`, `data_decisao` (fuso America/Fortaleza) e `solicitante_nome` são carimbados por trigger.
- Usuário com `ativo = false` não lê nem grava nada (`eh_ativo()` nas policies). Ninguém edita `perfis` pela API.
- Nada é apagado: sem policy nem permissão de delete em campanhas, empresas e balconistas.
- Dados Swile (`swile_*`): leitura negada na tabela; a view `campanhas_app` entrega só ao aprovador e ao solicitante.
- `empresas` / `balconistas`: todo ativo lê, cadastra e edita, só nas colunas editáveis (nunca `id`,
  `criado_*`, `atualizado_*`). Balconista não troca de empresa. CPF único por empresa.
- Trigger `ao_vincular_campanha`: balconista tem de ser da empresa; `cliente` recebe o nome da empresa.
- Coluna nova em `campanhas`? Rode `select public.reaplicar_permissoes_campanhas();` (refaz view e permissões).
- Mudanças de banco em produção vão em `sql/migracoes/` (com rollback e validação) e são espelhadas em `sql/schema.sql`.
- Funcionalidade nova que precise de dado: escreva a policy correspondente — não relaxe as existentes.

## Decisões de 18/11/2026

| Tema | Decisão |
|---|---|
| Quem cadastra empresas e balconistas | Empresas vêm do Qlik (app só edita telefone/observações). Todo usuário ativo cadastra e edita balconistas, até 2 por empresa. Nada é apagado, só desativado. |
| Privacidade dos balconistas | CPF, nascimento, e-mail e telefone visíveis a todo usuário ativo. |
| Dados Swile na campanha (`swile_*`) | Continuam visíveis só ao aprovador e ao solicitante. |
| Fuso das datas | `America/Fortaleza` (Maranhão, UTC-3). |

## Pendências conhecidas

- Notificação push não existe; o app avisa com a tela aberta. Caminho simples: Edge Function enviando e-mail.
- Rebate estimado assume que o cliente bate exatamente a meta (sem rebate escalonado).
- Campanhas da v1 não têm `empresa_id`; aparecem pelo nome em `cliente` e não entram na ficha da empresa.
