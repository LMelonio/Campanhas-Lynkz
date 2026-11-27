#!/usr/bin/env node
// ============================================================
//  CONFERIR COMISSÕES NO QLIK — só lê, não grava nada.
//
//    npm run qlik:comissoes -- --mes 2026-10 --planilha "C:/…/Comissões Lynkz - Outubro 2026.xlsx"
//
//  Faz a MESMA consulta do Worker (/api/qlik/comissoes) e compara com a
//  planilha de comissões do mês, vendedor por vendedor:
//    - aba "Base Qlik 26 - 25": venda total e Farelo de cada "Vendedor B2B";
//    - aba "Contrato de Resultado - Mês": realizado de faturamento e positivação.
//  É a condição para usar o app: o mês tem de bater ao centavo. Se não bater,
//  o filtro da extração é diferente do app (ATACADO/REGULAR, data, medida) e
//  a diferença por vendedor mostra onde olhar.
//  Sem --planilha: só mostra o que o Qlik devolve.
//
//  Usa o .env (QLIK_TENANT, QLIK_API_KEY, QLIK_APP_ID). Corte e Farelo: --corte 25 --farelo 6610.
// ============================================================
import { createRequire } from 'node:module';
import WebSocket from 'ws';
import { lerEnv, exigirEnv } from './lib/env.mjs';
import { abrirEngine, consultarComissoes, CONFIG_PADRAO } from '../worker/qlik-engine.js';
import { periodoApuracao, mesAnteriorFechado, chaveNome, realizadosContrato } from '../public/js/lib/comissoes.js';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s--/).map(s => s.replace(/^--/, '').trim()).filter(Boolean)
  .map(s => { const i = s.indexOf(' '); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
if (!/^\d{4}-\d{2}$/.test(args.mes || '')) {
  console.error('Uso: npm run qlik:comissoes -- --mes 2026-10 [--planilha "Comissões Lynkz - Outubro 2026.xlsx"] [--corte 25] [--farelo 6610]');
  process.exit(2);
}
const corte = Number(args.corte || 25);
const farelo = String(args.farelo || '6610');
const apuracao = periodoApuracao(args.mes, corte);
const contrato = mesAnteriorFechado(args.mes);
const brl = n => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cent = n => Math.round((Number(n) || 0) * 100);

// ---------- planilha (opcional) ----------
let planilha = null;
if (args.planilha) {
  const XLSX = createRequire(import.meta.url)('xlsx');
  const wb = XLSX.readFile(args.planilha, { cellDates: true });
  const aba = wb.SheetNames.find(n => /^Base Qlik/i.test(n));
  if (!aba) { console.error('A planilha não tem a aba "Base Qlik 26 - 25".'); process.exit(2); }
  const vendas = new Map();
  let menor = null, maior = null;
  for (const l of XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: null })) {
    if (!l['Vendedor B2B']) continue;
    const k = chaveNome(l['Vendedor B2B']);
    const v = vendas.get(k) || { vendedor: String(l['Vendedor B2B']).trim(), total: 0, farelo: 0 };
    const valor = Number(l['Receita (- dev.)']) || 0;
    v.total += valor;
    if (String(l['Cód. Fornecedor']).trim() === farelo) v.farelo += valor;
    vendas.set(k, v);
    const d = l.Data instanceof Date ? l.Data.toISOString().slice(0, 10) : null;
    if (d) { if (!menor || d < menor) menor = d; if (!maior || d > maior) maior = d; }
  }
  const contratoPlan = new Map();
  const abaC = wb.SheetNames.find(n => /^Contrato de Resultado/i.test(n));
  if (abaC) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[abaC], { header: 1, defval: null });
    const i = linhas.findIndex(l => l.includes('PARTICIPANTE'));
    const cab = linhas[i] || [];
    const col = nome => cab.findIndex(c => String(c || '').trim() === nome);
    for (const l of linhas.slice(i + 1)) {
      const nome = l[col('PARTICIPANTE')];
      if (!nome || /formato/i.test(nome)) break;
      contratoPlan.set(chaveNome(nome), { nome, faturamento: Number(l[col('REALIZADO FAT.')]) || 0, positivados: Number(l[col('REALIZADO POSITIVAÇÃO')]) || 0 });
    }
  }
  planilha = { vendas, contrato: contratoPlan, menor, maior };
}

