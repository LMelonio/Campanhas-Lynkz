// Testes da consulta de compras no Qlik (worker/qlik-engine.js e worker/index.js).
// Usam um Qlik de mentira em memória: não precisam de rede nem de pacote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirEngine, consultarCompras, montarConjunto, serialQlik, dataDoSerial, valorSeguro, expressao, acharDevolvidas, CONFIG_PADRAO } from '../worker/qlik-engine.js';
import worker, { tratarCompras, configDoEnv, dentroDoLimite } from '../worker/index.js';

// ---------- Qlik de mentira ----------
const NOTAS = [   // número, série, data (serial), valor
  ['210818', '1', serialQlik('2026-10-05'), 1200.5],
  ['209001', '1', serialQlik('2026-10-02'), 300],
  ['211500', '2', serialQlik('2026-10-20'), 99.99],
];
// devolvida: true → a NF 209001 (R$ 300, série 1) foi devolvida inteira — o total cai para 1300,49.
//            'sem-par' → devolução de R$ 50 que não bate com nenhuma nota — o total cai para 1550,49.
function qlikFalso({ campoInexistente = null, medidaComErro = false, zero = null, devolvida = false } = {}) {
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
        const totalBase = devolvida === 'sem-par' ? 1550.49 : devolvida ? 1300.49 : 1600.49;
        const linhas = nDims === 2 ? NOTAS.length : ehMarca ? 2 : nDims === 1 ? 1 : 0;
        return responder({ qLayout: { qHyperCube: {
          qSize: { qcx: nDims + 1, qcy: linhas }, qDimensionInfo: info,
          qMeasureInfo: [medidaComErro ? { qError: { qErrorCode: 1 } } : {}],
          // zero: 'tudo' = Qlik sem dados do cliente; 'laboratorio' = comprou só de outros (500).
          qGrandTotalRow: [{ qNum: zero === 'tudo' ? 0 : zero === 'laboratorio' ? (JSON.stringify(d.qMeasures).includes('Nome Fantasia Fornecedor') ? 0 : 500) : totalBase, qText: '' }],
        } } });
      }
      if (m.method === 'GetHyperCubeData') {
        const def = defs.get(m.handle);
        const nDims = def.qDimensions.length;
        const ehMarca = def.qDimensions[0]?.qDef.qFieldDefs[0] === 'Marca do Produto';
        const ehDevolucao = def.qDimensions[0]?.qDef.qFieldDefs[0] === 'Série Nota Fiscal Origem';
        const p = m.params.qPages[0];
        const matriz = ehDevolucao ? [[{ qText: '1' }, { qNum: devolvida === 'sem-par' ? -50 : -300 }]]
          : ehMarca
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
  assert.ok(set.includes(`[Data Venda]={"=Only({1} Num([Data Venda]))>=${a} and Only({1} Num([Data Venda]))<${b + 1}"}`), set);
  assert.match(set, /\[Unidade de Negócio\]=\{'ATACADO'\}/);
  assert.match(set, /\[Intercompany Geral\]=\{'REGULAR'\}/);
  // {1<…>}: ignora as seleções salvas no app do Qlik (com elas, tudo dava R$ 0,00 — v2.8.1).
  assert.match(expressao(CONFIG_PADRAO, set), /^Sum\(\{1<.*>\} \[Valor Faturamento Bruto s\/ Devolução Vendas\]\)$/);
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
  assert.match(notas.qMeasures[1].qDef.qDef, /^Min\(\{1<.*>\} \[Data Venda\]\)$/);
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
  const pedido = corpo => new Request('https://x/api/qlik/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  let conexoes = 0;
  const conectar = async () => { conexoes++; return qlikFalso().soquete; };

  for (const ruim of [
    { codigo_cliente: '4821', fornecedor_padrao: '*Ouro*', inicio: '2026-10-31', fim: '2026-10-01' },
    { codigo_cliente: '4821', fornecedor_padrao: '*Ouro*', inicio: '2025-01-01', fim: '2026-10-01' },
    { codigo_cliente: "1'} x", fornecedor_padrao: '*Ouro*', inicio: '2026-10-01', fim: '2026-10-31' },
    { codigo_cliente: '4821', fornecedor_padrao: '', inicio: '2026-10-01', fim: '2026-10-31' },
    { codigo_cliente: '4821', fornecedor_padrao: '*', inicio: '2026-10-01', fim: '2026-10-31' },          // curinga sozinho = todos
    { codigo_cliente: '4821', fornecedor_padrao: '=1=1', inicio: '2026-10-01', fim: '2026-10-31' },       // busca por expressão
    { codigo_cliente: '4821', fornecedor_padrao: '>=0', inicio: '2026-10-01', fim: '2026-10-31' },        // busca numérica
    { codigo_cliente: '4821', fornecedor_padrao: '*Ouro*', marca: '=Sum(1)', inicio: '2026-10-01', fim: '2026-10-31' },
    { codigo_cliente: '*', fornecedor_padrao: '*Ouro*', inicio: '2026-10-01', fim: '2026-10-31' },
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

// ---------- segurança da rota (v2.6) ----------
const BASE = 'https://campanhas.exemplo/api/qlik/compras';
const OK = { codigo_cliente: '4821', fornecedor_padrao: 'OURO FINO*', inicio: '2026-10-01', fim: '2026-10-31' };
const req = (corpo, cab = {}) => new Request(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer a.b.c', ...cab }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
const chamar = (r, { conferir = async () => 'u1', env = { QLIK_APP_ID: 'app-1' } } = {}) =>
  worker.fetch(r, env, {}, { conferir, conectar: async () => qlikFalso().soquete });

test('rota: sem login 401, GET 405, outra origem 403, sem JSON 415, corpo grande 413', async () => {
  assert.equal((await chamar(req(OK), { conferir: async () => null })).status, 401);
  assert.equal((await worker.fetch(new Request(BASE), {})).status, 405);
  assert.equal((await chamar(req(OK, { Origin: 'https://site-malicioso.com' }))).status, 403);
  assert.equal((await chamar(req(OK, { Origin: 'https://campanhas.exemplo' }))).status, 200, 'mesma origem passa');
  assert.equal((await chamar(req(OK, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await chamar(req({ ...OK, lixo: 'x'.repeat(5000) }))).status, 413);
  assert.equal((await chamar(req('[1,2]'))).status, 400);
});

test('rota: respostas com cabeçalhos de segurança e sem cache', async () => {
  const r = await chamar(req(OK));
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.match(r.headers.get('Content-Security-Policy'), /default-src 'none'/);
});

test('rota: limite de 20 consultas por minuto por usuário', async () => {
  const env = {};
  for (let i = 0; i < 20; i++) assert.equal(await dentroDoLimite(env, 'u-limite', 1000 + i), true);
  assert.equal(await dentroDoLimite(env, 'u-limite', 2000), false, '21ª no mesmo minuto é barrada');
  assert.equal(await dentroDoLimite(env, 'u-outro', 2000), true, 'outro usuário não é afetado');
  assert.equal(await dentroDoLimite(env, 'u-limite', 62000), true, 'depois de 1 minuto libera');
  let chave = null;
  const comBinding = { LIMITE_QLIK: { limit: async ({ key }) => { chave = key; return { success: false }; } } };
  assert.equal(await dentroDoLimite(comBinding, 'u9'), false);
  assert.equal(chave, 'u9', 'usa o Rate Limiting do Cloudflare quando existe');
  const r = await worker.fetch(req(OK), comBinding, {}, { conferir: async () => 'u9' });
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('Retry-After'), '60');
});

test('rota: texto cru de erro do Qlik não vai para a tela', async () => {
  const conectar = async () => {
    const { soquete } = qlikFalso();
    const enviar = soquete.send;
    soquete.send = t => {
      const m = JSON.parse(t);
      if (m.method === 'OpenDoc') { setTimeout(() => soquete.__msg?.(m.id), 0); return; }
      return enviar(t);
    };
    const ouvintes = [];
    const add = soquete.addEventListener;
    soquete.addEventListener = (tipo, fn) => { if (tipo === 'message') ouvintes.push(fn); return add(tipo, fn); };
    soquete.__msg = id => ouvintes.forEach(fn => fn({ data: JSON.stringify({ jsonrpc: '2.0', id, error: { message: 'App dd64-segredo-interno not found' } }) }));
    return soquete;
  };
  const r = await worker.fetch(req(OK), { QLIK_APP_ID: 'x' }, {}, { conferir: async () => 'u1', conectar });
  const corpo = await r.json();
  assert.equal(r.status, 502);
  assert.ok(!/segredo-interno/.test(corpo.erro), corpo.erro);
});

test('total zero: diz se o cliente comprou de outros laboratórios ou se o Qlik não devolve nada', async () => {
  const semLab = qlikFalso({ zero: 'laboratorio' });
  const r1 = await consultarCompras(abrirEngine(semLab.soquete), PEDIDO);
  assert.equal(r1.total, 0);
  assert.equal(r1.cliente_total, 500, 'comprou de outros fornecedores');
  const ultimo = semLab.enviados.filter(e => e.method === 'CreateSessionObject').at(-1).params.qProp.qHyperCubeDef.qMeasures[0].qDef.qDef;
  assert.ok(!ultimo.includes('Nome Fantasia Fornecedor') && ultimo.includes('Cód. Cliente'), 'a conferência tira só o laboratório');
  const r2 = await consultarCompras(abrirEngine(qlikFalso({ zero: 'tudo' }).soquete), PEDIDO);
  assert.equal(r2.cliente_total, 0, 'Qlik sem nada do cliente');
  const r3 = await consultarCompras(abrirEngine(qlikFalso().soquete), PEDIDO);
  assert.equal(r3.cliente_total, null, 'com compras, não faz a consulta extra');
});

test('devoluções: acha as notas de valor igual ao devolvido na série (provável devolução)', () => {
  const n = (numero, serie, data, valor) => ({ numero, serie, data, valor });
  const notas = [n('1', '1', '2026-03-02', 2372.07), n('2', '1', '2026-03-05', 2291.53), n('3', '1', '2026-03-09', 520.4), n('4', '1', '2026-03-20', 520.4), n('5', '5', '2026-03-03', 456.85)];
  const nums = idx => [...idx].map(i => notas[i].numero).sort();
  // uma nota só
  assert.deepEqual(nums(acharDevolvidas(notas, new Map([['1', 2372.07]]))), ['1']);
  // duas notas na mesma série; entre as de mesmo valor, fica a mais recente
  assert.deepEqual(nums(acharDevolvidas(notas, new Map([['1', 2892.47]]))), ['1', '4']);
  // série diferente não mistura; sem combinação exata, nenhuma
  assert.deepEqual(nums(acharDevolvidas(notas, new Map([['5', 456.85], ['1', 10]]))), ['5']);
  assert.equal(acharDevolvidas(notas, new Map()).size, 0);
});

test('devoluções: nota de provável devolução continua na lista, marcada; soma das notas − devoluções = total', async () => {
  const q = qlikFalso({ devolvida: true });
  const r = await consultarCompras(abrirEngine(q.soquete), PEDIDO);
  assert.equal(r.total, 1300.49);
  assert.equal(r.notas.length, 3, 'nenhuma nota sai da lista');
  assert.deepEqual(r.notas.filter(x => x.provavel_devolucao).map(x => x.numero), ['209001'], 'a NF 209001 vem marcada');
  assert.equal(r.devolucoes, 300);
  const soma = Math.round(r.notas.reduce((s, x) => s + x.valor, 0) * 100);
  assert.equal(soma - Math.round(r.devolucoes * 100), Math.round(r.total * 100), 'soma das notas − devoluções = total');
  const dev = q.enviados.filter(e => e.method === 'CreateSessionObject').map(e => e.params.qProp.qHyperCubeDef).find(d => d.qDimensions[0]?.qDef.qFieldDefs[0] === 'Série Nota Fiscal Origem');
  const exprDev = dev.qMeasures[0].qDef.qDef;
  assert.ok(exprDev.startsWith('Sum({1<') && exprDev.includes(`[Tipo de Venda]={'Devolução'}>}`), exprDev);
});

test('devoluções: sem combinação exata, nenhuma nota marcada, mas o valor devolvido vem mesmo assim', async () => {
  const r = await consultarCompras(abrirEngine(qlikFalso({ devolvida: 'sem-par' }).soquete), PEDIDO);
  assert.equal(r.devolucoes, 50);
  assert.equal(r.notas.filter(x => x.provavel_devolucao).length, 0);
  assert.equal(Math.round(r.notas.reduce((s, x) => s + x.valor, 0) * 100) - 5000, Math.round(r.total * 100), 'a conta fecha');
});

test('devoluções: sem diferença, devolucoes = 0 e não faz a consulta extra', async () => {
  const semDev = qlikFalso();
  const r = await consultarCompras(abrirEngine(semDev.soquete), PEDIDO);
  assert.equal(r.devolucoes, 0);
  assert.ok(!semDev.enviados.some(e => JSON.stringify(e).includes('Série Nota Fiscal Origem')), 'sem diferença, não faz a consulta extra');
});
