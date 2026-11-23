# Compras no Qlik e notas fiscais da campanha (v2.5.0)

Na **Nova campanha**, depois de escolher a empresa, o laboratório e o período, o app mostra quanto
aquele cliente comprou do laboratório no período e lista as notas fiscais de venda. O solicitante
**marca as notas que participam da campanha**. O aprovador vê o total e as notas no detalhe.

```
Nova campanha ──POST /api/qlik/compras (token do login)──▶ Worker do Cloudflare ──Engine API + QLIK_API_KEY──▶ Qlik Cloud
       │                                                    (worker/index.js)
       └─ ao enviar: campanhas.compras_periodo + campanha_notas (Supabase)
```

- A chave do Qlik fica **só no Worker** (segredo). O navegador nunca a vê.
- O Worker confere o login no Supabase (token válido e perfil ativo) antes de falar com o Qlik.
- Se o Qlik estiver fora do ar, o usuário vê o aviso, pode "Tentar de novo" e **pode enviar a campanha sem notas**.

## Marca do laboratório (opcional)

Depois que a consulta mostra o total, aparece o campo **Marca do laboratório** com as marcas que o
cliente comprou daquele laboratório no período e o valor de cada uma (ex.: Ouro Fino → WELLPET,
PROTEÇÃO, ANTI-INFLAMATÓRIOS…). Escolher uma marca restringe o total e as notas a ela; "Todas as
marcas" volta ao total do laboratório. Trocar a empresa, o laboratório ou as datas zera a escolha.

A marca é gravada em `campanhas.compras_marca` (migração 09) e aparece no detalhe e no Excel
("Marca consultada (Qlik)"). Conferido no Qlik real: a soma das marcas é igual ao total do laboratório.

## O que a consulta pergunta ao Qlik

| Pergunta | Campo do Qlik (padrão) |
|---|---|
| Cliente | `Cód. Cliente` = código do cliente da empresa (vem da sincronização de clientes) |
| Laboratório | `Nome Fantasia Fornecedor`, comparado pelo padrão do laboratório (abaixo) |
| Período | `Data Venda`, de início a fim da campanha (filtro por expressão `Num(...)`: a busca numérica não funciona neste app) |
| Filtros fixos | `Unidade de Negócio = ATACADO` e `Intercompany Geral = REGULAR` |
| Valor | `Sum({SET} [Valor Faturamento Bruto s/ Devolução Vendas])` — é o campo da medida `v_receita_sem_devolucao`; o total inclui devoluções |
| Notas | `Núm. Nota Fiscal Vendas` e `Série Nota Fiscal Vendas`; a data da nota vem como `Min(Data Venda)` (nunca como dimensão: repetiria a nota em vários dias) |

O quadro mostra também **qual fornecedor do Qlik** o padrão do laboratório pegou, para o usuário conferir.

### Laboratório do app × fornecedor do Qlik

O app compara pelo **primeiro nome** do laboratório, sem acento (`*Avert*`, `*Boehringer*`…). O Qlik
ignora maiúsculas e aceita `*`. Onde isso pega fornecedor errado, `public/config.js` tem o mapa
`LABORATORIO_QLIK`, já preenchido com o que foi conferido em 23/11/2026:

| Laboratório do app | Padrão | Fornecedores do Qlik que pega |
|---|---|---|
| Ouro Fino | `OURO FINO*` | OURO FINO, OURO FINO AGRO, … PET LTDA, S.A. (sem pegar "COURO") |
| Biogénesis Bagó Pet | `BIOGEN*` | BIOGENES BAGO PET, BIOGENESIS |
| Pet Delícia | `PET DELICIA*` | PET DELICIA |
| Pet Nutrition | `PET NUTRITION*` | PET NUTRITION IND.E COM.DE ALIMEN (sem HILLS PET NUTRITION) |

**Pendente:** BePet, Bionatural, Catlife, Coolors, Pet Next e Nova D+ não existem como fornecedor no Qlik.
Existem só como valores do campo `Marca do Produto`, mas sem produto nem venda ligados (zero em todo o
histórico). Para esses a consulta volta "nenhuma nota" até alguém descobrir com que nome eles vendem
(talvez dentro de outro fornecedor). O mapa aceita `"marca:NOME"` se um dia a marca passar a ter venda.
"Recurso próprio" não consulta nada.

## O app mostra R$ 0,00 para tudo? (diagnóstico)

Causa encontrada na v2.8.1: o app do Qlik abre com as **seleções salvas** de quem usou por último
(ex.: jul/2026 + PLANTAS NATURAIS), e uma expressão sem `{1}` parte delas. Toda expressão que o app
manda ao Qlik usa `{1<…>}` (e `Only({1} …)` dentro de buscas por expressão) para ignorar essas seleções.
O diagnóstico mostra as seleções salvas na linha "Seleções salvas no app".

Desde a v2.8.1, quando o total do laboratório dá zero, o Worker também soma **tudo o que o cliente comprou
no período** (`cliente_total`, mesmos filtros, sem o laboratório). A tela diz qual é o caso:

