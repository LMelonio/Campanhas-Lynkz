// Testes da consulta das comissões no Qlik (worker/qlik-engine.js e rota /api/qlik/comissoes).
// Qlik de mentira em memória: sem rede e sem pacote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirEngine, consultarComissoes, consultarBaseComissoes, conjuntoPeriodo, codigoFornecedorSeguro, serialQlik, CONFIG_PADRAO } from '../worker/qlik-engine.js';
import worker, { tratarComissoes } from '../worker/index.js';

const VENDAS = [   // vendedor, total, farelo
  ['ELIELSON SERPA MENDES', 211006.51, 26336.69],
  ['SELDIANA ARAUJO BARROS', 125709.18, 16423.12],
  ['TERRAZOO', 9999.9, 0],
];
const CONTRATO = [  // vendedor, cliente, valor
  ['SELDIANA ARAUJO BARROS', '100', 1500],
  ['SELDIANA ARAUJO BARROS', '101', -20],
  ['ALEX REPRESENTAÇÕES', '100', 300.5],
];

const BASE = [  // data (série do Qlik), cód. fornecedor, fornecedor, segmento, marca, cód. vendedor, vendedor, produto, valor
  [46291, '6610', 'FARELO', 'AGRO', 'FARELO', '12', 'SELDIANA ARAUJO BARROS', 'FARELO 50KG', 16423.12],
  [46291, '7064', 'OURO FINO', 'PET FARMACIA', 'PROTEÇÃO', '12', 'SELDIANA ARAUJO BARROS', '-', 109286.06],
];

function qlikFalso({ semVendedor = 0, campoInexistente = null } = {}) {
  const defs = new Map();
  const ouvintes = { message: [], close: [], error: [] };
  const enviados = [];
  const soquete = {
    addEventListener: (t, fn) => ouvintes[t].push(fn),
    close: () => ouvintes.close.forEach(fn => fn({})),
    send(texto) {
      const m = JSON.parse(texto);
      enviados.push(m);
      const responder = result => setTimeout(() => ouvintes.message.forEach(fn => fn({ data: JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) })), 0);
      if (m.method === 'OpenDoc') return responder({ qReturn: { qHandle: 1 } });
      if (m.method === 'CreateSessionObject') {
        const h = 10 + defs.size;
        defs.set(h, m.params.qProp.qHyperCubeDef);
        return responder({ qReturn: { qHandle: h } });
      }
      const d = defs.get(m.handle);
      const nDims = d.qDimensions.length;
      if (m.method === 'GetLayout') {
        const total = VENDAS.reduce((s, v) => s + v[1], 0) + semVendedor;
        return responder({ qLayout: { qHyperCube: {
          qSize: { qcx: nDims + d.qMeasures.length, qcy: nDims === 1 ? VENDAS.length : nDims === 8 ? BASE.length : CONTRATO.length },
          qDimensionInfo: d.qDimensions.map(x => (x.qDef.qFieldDefs[0] === campoInexistente ? { qError: { qErrorCode: 7 } } : {})),
          qMeasureInfo: d.qMeasures.map(() => ({})),
          qGrandTotalRow: [{ qNum: total }],
        } } });
      }
      if (m.method === 'GetHyperCubeData') {
        const p = m.params.qPages[0];
        const fonte = nDims === 1
          ? VENDAS.map(([v, t, f]) => [{ qText: v }, { qNum: t }, { qNum: f }])
          : nDims === 8 ? BASE.map(l => [{ qNum: l[0], qText: '26/09/2026' }, ...l.slice(1, 8).map(x => ({ qText: x })), { qNum: l[8] }])
          : CONTRATO.map(([v, c, x]) => [{ qText: v }, { qText: c }, { qNum: x }]);
        return responder({ qDataPages: [{ qMatrix: fonte.slice(p.qTop, p.qTop + p.qHeight) }] });
      }
    },
  };
  return { soquete, defs, enviados };
}

const PERIODOS = { apuracao: { inicio: '2026-09-26', fim: '2026-10-25' }, contrato: { inicio: '2026-09-01', fim: '2026-09-30' } };

test('conjunto do período: data por expressão, filtros fixos e {1} (ignora seleções salvas)', () => {
  const s = conjuntoPeriodo({ inicio: '2026-09-26', fim: '2026-10-25' });
  assert.ok(s.includes(`>=${serialQlik('2026-09-26')} and`));
  assert.ok(s.includes(`<${serialQlik('2026-10-25') + 1}"}`));
  assert.ok(s.includes(`[Unidade de Negócio]={'ATACADO'}`) && s.includes(`[Intercompany Geral]={'REGULAR'}`));
  assert.ok(!s.includes('Cód. Cliente'));
  assert.equal(codigoFornecedorSeguro(' 6610 '), '6610');
  for (const ruim of ['', '66a', "6610'", '1'.repeat(11)]) assert.throws(() => codigoFornecedorSeguro(ruim));
});

