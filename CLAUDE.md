# LYNKZ Campanhas

PWA para celular e computador. Usuários (papel `coordenador`) pedem campanhas promocionais para empresas clientes;
administradores (papel `aprovador`) aprovam ou recusam. Inclui cadastro de balconistas, consulta de compras no Qlik,
exportação para Excel e ADP (autorização de pagamento) em PDF.

## Stack e princípios

- HTML, CSS e JavaScript puros em módulos ES, **sem framework e sem build**: `public/` é exatamente o que vai para o ar.
  Não introduza React, Vue, Tailwind, bundler ou etapa de build sem pedido explícito. Quem mantém não é desenvolvedor.
- Supabase (banco, autenticação, RLS). Cloudflare Worker publica `public/` e responde `/api/*` (`worker/`).
- Bibliotecas e fonte em `public/vendor/` com a versão no nome (supabase-js, SheetJS, pdf-lib, Instrument Sans). Sem CDN nem
  Google Fonts: a CSP é `script-src 'self'` e `font-src 'self'`. SheetJS é um recorte minificado (`utils` + `writeFile`) do
  `xlsx.mjs` 0.20.3: `echo "export { utils, writeFile } from './xlsx.mjs';" > e.mjs && npx esbuild e.mjs --bundle --format=esm --minify --outfile=xlsx-0.20.3.min.js`.

## Estrutura

```
public/
  index.html  config.js (chaves públicas, VERSAO, listas, textos da ADP)  tema-inicial.js  sw.js  _headers (CSP)  manifest.json
  css/  tokens.css (único lugar com cor; temas claro/escuro/daltônico)  base.css  componentes.css  telas.css
  js/   app.js (casca, rotas, ctx)  acesso.js (login, senha, convite)  exportar.js (Excel)  adp.js (ADP em PDF)
        comissoes-excel.js (Excel do mês)  comissoes-pdf.js (recibos e ADP dos PJ)
        pdf/   motor.js (único desenho de PDF: abrir, fontes, cores, logos, texto, faixa, tabela, assinatura, baixar)
        lib/   regras.js (funções puras)  comissoes.js (cálculo das comissões, puro)  comissoes-documentos.js (recibo, ADP e Excel, puro)
               dom.js (html``)  supabase.js  url-auth.js
        dados/ campanhas.js  cadastros.js  usuarios.js  qlik.js  comissoes.js  erros.js  saude.js
        ui/    avisos.js  campos.js  combo.js  pecas.js  decisao.js  tema.js  adp-dialogo.js  cadastro-dialogos.js  …
        telas/ inicio  campanhas  detalhe  nova  historico  gestao  usuarios  perfil
               comissoes/ index.js (casca, abas, mês)  comum.js (estado `s` e utilidades)  apuracao  documentos
                          lancamentos  contrato  cadastro  parametros  historico (cada aba: desenhar() e ligar(el))
worker/   index.js (rotas /api/qlik/compras, /api/qlik/comissoes e /api/usuarios/convidar)  qlik-engine.js (Engine API, testável em Node)
sql/      schema.sql (instalação nova)  migracoes/NN-*.sql (+ rollback e validação de cada uma)
scripts/  cargas do Qlik e das planilhas antigas (rodam no computador ou no GitHub Actions, com .env)
dev/      servidor.mjs  supabase-simulado.js  qlik-simulado.mjs
tests/    *.test.mjs (unidade, Worker)  banco/ (PostgreSQL)  e2e/rodar.mjs (navegador)
```

Rotas: `#/inicio` `#/campanhas` `#/campanhas/:id` `#/nova` `#/nova/de/:id` `#/historico` `#/gestao`
`#/gestao/empresas/:id` `#/usuarios` e `#/comissoes?aba=apuracao|premiacoes|contrato|cadastro|parametros|historico&mes=AAAA-MM`
(`aba=previa` é apelido de `apuracao` para links antigos)
(administrador; o mês fica no endereço e lembrado na memória ao sair e voltar) `#/perfil`.

Tela: `export function montar(el, ctx, params) → desmontar`. `ctx`: `perfil`, `ehAprovador`, `campanhas`, `cadastros`,
`toast`, `navegar`, `cabecalho`, `barraDeAcao`, `remontar`, `sair`.

## Regras de código