- "comprou R$ X de outros laboratórios, mas nada de …" → o padrão do laboratório não bate (ajuste `LABORATORIO_QLIK`);
- "O Qlik não mostra nenhuma compra deste cliente no período, de nenhum laboratório" → problema de acesso ou de filtro.

Para achar a causa, rode na sua máquina (só lê, usa o `.env`):

```bash
cd scripts && npm install && cd ..
npm run qlik:diagnosticar -- --cliente 6940773 --lab "OURO FINO*" --inicio 2025-11-01 --fim 2026-10-31
```

O script refaz a consulta do Worker por partes (só o cliente → + período → + cada filtro fixo → + laboratório),
mostra onde o valor zera e lista os valores reais dos filtros e os fornecedores do cliente. No fim explica o
que ajustar. Se aqui aparecerem valores e no app não, a chave guardada no Worker é outra: rode
`npx wrangler secret put QLIK_API_KEY` com a chave do `.env` e publique de novo.

## Colocar no ar (nesta ordem)

1. **Banco:** no SQL Editor do Supabase, rode `sql/migracoes/08-notas-fiscais.sql` e depois
   `08-validacao.sql` (6 linhas `true`), e em seguida `09-marca-da-consulta.sql` e `09-validacao.sql`
   (2 linhas `true`). Só acrescentam; desfazer: `09-rollback.sql` e `08-rollback.sql`.
   **Rode a 09 antes de publicar a v2.5.0**: o app passa a gravar `compras_marca` em toda campanha.
2. **Chave nova do Qlik** (a antiga circulou num zip, segundo a documentação do Painel Vendedor):
   Qlik Cloud → Perfil → Chaves de API → gerar. Use a nova nos dois lugares abaixo e apague a antiga.
3. **Segredo do Worker:** `npx wrangler secret put QLIK_API_KEY` (cola a chave quando pedir).
   As outras variáveis (tenant, app, Supabase) já estão em `wrangler.jsonc`.
4. **Descobrir os nomes certos no app do Qlik** (só lê; precisa do `.env` com a chave):
   `cd scripts && npm install && cd ..` e `npm run qlik:descobrir`. Mostra:
   - se cada campo existe (e sugere parecidos);
   - as medidas mestras com a definição (para achar a do valor);
   - os fornecedores e qual deles cada laboratório pega.
5. **Ajustes**, se o passo 4 mostrar diferença, sem mexer em código. Em `wrangler.jsonc → vars`
   (ou `wrangler secret put`): `QLIK_CAMPOS` (JSON, ex.: `{"fornecedor":"Fornecedor"}`),
   `QLIK_FILTROS` (JSON) e `QLIK_EXPRESSAO_VALOR` (texto, com `{SET}` onde entra o filtro).
6. **Publicar:** `git push` (o Cloudflare publica) ou `npm run deploy`.
7. **Testar de verdade:** abra a Nova campanha com uma empresa que tem código do Qlik, escolha um
   laboratório e o mês passado. Compare o total com o relatório do Qlik.

> **Conferido no Qlik real em 23/11/2026** (só leitura): os 7 campos existem; o filtro por `Data Venda`
> funciona; com Boehringer em set–out/2026, um cliente com 13 notas teve **total = soma das notas
> (R$ 8.813,71) e nenhuma nota repetida**. Não foi comparado com um relatório do Qlik feito à mão:
> faça essa conferência uma vez (passo 7) antes de liberar para os coordenadores.

## Rodar no computador

- `npm run dev` abre o app com banco e **Qlik simulados** (cliente com código terminando em `0` não tem
  notas; código `9999` simula erro do Qlik; os demais devolvem 3 notas).
- `npm run cf:dev` roda o Worker de verdade (precisa de `QLIK_API_KEY` em `.dev.vars`; esse arquivo
  já está no `.gitignore`).

## Regras no banco (migração 08)

- `campanha_notas`: número, série, data e valor de cada nota marcada. Só o **solicitante** grava, só
  enquanto a campanha está **Pendente**. Ninguém altera nem apaga depois.
- `campanhas.compras_periodo` e `compras_consultado_em`: o total que o Qlik mostrou no momento do envio.
- O Excel de Campanhas ganhou a coluna "Comprou no período (Qlik)".

## Arquivos

Novos: `worker/index.js`, `worker/qlik-engine.js`, `public/js/dados/qlik.js`, `dev/qlik-simulado.mjs`,
`scripts/descobrir-campos-qlik.mjs`, `sql/migracoes/08-*.sql`, `tests/qlik-compras.test.mjs`, `tests/banco/testes-08.sql`.
Alterados: `wrangler.jsonc`, `public/js/telas/nova.js` e `detalhe.js`, `public/js/dados/campanhas.js`,
`public/js/exportar.js`, `public/css/componentes.css`, `sql/schema.sql`, `dev/` e os testes.
