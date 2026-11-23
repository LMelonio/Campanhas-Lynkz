// Testes da consulta de compras no Qlik (worker/qlik-engine.js e worker/index.js).
// Usam um Qlik de mentira em memória: não precisam de rede nem de pacote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirEngine, consultarCompras, montarConjunto, serialQlik, dataDoSerial, valorSeguro, expressao, CONFIG_PADRAO } from '../worker/qlik-engine.js';
import { tratarCompras, configDoEnv } from '../worker/index.js';

// ---------- Qlik de mentira ----------
const NOTAS = [   // número, série, data (serial), valor
  ['210818', '1', serialQlik('2026-10-05'), 1200.5],
  ['209001', '1', serialQlik('2026-10-02'), 300],
  ['211500', '2', serialQlik('2026-10-20'), 99.99],
];
function qlikFalso({ campoInexistente = null, medidaComErro = false } = {}) {
  const defs = new Map();   // handle → definição do hipercubo
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
      if (m.method === 'GetLayout') {
        const d = defs.get(m.handle);
        const nDims = d.qDimensions.length;
        const info = d.qDimensions.map(x => (x.qDef.qFieldDefs[0] === campoInexistente ? { qError: { qErrorCode: 7 } } : {}));
        const ehMarca = d.qDimensions[0]?.qDef.qFieldDefs[0] === 'Marca do Produto';
        const linhas = nDims === 2 ? NOTAS.length : ehMarca ? 2 : nDims === 1 ? 1 : 0;
        return responder({ qLayout: { qHyperCube: {
          qSize: { qcx: nDims + 1, qcy: linhas }, qDimensionInfo: info,
          qMeasureInfo: [medidaComErro ? { qError: { qErrorCode: 1 } } : {}],
          qGrandTotalRow: [{ qNum: 1600.49, qText: '1.600,49' }],
        } } });
      }
      if (m.method === 'GetHyperCubeData') {
        const def = defs.get(m.handle);
        const nDims = def.qDimensions.length;
        const ehMarca = def.qDimensions[0]?.qDef.qFieldDefs[0] === 'Marca do Produto';
        const p = m.params.qPages[0];
        const matriz = ehMarca
          ? [[{ qText: 'PROTEÇÃO' }, { qNum: 399.99 }], [{ qText: 'WELLPET' }, { qNum: 1200.5 }]]
          : nDims === 2
          ? NOTAS.slice(p.qTop, p.qTop + p.qHeight).map(([n, s, d, v]) => [{ qText: n }, { qText: s }, { qNum: v }, { qNum: d }])
          : [[{ qText: 'OURO FINO SAUDE ANIMAL' }, { qNum: 1600.49 }]];
        return responder({ qDataPages: [{ qMatrix: matriz }] });
      }
    },
  };
  return { soquete, enviados, defs };
}

const PEDIDO = { appId: 'app-1', codigoCliente: '4821', padraoFornecedor: '*Ouro Fino*', inicio: '2026-10-01', fim: '2026-10-31' };

test('datas viram número de série do Qlik e voltam', () => {
  assert.equal(serialQlik('1899-12-30'), 0);
  assert.equal(serialQlik('2026-10-26'), 46321);
  assert.equal(dataDoSerial(46321), '2026-10-26');
  assert.throws(() => serialQlik('2026-02-30'), /Data inválida/);
  assert.throws(() => serialQlik('26/10/2026'), /Data inválida/);
});

test('filtro do Qlik: cliente, laboratório, período e filtros fixos', () => {
  const set = montarConjunto(PEDIDO);
  assert.match(set, /\[Cód\. Cliente\]=\{'4821'\}/);
  assert.match(set, /\[Nome Fantasia Fornecedor\]=\{"\*Ouro Fino\*"\}/);
  const [a, b] = [serialQlik('2026-10-01'), serialQlik('2026-10-31')];
  assert.ok(set.includes(`[Data Venda]={"=Num([Data Venda])>=${a} and Num([Data Venda])<=${b}"}`), set);
  assert.match(set, /\[Unidade de Negócio\]=\{'ATACADO'\}/);
  assert.match(set, /\[Intercompany Geral\]=\{'REGULAR'\}/);
  assert.match(expressao(CONFIG_PADRAO, set), /^Sum\(\{<.*>\} \[Valor Faturamento Bruto s\/ Devolução Vendas\]\)$/);
  assert.ok(!set.includes('Tipo_Periodo_Mes_vendas'), 'sem filtro de período-tipo (não muda o total)');
});

