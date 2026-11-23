#!/usr/bin/env node
// ============================================================
//  DESCOBRIR CAMPOS DO QLIK — só lê, não grava nada em lugar nenhum.
//
//    npm run qlik:descobrir
//
//  Usa o .env (QLIK_TENANT, QLIK_API_KEY, QLIK_APP_ID) e mostra:
//   1. se cada campo usado nas consultas existe no app (e sugere parecidos);
//   2. as medidas mestras do app com a definição (para achar a do valor);
//   3. os fornecedores do Qlik e qual deles cada laboratório do app pega
//      (o padrão é o de public/js/dados/qlik.js: *primeira palavra*, ou
//      LABORATORIO_QLIK em public/config.js).
//  Com isso você ajusta QLIK_CAMPOS e QLIK_EXPRESSAO_VALOR (Worker) sem chute.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import WebSocket from 'ws';
import { RAIZ, lerEnv, exigirEnv } from './lib/env.mjs';
import { abrirEngine, CONFIG_PADRAO } from '../worker/qlik-engine.js';

const env = lerEnv();
exigirEnv(env, ['QLIK_TENANT', 'QLIK_API_KEY', 'QLIK_APP_ID']);
const ctx = { window: {} };
vm.runInNewContext(readFileSync(join(RAIZ, 'public', 'config.js'), 'utf8'), ctx);
const LABS = ctx.window.CONFIG.LABORATORIOS || [];
const MAPA = ctx.window.CONFIG.LABORATORIO_QLIK || {};

const base = /^wss?:\/\//.test(env.QLIK_TENANT) ? env.QLIK_TENANT : 'wss://' + env.QLIK_TENANT.replace(/^https?:\/\//, '');
const ws = new WebSocket(`${base.replace(/\/+$/, '')}/app/${encodeURIComponent(env.QLIK_APP_ID)}`, { headers: { Authorization: `Bearer ${env.QLIK_API_KEY}` } });
await new Promise((ok, falha) => { ws.once('open', ok); ws.once('error', e => falha(new Error(`Não conectou no Qlik: ${e.message}`))); });
const engine = abrirEngine(ws);

const semAcento = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const padraoDoLab = lab => {
  if (MAPA[lab]) return MAPA[lab];
  const p = String(lab).trim().split(/\s+/)[0];
  const ate = p.search(/[^A-Za-z0-9]/);
  return `*${ate > 0 ? p.slice(0, ate) : p}*`;
};
const comoRegex = pad => new RegExp('^' + pad.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');

try {
  const doc = (await engine.rpc(-1, 'OpenDoc', { qDocName: env.QLIK_APP_ID })).qReturn.qHandle;
  const objeto = async qProp => {
    const h = (await engine.rpc(doc, 'CreateSessionObject', { qProp })).qReturn.qHandle;
    return (await engine.rpc(h, 'GetLayout')).qLayout;
  };

  // 1) campos
  const campos = (await objeto({ qInfo: { qType: 'FieldList' }, qFieldListDef: {} })).qFieldList.qItems.map(i => i.qName).filter(n => !n.startsWith('$'));
  console.log(`\nO app tem ${campos.length} campos.\n\n1. Campos usados nas consultas`);
  const usados = [...Object.entries(CONFIG_PADRAO.campos).map(([k, n]) => [`campos.${k}`, n]), ...CONFIG_PADRAO.filtros.map(f => ['filtro', f.campo])];
  for (const [para, nome] of usados) {
    if (campos.includes(nome)) { console.log(`  ok   ${para.padEnd(18)} ${nome}`); continue; }
    const pal = semAcento(nome).split(/\W+/).filter(w => w.length > 3);
    const parecidos = campos.filter(c => pal.some(w => semAcento(c).includes(w))).slice(0, 6);
    console.log(`  FALTA ${para.padEnd(17)} ${nome}${parecidos.length ? `  → parecidos: ${parecidos.join(' | ')}` : ''}`);
  }

  // 2) medidas mestras
  const medidas = (await objeto({ qInfo: { qType: 'MeasureList' }, qMeasureListDef: { qType: 'measure', qData: { title: '/qMetaDef/title', expression: '/qMeasure/qDef' } } })).qMeasureList.qItems;
  console.log(`\n2. Medidas mestras (${medidas.length}) com "receita" ou "valor" no nome`);
  for (const m of medidas.filter(m => /receit|valor|fatur|venda/i.test(m.qData?.title || ''))) console.log(`  ${m.qData.title}\n      = ${m.qData.expression}`);
  console.log('  Se o valor certo é uma medida mestra, copie a expressão dela para QLIK_EXPRESSAO_VALOR trocando o Sum(...) por Sum({SET} ...).');

  // 3) fornecedores
  const campoForn = CONFIG_PADRAO.campos.fornecedor;
  if (campos.includes(campoForn)) {
    const lista = (await objeto({ qInfo: { qType: 'ListaFornecedores' }, qListObjectDef: { qDef: { qFieldDefs: [campoForn] }, qInitialDataFetch: [{ qTop: 0, qLeft: 0, qWidth: 1, qHeight: 3000 }] } })).qListObject;
    const fornecedores = lista.qDataPages[0].qMatrix.map(l => l[0].qText);
    console.log(`\n3. Fornecedores no Qlik (${fornecedores.length}) e o que cada laboratório do app pega`);
    for (const lab of LABS) {
      const pad = padraoDoLab(lab);
      const re = comoRegex(pad);
      const achou = fornecedores.filter(f => re.test(f));
      console.log(`  ${lab.padEnd(22)} ${pad.padEnd(14)} ${achou.length ? achou.slice(0, 5).join(' | ') + (achou.length > 5 ? ' …' : '') : 'NÃO ACHOU (ajuste LABORATORIO_QLIK em public/config.js)'}`);
    }
  }
} finally {
  engine.fechar();
}