// ---------- Qlik ----------
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
let r;
try {
  r = await consultarComissoes(engine, { appId: env.QLIK_APP_ID, config: CONFIG_PADRAO, apuracao, contrato });
} finally { engine.fechar(); }
// A consulta vem por vendedor × fornecedor (formato 2): junta por vendedor, com o Farelo à parte, como na planilha.
{
  const porVendedor = new Map();
  for (const v of r.apuracao.vendas) {
    const a = porVendedor.get(v.vendedor) || { vendedor: v.vendedor, totalC: 0, fareloC: 0 };
    a.totalC += cent(v.total);
    if (v.cod_fornecedor === farelo) a.fareloC += cent(v.total);
    porVendedor.set(v.vendedor, a);
  }
  r.apuracao.vendas = [...porVendedor.values()].map(a => ({ vendedor: a.vendedor, total: a.totalC / 100, farelo: a.fareloC / 100 }));
}

console.log(`\nApuração ${args.mes}: ${apuracao.inicio} a ${apuracao.fim} · Farelo ${farelo} · Contrato: ${contrato.inicio} a ${contrato.fim}`);
console.log(`Qlik: ${r.apuracao.vendas.length} vendedores · total R$ ${brl(r.apuracao.total)}${r.apuracao.sem_vendedor ? ` · sem vendedor R$ ${brl(r.apuracao.sem_vendedor)}` : ''}`);

// ---------- comparação ----------
const pad = (t, n) => String(t).slice(0, n).padEnd(n);
const num = (t, n = 15) => String(t).padStart(n);
let diferencas = 0;
console.log('\nVENDAS (apuração)');
console.log(`${pad('Vendedor B2B', 38)}${num('Qlik total')}${num('Planilha')}${num('Dif.', 12)}${num('Qlik Farelo')}${num('Planilha', 13)}`);
const nomes = new Map(r.apuracao.vendas.map(v => [chaveNome(v.vendedor), v]));
if (planilha) for (const [k, v] of planilha.vendas) if (!nomes.has(k)) nomes.set(k, null);
for (const [k, q] of [...nomes].sort((a, b) => (b[1]?.total || 0) - (a[1]?.total || 0))) {
  const p = planilha?.vendas.get(k);
  const dif = planilha ? cent(q?.total) - cent(p?.total) : 0;
  const difF = planilha ? cent(q?.farelo) - cent(p?.farelo) : 0;
  if (dif || difF) diferencas++;
  const marca = planilha && (dif || difF) ? '  ←' : '';
  console.log(`${pad(q?.vendedor || p?.vendedor, 38)}${num(brl(q?.total))}${num(planilha ? brl(p?.total) : '-')}${num(planilha ? brl(dif / 100) : '-', 12)}${num(brl(q?.farelo))}${num(planilha ? brl(p?.farelo) : '-', 13)}${marca}`);
}

if (planilha?.contrato.size) {
  // Um comissionado por nome da planilha (o script não lê o cadastro do banco).
  const cad = [...planilha.contrato.values()].map((c, i) => ({ id: i, nomes_qlik: [c.nome] }));
  const real = realizadosContrato(r.contrato.linhas, cad);
  console.log('\nCONTRATO DE RESULTADO (mês anterior fechado)');
  console.log(`${pad('Participante', 38)}${num('Qlik fat.')}${num('Planilha')}${num('Qlik posit.', 12)}${num('Planilha', 10)}`);
  for (const c of cad) {
    const p = [...planilha.contrato.values()][c.id];
    const q = real.get(c.id) || { faturamento: 0, positivados: 0 };
    const ok = cent(q.faturamento) === cent(p.faturamento) && q.positivados === p.positivados;
    if (!ok) diferencas++;
    console.log(`${pad(p.nome, 38)}${num(brl(q.faturamento))}${num(brl(p.faturamento))}${num(q.positivados, 12)}${num(p.positivados, 10)}${ok ? '' : '  ←'}`);
  }
}

if (planilha) {
  if (planilha.menor && (planilha.menor < apuracao.inicio || planilha.maior > apuracao.fim)) {
    console.log(`\nATENÇÃO: a planilha tem datas de ${planilha.menor} a ${planilha.maior}, fora do período ${apuracao.inicio} a ${apuracao.fim}.`);
  }
  console.log(diferencas
    ? `\n${diferencas} linha(s) com diferença (←). Antes de usar o app, descubra o motivo: filtro da extração, campo de data ou medida.`
    : '\nTUDO BATE: o Qlik do app devolve o mesmo que a planilha, ao centavo.');
}
process.exit(0);