test('marca escolhida filtra total e notas; a lista de marcas continua sem o filtro', async () => {
  const set = montarConjunto({ ...PEDIDO, marca: 'WELLPET' });
  assert.match(set, /\[Marca do Produto\]=\{"WELLPET"\}/);
  assert.ok(!montarConjunto(PEDIDO).includes('Marca do Produto'), 'sem marca escolhida, sem filtro de marca');
  const { soquete, enviados } = qlikFalso();
  await consultarCompras(abrirEngine(soquete), { ...PEDIDO, marca: 'WELLPET' });
  const exprs = enviados.filter(e => e.method === 'CreateSessionObject').map(e => e.params.qProp.qHyperCubeDef.qMeasures[0].qDef.qDef);
  assert.equal(exprs.length, 4, 'total, notas, fornecedores e marcas');
  assert.ok(exprs.slice(0, 3).every(x => x.includes('[Marca do Produto]={"WELLPET"}')), 'total, notas e fornecedores usam a marca');
  assert.ok(!exprs[3].includes('Marca do Produto'), 'a lista de marcas ignora a marca escolhida');
  assert.throws(() => montarConjunto({ ...PEDIDO, marca: 'a"b' }), /Marca inválido/);
});

test('laboratório que no Qlik é marca usa o campo de marca', () => {
  const set = montarConjunto({ ...PEDIDO, padraoFornecedor: 'marca:CATLIFE' });
  assert.match(set, /\[Marca do Produto\]=\{"CATLIFE"\}/);
  assert.ok(!set.includes('Nome Fantasia Fornecedor'));
  assert.match(montarConjunto({ ...PEDIDO, padraoFornecedor: 'OURO FINO*' }), /\[Nome Fantasia Fornecedor\]=\{"OURO FINO\*"\}/);
});

test('texto vindo do usuário não vira expressão do Qlik', () => {
  for (const ruim of [`x'}) + Sum(Total [Valor]`, 'a"b', '$(vazio)', 'a;b', '{', '', '   ', 'x'.repeat(81)]) {
    assert.throws(() => valorSeguro(ruim, 'Campo'), /inválido/, JSON.stringify(ruim));
  }
  assert.equal(valorSeguro('  *Biog*  ', 'Campo'), '*Biog*');
});

test('consulta: total, notas em ordem de data e fornecedores encontrados', async () => {
  const { soquete, enviados } = qlikFalso();
  const engine = abrirEngine(soquete);
  const r = await consultarCompras(engine, PEDIDO);
  assert.equal(r.total, 1600.49);
  assert.deepEqual(r.notas.map(n => n.numero), ['209001', '210818', '211500'], 'ordenadas por data');
  assert.deepEqual(r.notas[1], { numero: '210818', serie: '1', data: '2026-10-05', valor: 1200.5 });
  assert.deepEqual(r.fornecedores, ['OURO FINO SAUDE ANIMAL']);
  assert.deepEqual(r.marcas, [{ nome: 'WELLPET', valor: 1200.5 }, { nome: 'PROTEÇÃO', valor: 399.99 }], 'marcas do período, da maior para a menor');
  assert.equal(enviados[0].params.qDocName, 'app-1');
  const expr = enviados.find(e => e.method === 'CreateSessionObject').params.qProp.qHyperCubeDef.qMeasures[0].qDef.qDef;
  assert.match(expr, /4821/);
  engine.fechar();
});

