# Compras no Qlik e notas fiscais da campanha (v2.4.0)

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

## O que a consulta pergunta ao Qlik

| Pergunta | Campo do Qlik (padrão) |
|---|---|
| Cliente | `Cód. Cliente` = código do cliente da empresa (vem da sincronização de clientes) |
| Laboratório | `Nome Fantasia Fornecedor`, comparado pelo padrão do laboratório (abaixo) |
| Período | `Data Emissão`, de início a fim da campanha |
| Filtros fixos | `Unidade de Negócio = ATACADO` e `Intercompany Geral = REGULAR` |
| Valor | `Sum({SET} [Receita (- dev.)])` — o total inclui devoluções |
| Notas | `Núm. Nota Fiscal Vendas`, `Série Nota Fiscal Vendas`, `Data Emissão` |

O quadro mostra também **qual fornecedor do Qlik** o padrão do laboratório pegou, para o usuário conferir.

### Laboratório do app × fornecedor do Qlik

O app compara pelo **primeiro nome** do laboratório, sem acento: "Ouro Fino" → `*Ouro*`,
"Biogénesis Bagó Pet" → `*Biog*`. O Qlik ignora maiúsculas e aceita `*`. Quando o nome no Qlik for muito
diferente, diga o padrão em `public/config.js`:

```js
LABORATORIO_QLIK: { "Organnact Pet": "*Organnact*", "Biogénesis Bagó Pet": "*Biog*" },
```

"Recurso próprio" não consulta nada (não é fornecedor).

## Colocar no ar (nesta ordem)

1. **Banco:** no SQL Editor do Supabase, rode `sql/migracoes/08-notas-fiscais.sql` e depois
   `08-validacao.sql` (6 linhas `true`). Só acrescenta; desfazer: `08-rollback.sql`.
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

> **Importante:** os nomes de campos e a expressão do valor vêm do Painel Vendedor e **ainda não foram
> conferidos contra o app do Qlik de vocês**. Os testes automáticos usam um Qlik simulado. O passo 4
> existe justamente para isso: rode antes de liberar para os coordenadores.

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