- Português do Brasil em nomes, textos e comentários. Comentário só onde explica o porquê; nada de histórico de versão.
- HTML só com `html``…``` (`lib/dom.js`), que escapa tudo. `bruto()` só para SVG fixo do código.
- Cores só em `css/tokens.css`. Texto com contraste ≥ 4,5:1 nos três temas; mínimo `--t-13` para leitura.
- Datas pelo fuso `America/Fortaleza`: `dataCivil()`, `dataBR()`, `hojeCivil()`. Nunca `toISOString().slice(0, 10)`.
- Valores digitados por `lerValor()`; exibição por `brl()` e `pct()`.
- Limites de valor e texto em `LIMITES` (`regras.js`) iguais às constraints do banco (o teste compara com `schema.sql`).
- Erros do Supabase passam por `exigir()`/`detalhar()` (`dados/erros.js`), que traduzem para português.
- Formulário não é redesenhado por evento de tempo real; listas redesenham só a lista.
- Módulo novo em `public/js/`: entra em `ARQUIVOS` do `sw.js` e no `modulepreload` do `index.html`.
- `VERSAO` igual em `config.js`, `sw.js` e `VERSAO_APP` (`app.js`), e em `package.json`.

## Domínio

- Papéis: `aprovador` = Administrador, `coordenador` = Usuário (`rotuloPapel()`). Perfis só mudam por `definir_perfil()`.
- Envio da campanha: `campanhas.enviar()` → função `enviar_campanha()` (balconista + campanha + notas numa transação).
- Fornecedores: coluna `laboratorio` ("Ouro Fino, Avert"), até 5 (`MAX_FORNECEDORES`). Use `listaLaboratorios()`/`juntarLaboratorios()`.
  Com 2 ou mais, a divisão opcional grava `fornecedores` (`[{nome, meta, investimento_industria}]`) e os totais em `meta` e
  `investimento_industria`. Rebate com um % e um teto; `partilha()` reparte pela meta de cada fornecedor.
- Marcas da consulta do Qlik: até 10 (`MAX_MARCAS`), gravadas em `compras_marca` separadas por "; ".
- Até 2 balconistas por empresa, contando desativados. Para liberar vaga, administrador exclui pela ficha: `excluir_balconista()`
  (migração 18) barra campanha pendente, grava quem recebe nas Swile decididas e guarda a cópia em `balconistas_excluidos`.
  Empresas vêm do Qlik (o app só edita telefone e observações).
- Decisão: `ui/decisao.js` é a única lógica de aprovar/recusar (aprovação com 5 s para desfazer).
- Exclusão: só administrador, pelo detalhe, com motivo. `campanhas.excluir()` → função `excluir_campanha()` (migração 15),
  que guarda a campanha e as notas em `campanhas_excluidas` antes de apagar. O app não tem DELETE direto em nenhuma tabela.
- Filtros da lista de campanhas: status, fornecedor, cliente (só clientes com campanha) e "Só as minhas".
- Forma de pagamento é obrigatória na Nova: sem ela, a aprovada fica fora da ADP.
- ADP: aprovadas com Swile do mês em que terminaram; gerada pela lista de Campanhas, pelo Histórico ou pelo Perfil. Vencimento padrão de 7 dias úteis (`somaDiasUteis()`, sem fins de
  semana e feriados nacionais), editável. As edições do diálogo valem só para o PDF. Textos fixos em `config.js` → `ADP`.
- Senha nova (convite, recuperação e Perfil): `problemaSenha()` (`regras.js`): `SENHA_MIN` (10) caracteres e sem palavras
  do nome nem do e-mail. O mínimo no Supabase (Authentication → Policies) precisa ser o mesmo.
- Toque: alvo de pelo menos 24 px (WCAG 2.5.8). Link no meio de uma frase leva `class="link-toque"`.
- Temas: `ui/tema.js` (automático, claro, escuro, daltônico), salvo no aparelho; `tema-inicial.js` aplica antes da pintura.
- Convite: Administrador convida em Usuários; o Worker chama o invite do Supabase com a chave de serviço e define o perfil
  com o token de quem convidou. O link do e-mail (`type=invite`) abre "Crie sua senha" e entra direto.

## Comissões (só administrador)