test('notas: a data é medida (Min), nunca dimensão — senão a mesma nota se repete em vários dias', async () => {
  // Erro visto no Qlik real: com filtro de data no conjunto, a medida ignora a data da linha.
  const { soquete, enviados } = qlikFalso();
  await consultarCompras(abrirEngine(soquete), PEDIDO);
  const cubos = enviados.filter(e => e.method === 'CreateSessionObject').map(e => e.params.qProp.qHyperCubeDef);
  const notas = cubos.find(c => c.qDimensions.length === 2);
  assert.ok(notas, 'cubo das notas tem só nota e série como dimensões');
  assert.ok(!notas.qDimensions.some(d => d.qDef.qFieldDefs[0] === 'Data Venda'), 'data fora das dimensões');
  assert.match(notas.qMeasures[1].qDef.qDef, /^Min\(\{<.*>\} \[Data Venda\]\)$/);
});

test('campo que não existe no Qlik dá mensagem que diz o que fazer', async () => {
  const { soquete } = qlikFalso({ campoInexistente: 'Núm. Nota Fiscal Vendas' });
  await assert.rejects(consultarCompras(abrirEngine(soquete), PEDIDO), /campo de nota fiscal não existe.*descobrir-campos-qlik/);
});

test('expressão com erro no Qlik dá mensagem que diz o que fazer', async () => {
  const { soquete } = qlikFalso({ medidaComErro: true });
  await assert.rejects(consultarCompras(abrirEngine(soquete), PEDIDO), /QLIK_EXPRESSAO_VALOR/);
});

test('Qlik que não responde estoura o tempo em vez de travar', async () => {
  const mudo = { addEventListener() {}, send() {}, close() {} };
  const engine = abrirEngine(mudo, { tempoMs: 30 });
  await assert.rejects(engine.rpc(-1, 'OpenDoc', {}), /demorou demais/);
});

test('rota: valida o pedido antes de falar com o Qlik e devolve o resultado', async () => {
  const env = { QLIK_APP_ID: 'app-1' };
  const pedido = corpo => new Request('https://x/api/qlik/compras', { method: 'POST', body: JSON.stringify(corpo) });
  let conexoes = 0;
  const conectar = async () => { conexoes++; return qlikFalso().soquete; };

  for (const ruim of [
    { codigo_cliente: '4821', fornecedor_padrao: '*Ouro*', inicio: '2026-10-31', fim: '2026-10-01' },
    { codigo_cliente: '4821', fornecedor_padrao: '*Ouro*', inicio: '2025-01-01', fim: '2026-10-01' },
    { codigo_cliente: "1'} x", fornecedor_padrao: '*Ouro*', inicio: '2026-10-01', fim: '2026-10-31' },
    { codigo_cliente: '4821', fornecedor_padrao: '', inicio: '2026-10-01', fim: '2026-10-31' },
  ]) await assert.rejects(tratarCompras(pedido(ruim), env, { conectar }), e => e.status === 400);
  assert.equal(conexoes, 0, 'pedido inválido nem chega ao Qlik');

  const resp = await tratarCompras(pedido({ codigo_cliente: '4821', fornecedor_padrao: '*Ouro Fino*', inicio: '2026-10-01', fim: '2026-10-31' }), env, { conectar });
  assert.equal(resp.status, 200);
  const corpo = await resp.json();
  assert.equal(corpo.total, 1600.49);
  assert.equal(corpo.notas.length, 3);
  assert.ok(corpo.consultado_em);
});

test('configuração do Worker: padrão da LYNKZ e troca por variável', () => {
  assert.equal(configDoEnv({}).campos.fornecedor, 'Nome Fantasia Fornecedor');
  const c = configDoEnv({ QLIK_CAMPOS: '{"fornecedor":"Fornecedor X"}', QLIK_EXPRESSAO_VALOR: 'Sum({SET} Valor)' });
  assert.equal(c.campos.fornecedor, 'Fornecedor X');
  assert.equal(c.campos.cliente, 'Cód. Cliente');
  assert.equal(c.expressaoValor, 'Sum({SET} Valor)');
  assert.throws(() => configDoEnv({ QLIK_CAMPOS: '{quebrado' }), /JSON inválido/);
});
