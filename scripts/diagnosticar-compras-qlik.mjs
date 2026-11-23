#!/usr/bin/env node
// ============================================================
//  DIAGNOSTICAR COMPRAS NO QLIK — só lê, não grava nada.
//
//    npm run qlik:diagnosticar -- --cliente 6940773 --lab "OURO FINO*" --inicio 2025-11-01 --fim 2026-10-31
//
//  Faz a mesma consulta do Worker (/api/qlik/compras), mas por partes,
//  para mostrar QUAL filtro zera o resultado:
//    sem filtro → só o cliente → + período → + cada filtro fixo → + laboratório
//  E lista, para o cliente no período, os valores dos filtros fixos e os
//  fornecedores, com quanto ele comprou de cada um.
//
//  Usa o .env (QLIK_TENANT, QLIK_API_KEY, QLIK_APP_ID). O Worker usa a chave
//  guardada no Cloudflare (wrangler secret QLIK_API_KEY), que pode ser outra:
//  se aqui aparecerem valores e no app não, a chave do Worker é o problema.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { RAIZ, lerEnv, exigirEnv } from './lib/env.mjs';
import { abrirEngine, montarConjunto, alvoLaboratorio, expressao, CONFIG_PADRAO } from '../worker/qlik-engine.js';

// ---------- argumentos ----------
const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s--/).map(s => s.replace(/^--/, '').trim()).filter(Boolean)
  .map(s => { const i = s.indexOf(' '); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const hoje = new Date();
const iso = d => d.toISOString().slice(0, 10);
const cliente = args.cliente;
const lab = args.lab || 'OURO FINO*';
const fim = args.fim || iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0));            // último dia do mês passado
const inicio = args.inicio || iso(new Date(new Date(fim).getFullYear(), new Date(fim).getMonth() - 11, 1));   // 12 meses
if (!cliente) {
  console.error('Uso: npm run qlik:diagnosticar -- --cliente 6940773 [--lab "OURO FINO*"] [--inicio 2025-11-01] [--fim 2026-10-31]');
  process.exit(2);
}

const env = lerEnv();
exigirEnv(env, ['QLIK_TENANT', 'QLIK_API_KEY', 'QLIK_APP_ID']);

