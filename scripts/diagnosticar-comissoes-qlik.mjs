#!/usr/bin/env node
// Diagnóstico da consulta de comissões no Qlik: só lê, não grava nada.
//
//   npm run qlik:comissoes:diagnosticar -- --mes 2026-10 [--vendedores "LUCAS EMANUEL AIRES DOS SANTOS;IVALDO AQUINO DOS SANTOS MACHADO;TERRAZOO"]
//
// Quando `npm run qlik:comissoes` não bate com a planilha, mostra em qual peça do filtro está a diferença:
//   1. total do app inteiro e com cada peça do filtro (período, atacado, regular);
//   2. o filtro de data do app comparado com outras formas de filtrar a mesma data
//      (se só o do app destoa, o problema é o filtro de data);
//   3. primeira e última data que entram no período, e quantos dias diferentes;
//   4. vendas por mês (sem filtro de data) dos vendedores pedidos: dá para ver se o app está somando
//      meses de fora do período (um vendedor novo bate; os antigos vêm multiplicados);
//   5. valores dos campos de filtro no período (Unidade de Negócio, Intercompany, Tipo de Venda);
//   6. medidas mestras do app com "receita" ou "devol" no nome, no mesmo período (qual é a "Receita (- dev.)").
import WebSocket from 'ws';
import { lerEnv, exigirEnv } from './lib/env.mjs';
import { abrirEngine, conjuntoPeriodo, expressao, serialQlik, CONFIG_PADRAO } from '../worker/qlik-engine.js';
import { periodoApuracao } from '../public/js/lib/comissoes.js';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s--/).map(s => s.replace(/^--/, '').trim()).filter(Boolean)
  .map(s => { const i = s.indexOf(' '); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
if (!/^\d{4}-\d{2}$/.test(args.mes || '')) {
  console.error('Uso: npm run qlik:comissoes:diagnosticar -- --mes 2026-10 [--vendedores "NOME 1;NOME 2"] [--corte 25]');
  process.exit(2);
}
const { inicio, fim } = periodoApuracao(args.mes, Number(args.corte || 25));
const vendedores = (args.vendedores || 'LUCAS EMANUEL AIRES DOS SANTOS;IVALDO AQUINO DOS SANTOS MACHADO;TERRAZOO')
  .split(';').map(s => s.trim()).filter(Boolean);
const config = CONFIG_PADRAO;
const c = config.campos;
const brl = n => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const f = n => `[${n}]`;
const a = serialQlik(inicio), b = serialQlik(fim);

const env = lerEnv();
exigirEnv(env, ['QLIK_TENANT', 'QLIK_API_KEY', 'QLIK_APP_ID']);
const base = /^wss?:\/\//.test(env.QLIK_TENANT) ? env.QLIK_TENANT : 'wss://' + env.QLIK_TENANT.replace(/^https?:\/\//, '');
const ws = new WebSocket(`${base.replace(/\/+$/, '')}/app/${encodeURIComponent(env.QLIK_APP_ID)}`, { headers: { Authorization: `Bearer ${env.QLIK_API_KEY}` } });
await new Promise((ok, falha) => {
  ws.once('open', ok);
  ws.once('error', e => falha(new Error(`Não conectou no Qlik: ${e.message}`)));
  ws.once('unexpected-response', (_q, r) => falha(new Error(`Qlik recusou a conexão (HTTP ${r.statusCode}).`)));
});
const engine = abrirEngine(ws, { tempoMs: 120000 });

try {
  const hDoc = (await engine.rpc(-1, 'OpenDoc', { qDocName: env.QLIK_APP_ID })).qReturn.qHandle;
  const app = (await engine.rpc(hDoc, 'GetAppLayout')).qLayout || {};
  const selecoes = (await engine.rpc(hDoc, 'Evaluate', { qExpression: "GetCurrentSelections(' | ')" })).qReturn;
  console.log(`\nApp: ${app.qTitle || env.QLIK_APP_ID} · última recarga: ${app.qLastReloadTime || '?'}`);
  console.log(`Seleções salvas no app (a consulta deveria ignorar): ${selecoes && selecoes !== '-' ? selecoes : 'nenhuma'}`);
  console.log(`Período da apuração ${args.mes}: ${inicio} a ${fim} (seriais ${a} a ${b})`);

  const cubo = async def => {
    const h = (await engine.rpc(hDoc, 'CreateSessionObject', { qProp: { qInfo: { qType: 'lynkz-diag-comissoes' }, qHyperCubeDef: def } })).qReturn.qHandle;
    return { h, layout: (await engine.rpc(h, 'GetLayout')).qLayout.qHyperCube };
  };
  const medir = async expr => {
    const { layout } = await cubo({ qDimensions: [], qMeasures: [{ qDef: { qDef: expr } }], qInitialDataFetch: [] });
    if (layout.qMeasureInfo?.[0]?.qError) return { erro: true };
    return { n: layout.qGrandTotalRow?.[0]?.qNum, t: layout.qGrandTotalRow?.[0]?.qText };
  };
  const linha = async (rotulo, expr, texto = false) => {
    const r = await medir(expr);
    console.log(`  ${rotulo.padEnd(58)} ${r.erro ? 'ERRO na expressão' : texto ? r.t : brl(r.n)}`);
    return r.n;
  };
  const valor = conj => expressao(config, conj);
  const filtros = (config.filtros || []).map(x => `${f(x.campo)}={'${x.valor}'}`);
  const dataApp = conjuntoPeriodo({ config, inicio, fim }).slice(1, -1).split(', ')[0];

  console.log('\n1. Cada peça do filtro');
  await linha('App inteiro, sem filtro', config.expressaoValor.replaceAll('{SET}', '{1}'));
  await linha('Só atacado + regular (sem data)', valor(`<${filtros.join(', ')}>`));
  await linha('Só o período (filtro de data do app)', valor(`<${dataApp}>`));
  await linha('Período + atacado + regular (= consulta do app)', valor(conjuntoPeriodo({ config, inicio, fim })));

  console.log('\n2. O mesmo período filtrado de outras formas (todas com atacado + regular)');
  const outras = [
    ['App: busca com Only({1} Num(data))', dataApp],
    ['Busca numérica direta >=a<=b', `${f(c.data)}={">=${a}<=${b}"}`],
    ['Busca por expressão sem Only', `${f(c.data)}={"=Num(${f(c.data)})>=${a} and Num(${f(c.data)})<${b + 1}"}`],
    ['Busca por expressão com Floor (datas com hora)', `${f(c.data)}={"=Floor(${f(c.data)})>=${a} and Floor(${f(c.data)})<=${b}"}`],
    ['Busca por texto das datas (DD/MM/AAAA)', `${f(c.data)}={"${inicio.split('-').reverse().join('/')}*"}`],
  ];
  for (const [rotulo, peca] of outras) await linha(rotulo, valor(`<${[peca, ...filtros].join(', ')}>`));

  console.log('\n3. Datas que entram na consulta do app');
  const conjApp = `{1${conjuntoPeriodo({ config, inicio, fim })}}`;
  await linha('Primeira data', `Date(Min(${conjApp} ${f(c.data)}))`, true);
  await linha('Última data', `Date(Max(${conjApp} ${f(c.data)}))`, true);
  await linha('Dias diferentes', `Count(${conjApp} DISTINCT ${f(c.data)})`, true);
  await linha('Formato do campo de data (um valor)', `Only({1<${f(c.data)}={"${b}"}>} ${f(c.data)}) & ' / ' & Num(Max({1} ${f(c.data)}))`, true);

  console.log('\n4. Vendas por mês, sem filtro de data (atacado + regular)');
  for (const v of vendedores) {
    const conj = `<${[...filtros, `${f(c.vendedor)}={"${v.replace(/"/g, '')}"}`].join(', ')}>`;
    const { h, layout } = await cubo({
      qDimensions: [{ qDef: { qFieldDefs: [`=MonthName(${f(c.data)})`], qSortCriterias: [{ qSortByNumeric: 1 }] }, qNullSuppression: true }],
      qMeasures: [{ qDef: { qDef: valor(conj) } }], qSuppressZero: true, qInitialDataFetch: [],
    });
    const linhas = layout.qSize.qcy ? (await engine.rpc(h, 'GetHyperCubeData', { qPath: '/qHyperCubeDef', qPages: [{ qTop: 0, qLeft: 0, qWidth: 2, qHeight: 24 }] })).qDataPages[0].qMatrix : [];
    console.log(`  ${v}`);
    if (!linhas.length) console.log('    (nada: o nome não existe em Vendedor B2B)');
    linhas.slice(-8).forEach(l => console.log(`    ${String(l[0].qText).padEnd(12)} ${brl(l[1].qNum)}`));
  }

  console.log('\n5. Valores dos campos de filtro no período (só a data, sem atacado/regular)');
  for (const campo of [...new Set([...(config.filtros || []).map(x => x.campo), c.tipoVenda])]) {
    const { h, layout } = await cubo({
      qDimensions: [{ qDef: { qFieldDefs: [campo] }, qNullSuppression: false }],
      qMeasures: [{ qDef: { qDef: valor(`<${dataApp}>`) }, qSortBy: { qSortByNumeric: -1 } }],
      qInterColumnSortOrder: [1, 0], qSuppressZero: true, qInitialDataFetch: [],
    });
    if (layout.qDimensionInfo?.[0]?.qError) { console.log(`  ${campo}: o campo não existe`); continue; }
    const linhas = (await engine.rpc(h, 'GetHyperCubeData', { qPath: '/qHyperCubeDef', qPages: [{ qTop: 0, qLeft: 0, qWidth: 2, qHeight: 10 }] })).qDataPages[0].qMatrix;
    console.log(`  ${campo}: ${linhas.map(l => `${l[0].qText || '(vazio)'} ${brl(l[1].qNum)}`).join(' · ')}`);
  }

  console.log('\n6. Medidas mestras com "receita" ou "devol" no nome, no período da consulta do app');
  const lista = await engine.rpc(hDoc, 'CreateSessionObject', { qProp: { qInfo: { qType: 'MeasureList' }, qMeasureListDef: { qType: 'measure', qData: { titulo: '/qMetaDef/title', expr: '/qMeasure/qDef' } } } });
  const items = (await engine.rpc(lista.qReturn.qHandle, 'GetLayout')).qLayout.qMeasureList?.qItems || [];
  const alvo = items.filter(m => /receita|devol/i.test(m.qData?.titulo || ''));
  if (!alvo.length) console.log('  nenhuma');
  for (const m of alvo.slice(0, 12)) {
    const expr = String(m.qData.expr || '').trim().replace(/^=/, '');
    console.log(`  "${m.qData.titulo}" = ${expr.slice(0, 90)}`);
    // Mesmo período e filtros, aplicados por fora (pode não valer se a medida já tiver set analysis própria).
    await linha('    no período (filtro por fora)', `Sum({1${conjuntoPeriodo({ config, inicio, fim })}} Aggr(${expr}, ${f(c.vendedor)}))`);
  }

  console.log(`
Como ler:
- Se "Período + atacado + regular" dá perto de "Só atacado + regular", o filtro de data NÃO está funcionando.
  Compare com as linhas do item 2: a forma que der o valor da planilha é a que o app deve usar.
- Se as datas do item 3 saem fora de ${inicio} a ${fim}, idem.
- Se no item 4 o vendedor novo (só vendeu neste mês) bate e os antigos vêm somando vários meses, idem.
- Se o filtro de data está certo e mesmo assim não bate, a diferença está em quais linhas a extração da planilha pegou:
  compare os itens 5 e 6 com as seleções usadas na pasta do Qlik de onde a planilha saiu.`);
} finally {
  engine.fechar();
}