- Cálculo puro em `lib/comissoes.js`; a interface que importa é `apurarMes()` (o resto é usado por ela e pelos testes).
  Vendas do dia 26 ao 25 (`periodoApuracao`), receita menos devolução; Farelo = fornecedor do parâmetro (6610);
  % do cadastro de cada pessoa; premiações do mês; Contrato de Resultado só PJ, do mês anterior fechado
  (`mesAnteriorFechado`): faturamento ≥ 100% e positivação ≥ 80% da meta → 1,0% do realizado, 1,2% acima de 105%.
  Metas do mês na aba Contrato (`comissao_mes_pj`; sem elas, as do cadastro); realizado do Qlik ou informado à mão com
  motivo (`entradaContrato`). Positivado = cliente com receita líquida > 0 no mês. Acordo mínimo só CLT, na vigência:
  paga o maior entre a soma e o acordo. Parcelas podem ser negativas; o total pago nunca fica abaixo de zero; nada passa
  para o mês seguinte. Dinheiro em centavos inteiros por dentro, cada parcela arredondada. Sem bônus de cliente novo.
- As pessoas vêm do Qlik: um nome do Qlik (Vendedor B2B) por pessoa. Nome novo aparece em "Novos no Qlik" na Apuração,
  com "Completar cadastro" (regime, %, acordo, dados da PJ) ou "Não comissiona". Nome de cadastro desativado vai para
  "Desativados com venda no Qlik" (com Reativar), nunca para os novos; premiação ou ajuste dele fica fora do total e avisa. Com 2 ou mais, dá para marcar vários e
  aplicar de uma vez ("Não comissiona" ou cadastrar como CLT, Televendas ou PJ com os % padrão: `novoDoQlik()`). Não há botão de cadastro novo nem
  "ligar a alguém"; o nome do Qlik não se edita.
- `dados/comissoes.js` junta banco + Qlik + cálculo: `carregar()`, `carregarMes(mes)`, `apurar(mes, { buscar })`,
  `salvar()`, `salvarParametros()`, `ignorarNome()`/`ignorarNomes()`, `lancarPremiacao()`/`lancarAjuste()` e `removerPremiacao()`/`removerAjuste()`
  (desativam), `salvarMesPj(mes, id, campos)` (metas, realizado informado, número e valor da NF), `buscarBase(mes)` (vendas linha
  a linha, só para o Excel), `fecharMes(resultado)`, `reabrirMes(mes, motivo)`, `historico()` e `contextoDocumentos(mes)`.
  `apurar(mes, { buscar: false })` recalcula com a última consulta do mês (da memória ou a gravada em `comissao_consultas`,
  migração 19: cada busca grava a do mês) e devolve `null` se o Farelo ou o corte mudaram. Mês reaberto calcula com o
  cadastro da cópia do fechamento (`cadastroDoMes()`, `cadastroDaCopia()`), completado só com quem é novo.
  Mês fechado: `apurar()` devolve a cópia do histórico (`resultado.fechado`), sem Qlik nem recálculo.
- Ajustes: acréscimo ou desconto com motivo, por pessoa e mês; entram depois do acordo mínimo; aparecem no recibo
  (uma linha por ajuste) e no Excel (aba Ajustes e coluna Ajustes).
- Apuração: o total (fixo no topo até 600 px, com as pendências), Novos e Desativados, as pessoas (tabela; até 600 px um
  cartão por pessoa com "Ver conta") e, no fim, documentos junto de "Fechar mês". Buscar no Qlik e o período só na Apuração.
  Premiações até 600 px: lista primeiro e "Lançar premiação / ajuste" num diálogo.
- Histórico: "Fechar mês" fica numa faixa própria no fim da Apuração, com o que falta (Novos no Qlik, cadastro dos PJ,
  NF de todos pela ADP); o botão só fica em destaque quando nada falta. Grava em `comissao_fechamentos` a cópia (cálculo, cadastro usado, premiações, ajustes, parâmetros).
  Mês fechado trava premiações, ajustes, contrato e NF (trigger no banco); documentos saem da cópia (o Excel sem a aba
  da base). Reabrir pede motivo e mantém a cópia até fechar de novo. Ninguém apaga o histórico.
- Documentos (`lib/comissoes-documentos.js`, puro; quem desenha: `comissoes-excel.js` e `comissoes-pdf.js`):
  Excel no formato da planilha de outubro/2026 (abas Campanha mensal, Contrato de Resultado - Mês, Análise de comissões,
  Base Qlik 26 - 25; fórmulas com ROUND em cada parcela, iguais à tela; sem a base, as vendas vão como valor);
  recibo por PJ (A4 em pé, uma página por PJ); ADP dos PJ "documentos diversos / NF" com o número da NF obrigatório,
  gravado no mês com o valor da NF (aviso quando não bate com o valor a pagar). Textos fixos em `config.js` → `COMISSOES` (empresa pagadora e CNPJ = tomador das NF dos PJ; a loja vem de `ADP`).
  Nomes de arquivo sem acento (alguns navegadores trocam por "download").