// O Worker usa o app de wrangler.jsonc; confere se é o mesmo do .env.
try {
  const wr = readFileSync(join(RAIZ, 'wrangler.jsonc'), 'utf8');
  const app = /"QLIK_APP_ID"\s*:\s*"([^"]+)"/.exec(wr)?.[1];
  const tenant = /"QLIK_TENANT"\s*:\s*"([^"]+)"/.exec(wr)?.[1];
  if (app && app !== env.QLIK_APP_ID) console.log(`ATENÇÃO: o .env usa o app ${env.QLIK_APP_ID}, mas o Worker usa ${app} (wrangler.jsonc).`);
  if (tenant && tenant !== env.QLIK_TENANT.replace(/^\w+:\/\//, '')) console.log(`ATENÇÃO: o .env usa o tenant ${env.QLIK_TENANT}, mas o Worker usa ${tenant}.`);
} catch { /* sem wrangler.jsonc: segue */ }

const config = CONFIG_PADRAO;
const base = /^wss?:\/\//.test(env.QLIK_TENANT) ? env.QLIK_TENANT : 'wss://' + env.QLIK_TENANT.replace(/^https?:\/\//, '');
const ws = new WebSocket(`${base.replace(/\/+$/, '')}/app/${encodeURIComponent(env.QLIK_APP_ID)}`, { headers: { Authorization: `Bearer ${env.QLIK_API_KEY}` } });
await new Promise((ok, falha) => {
  ws.once('open', ok);
  ws.once('error', e => falha(new Error(`Não conectou no Qlik: ${e.message}`)));
  ws.once('unexpected-response', (_q, r) => falha(new Error(`Qlik recusou a conexão (HTTP ${r.statusCode}). ${r.statusCode === 401 ? 'A QLIK_API_KEY do .env está errada ou expirou.' : ''}`)));
});
const engine = abrirEngine(ws, { tempoMs: 60000 });

const brl = n => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const campo = n => `[${n}]`;

try {
  const hDoc = (await engine.rpc(-1, 'OpenDoc', { qDocName: env.QLIK_APP_ID })).qReturn.qHandle;
  const app = (await engine.rpc(hDoc, 'GetAppLayout')).qLayout || {};
  console.log(`\nApp: ${app.qTitle || env.QLIK_APP_ID}`);
  console.log(`Última recarga: ${app.qLastReloadTime || '?'}`);
  // Seleções salvas no app: a consulta as ignora ({1<…>}), mas é bom saber que existem.
  const selecoes = (await engine.rpc(hDoc, 'Evaluate', { qExpression: "GetCurrentSelections(' | ')" })).qReturn;
  console.log(`Seleções salvas no app (ignoradas pela consulta): ${selecoes && selecoes !== '-' ? selecoes : 'nenhuma'}`);
  console.log(`Consulta: cliente ${cliente} · laboratório ${lab} · ${inicio} a ${fim}\n`);

  const cubo = async def => {
    const h = (await engine.rpc(hDoc, 'CreateSessionObject', { qProp: { qInfo: { qType: 'lynkz-diagnostico' }, qHyperCubeDef: def } })).qReturn.qHandle;
    return { h, layout: (await engine.rpc(h, 'GetLayout')).qLayout.qHyperCube };
  };
  const valor = async (conjunto, rotulo) => {
    const expr = conjunto ? expressao(config, conjunto) : config.expressaoValor.replaceAll('{SET}', '{1}');
    const { layout } = await cubo({ qDimensions: [], qMeasures: [{ qDef: { qDef: expr } }], qInitialDataFetch: [] });
    const erro = layout.qMeasureInfo?.[0]?.qError;
    const n = layout.qGrandTotalRow?.[0]?.qNum;
    console.log(`  ${rotulo.padEnd(46)} ${erro ? 'ERRO na expressão' : brl(n)}`);
    return erro ? null : n;
  };
  const top = async (nomeCampo, conjunto, titulo, n = 10) => {
    const expr = expressao(config, conjunto);
    const { h, layout } = await cubo({
      qDimensions: [{ qDef: { qFieldDefs: [nomeCampo] }, qNullSuppression: true }],
      qMeasures: [{ qDef: { qDef: expr }, qSortBy: { qSortByNumeric: -1 } }],
      qInterColumnSortOrder: [1, 0], qSuppressZero: true, qInitialDataFetch: [],
    });
    console.log(`\n${titulo} (${layout.qSize.qcy} com valor)`);
    if (layout.qDimensionInfo?.[0]?.qError) { console.log(`  o campo "${nomeCampo}" NÃO EXISTE no app`); return; }
    const linhas = (await engine.rpc(h, 'GetHyperCubeData', { qPath: '/qHyperCubeDef', qPages: [{ qTop: 0, qLeft: 0, qWidth: 2, qHeight: n }] })).qDataPages[0].qMatrix;
    linhas.forEach(l => console.log(`  ${String(l[0].qText).padEnd(46)} ${brl(l[1].qNum)}`));
  };

  // Peças do mesmo filtro que o Worker monta (worker/qlik-engine.js → montarConjunto).
  const completo = montarConjunto({ config, codigoCliente: cliente, padraoFornecedor: lab, inicio, fim });
  const partes = completo.slice(1, -1).split(/, (?=\[)/);
  const [pCliente, pLab, pData, ...pFiltros] = partes;
  const junta = (...p) => `<${p.join(', ')}>`;

  console.log('1. Onde o valor zera (cada linha acrescenta um filtro)');
  await valor('', 'App inteiro, sem filtro');
  await valor(junta(pCliente), `Só o cliente ${cliente}`);
  await valor(junta(pCliente, pData), '+ período');
  for (const f of pFiltros) await valor(junta(pCliente, pData, f), `+ período + ${f.split('=')[0]} (só este)`);
  await valor(junta(pCliente, pData, ...pFiltros), '+ período + todos os filtros fixos');
  await valor(completo, `+ laboratório ${lab} (= consulta do app)`);

  console.log('\n2. Valores dos filtros fixos para este cliente no período');
  for (const f of config.filtros) await top(f.campo, junta(pCliente, pData), `${f.campo} (o app exige "${f.valor}")`, 8);

  const alvo = alvoLaboratorio(config, lab);
  await top(alvo.campo, junta(pCliente, pData, ...pFiltros), `3. ${alvo.campo} — de quem o cliente comprou no período`, 15);

  console.log(`
Como ler:
- "Só o cliente" em R$ 0,00: o código não existe nesta base ou a chave não vê os dados (section access).
- Zera em "+ período": o campo de data (${config.campos.data}) não tem vendas no período ou mudou de nome.
- Zera em "+ <filtro>": o valor exigido não existe mais. Ajuste QLIK_FILTROS no Worker (wrangler.jsonc → vars).
- Só zera em "+ laboratório": o padrão do laboratório não bate. Veja a lista 3 e ajuste LABORATORIO_QLIK em public/config.js.
- Tudo com valor aqui, mas o app mostra R$ 0,00: a chave do Worker não é a do .env. Rode
    npx wrangler secret put QLIK_API_KEY
  com a mesma chave do .env e publique de novo.`);
} finally {
  engine.fechar();
}