test('consultarComissoes: vendas por vendedor (total e Farelo) e linhas do contrato', async () => {
  const q = qlikFalso({ semVendedor: 12.34 });
  const r = await consultarComissoes(abrirEngine(q.soquete), { appId: 'app', ...PERIODOS, codFarelo: '6610' });
  assert.deepEqual(r.apuracao.vendas[1], { vendedor: 'SELDIANA ARAUJO BARROS', total: 125709.18, farelo: 16423.12 });
  assert.equal(r.apuracao.vendas.length, 3);
  assert.equal(r.apuracao.sem_vendedor, 12.34);
  assert.deepEqual(r.contrato.linhas[1], { vendedor: 'SELDIANA ARAUJO BARROS', cliente: '101', valor: -20 });
  assert.deepEqual([r.contrato.inicio, r.contrato.fim], ['2026-09-01', '2026-09-30']);

  const [cuboVendas, cuboContrato] = [...q.defs.values()];
  assert.equal(cuboVendas.qDimensions[0].qDef.qFieldDefs[0], 'Vendedor B2B');
  const [total, farelo] = cuboVendas.qMeasures.map(x => x.qDef.qDef);
  assert.ok(total.startsWith('Sum({1<') && total.includes('[Valor Faturamento Bruto s/ Devolução Vendas]'));
  assert.ok(!total.includes('Cód. Fornecedor'));
  assert.ok(farelo.includes(`[Cód. Fornecedor]={'6610'}`));
  assert.deepEqual(cuboContrato.qDimensions.map(x => x.qDef.qFieldDefs[0]), ['Vendedor B2B', 'Cód. Cliente']);
  assert.ok(cuboContrato.qMeasures[0].qDef.qDef.includes(`>=${serialQlik('2026-09-01')} and`));
  assert.equal(cuboVendas.qSuppressZero, true);
});

test('campo do vendedor inexistente vira mensagem de configuração', async () => {
  const q = qlikFalso({ campoInexistente: 'Vendedor B2B' });
  await assert.rejects(consultarComissoes(abrirEngine(q.soquete), { appId: 'app', ...PERIODOS, codFarelo: '6610' }), /QLIK_CAMPOS/);
});

test('consultarBaseComissoes: vendas linha a linha com as colunas da extração manual', async () => {
  const q = qlikFalso();
  const r = await consultarBaseComissoes(abrirEngine(q.soquete), { appId: 'app', apuracao: PERIODOS.apuracao });
  assert.deepEqual(r.linhas[0], { data: '2026-09-26', cod_fornecedor: '6610', fornecedor: 'FARELO', segmento: 'AGRO', marca: 'FARELO',
    cod_vendedor: '12', vendedor: 'SELDIANA ARAUJO BARROS', produto: 'FARELO 50KG', valor: 16423.12 });
  assert.equal(r.linhas[1].produto, '', 'traço do Qlik vira vazio');
  const [cubo] = [...q.defs.values()];
  assert.deepEqual(cubo.qDimensions.map(x => x.qDef.qFieldDefs[0]),
    ['Data Venda', 'Cód. Fornecedor', 'Nome Fantasia Fornecedor', 'Segmento', 'Marca do Produto', 'Cód. Vendedor B2B', 'Vendedor B2B', 'Produto']);
  assert.ok(cubo.qMeasures[0].qDef.qDef.includes(`>=${serialQlik('2026-09-26')} and`));
  await assert.rejects(consultarBaseComissoes(abrirEngine(qlikFalso({ campoInexistente: 'Segmento' }).soquete), { appId: 'app', apuracao: PERIODOS.apuracao }), /QLIK_CAMPOS/);
});

// ---------- rota ----------
const OK = { apuracao_inicio: '2026-09-26', apuracao_fim: '2026-10-25', contrato_inicio: '2026-09-01', contrato_fim: '2026-09-30', cod_farelo: '6610' };
const req = corpo => new Request('https://app.lynkz/api/qlik/comissoes', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer a.b.c', Origin: 'https://app.lynkz' }, body: JSON.stringify(corpo),
});
const chamar = (r, conferir) => worker.fetch(r, { QLIK_APP_ID: 'app' }, {}, { conferir, conectar: async () => qlikFalso().soquete });

test('rota: só administrador ativo consulta as comissões', async () => {
  assert.equal((await chamar(req(OK), async () => null)).status, 401);
  assert.equal((await chamar(req(OK), async () => 'u1')).status, 403);                                 // sem papel conhecido
  assert.equal((await chamar(req(OK), async () => ({ id: 'u2', papel: 'coordenador' }))).status, 403);
  const r = await chamar(req(OK), async () => ({ id: 'u3', papel: 'aprovador' }));
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.apuracao.vendas.length, 3);
  assert.equal(corpo.cod_farelo, '6610');
  assert.ok(corpo.consultado_em);
});

test('rota: { base: true } devolve só a base do período', async () => {
  const r = await chamar(req({ apuracao_inicio: '2026-09-26', apuracao_fim: '2026-10-25', base: true }), async () => ({ id: 'u3', papel: 'aprovador' }));
  assert.equal(r.status, 200);
  const corpo = await r.json();
  assert.equal(corpo.base.linhas.length, 2);
  assert.equal(corpo.apuracao, undefined);
});

test('rota: pedidos fora do formato são recusados antes de ir ao Qlik', async () => {
  const conectar = async () => { throw new Error('não devia conectar'); };
  for (const ruim of [
    { ...OK, cod_farelo: '66;10' },
    { ...OK, apuracao_inicio: '2026-10-26' },                 // fim antes do início
    { ...OK, contrato_inicio: '2026-01-01' },                 // longo demais
    { ...OK, apuracao_fim: '2026-02-30' },                    // data que não existe
  ]) await assert.rejects(tratarComissoes(req(ruim), {}, { conectar }), e => e.status === 400);
});

test('rota de compras continua igual para quem não é administrador', async () => {
  const r = await worker.fetch(new Request('https://app.lynkz/api/qlik/xyz', { method: 'POST' }), {}, {}, {});
  assert.equal(r.status, 404);
  assert.ok(CONFIG_PADRAO.campos.vendedor && CONFIG_PADRAO.campos.codigoFornecedor);
});