- Banco: migração 16 (`comissionados`, `comissao_parametros`, `comissao_auditoria`), 17 (`comissao_premiacoes`,
  `comissao_ajustes`, `comissao_mes_pj`, `comissao_fechamentos`) e 19 (`comissao_consultas`). RLS `eh_aprovador()` em todas; ninguém apaga (premiação sai desativada); tudo na auditoria.
- Worker: `/api/qlik/comissoes` só para `papel = 'aprovador'` (`ROTAS_QLIK[...].soAdmin`). Cubos `[Vendedor B2B]` (total e
  Farelo) e `[Vendedor B2B] × [Cód. Cliente]` (contrato), com os mesmos `{1<…>}`, filtros e medida das compras.
  Com `{ base: true }`, devolve só a base linha a linha (campos `segmento`, `codigoVendedor` e `produto` em `QLIK_CAMPOS`).
- O teste "outubro/2026" refaz a planilha real com `dados-privados/comissoes-outubro-2026.json` (fora do Git; sem ele, é pulado).
  `npm run qlik:comissoes -- --mes AAAA-MM --planilha arquivo.xlsx` compara o Qlik com a planilha do mês.
- Próximas entregas: envio do recibo por e-mail.

## Qlik

- Toda expressão usa `{1<…>}` (e `Only({1} …)` no período): sem o `1`, as seleções salvas do app zeram os valores.
- Tudo que vem do usuário passa por `codigoSeguro()`, `padraoSeguro()` ou `marcasSeguras()` antes de entrar na expressão.
- Devoluções: o Worker manda `devolucoes` e marca `provavel_devolucao`; a nota fica riscada e fora da soma.
- `Data Venda` vem de um calendário As-Of (`AsOf_Date_Link_vendas`): o filtro fixo `Tipo_Periodo_Mes_vendas = 'Atual'`
  é obrigatório. Sem ele, o período soma também vendas de outros meses (Mes_Anterior, Ano_Anterior…).
- Diagnóstico de valores zerados: `npm run qlik:diagnosticar`. Comissões que não batem: `npm run qlik:comissoes:diagnosticar`.

## Segurança (não enfraquecer)

- Conta nova sem convite entra desativada (e o cadastro aberto fica desligado no Supabase: só entra quem é convidado).
  RLS e grants por coluna; dados `swile_*` só para administrador e solicitante.
- Rascunho da Nova fica no aparelho sem CPF/dados pessoais, marcado com a conta: outra conta no mesmo aparelho não o vê.
- Segredos só no Worker (`npx wrangler secret put QLIK_API_KEY` e `SUPABASE_SERVICE_ROLE_KEY`) e no `.env` dos scripts.
  Nunca em `public/`, `wrangler.jsonc` ou no Git.
- `connect-src` só para o projeto Supabase do `config.js`. Trocou de projeto: atualize `_headers`, `deploy/lynkz-seguranca.conf`
  e `index.html` (o teste "lote S" confere).
- Worker: só aceita a própria origem, JSON até 2 KB e limite por usuário (`LIMITE_QLIK`).

## Publicar

1. Banco primeiro: rode no SQL Editor do Supabase as migrações novas de `sql/migracoes/` e a validação de cada uma
   (todas as linhas `true`). Cada migração tem rollback.
2. `git push` e espere o GitHub Actions ficar verde (4 grupos de teste).
3. `npm run deploy` (publica site e Worker). Confira a versão no rodapé do menu.
4. Supabase → Authentication → URL Configuration: Site URL e Redirect URLs com o endereço do app (convites e recuperação de senha).

## Testes

- `npm test` (regras, Worker, scripts), `npm run test:e2e` (navegador: todas as telas, 360 a 1440 px, axe nos três temas),
  `npm run test:banco` (PostgreSQL local; `PSQL="sudo -u postgres psql"` se precisar).
- Ver no navegador sem banco: `npm run dev` → `http://localhost:8000/?papel=aprovador` (ou `coordenador`).
- Tela, botão ou fluxo novo ganha teste em `tests/e2e/rodar.mjs`. Mudança no banco ganha migração com rollback e validação.
