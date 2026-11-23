// Testes dos scripts de carga (planilhas antigas e clientes do Qlik).
// Rodar:  node --test tests/scripts.test.mjs   (incluído em npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { converterPlanilha, juntarPlanilhas, dataCivilDe, nomeComparavel, nomeProprio, ultimoDiaDoMes, mapearColunas } from '../scripts/lib/planilhas.mjs';
import { lerClientesQlik, converterClientesQlik, camposDoEnv } from '../scripts/lib/qlik.mjs';

// "ws" é dependência de scripts/ (cd scripts && npm install).
const { WebSocketServer } = createRequire(new URL('../scripts/package.json', import.meta.url))('ws');

const CONFIG = {
  LABORATORIOS: ['Avert', 'Ouro Fino', 'Biogénesis Bagó Pet', 'Recurso próprio'],
  TIPOS: ['Campanha de balconista', 'Rebate por meta'],
  PAGTO: ['Desconto em nota', 'Swile', 'Bonificação em produto'],
};
const REC = {
  'Nome do Recebedor Swile': 'MARIONE SOUSA SILVA', 'CPF do Recebedor Swile': '529.982.247-25',
  'Data de Nascimento do Recebedor': 26096, 'E-mail do Recebedor Swile': 'Marione@Gmail.com', 'Telefone do Recebedor Swile': '(98) 98236-6810',
};
const OUTUBRO = [
  { 'Data Solicitação': 46321, Solicitante: 'Ana Letícia', Cliente: 'A J P CORREA', 'Laboratório': 'Ourofino',
    'Tipo de Campanha': 'Campanha de balconista', 'Descrição': 'R$ 3,00 por dose', 'Forma de Pagamento': 'Swile',
    'Valor a ser pago R$': 123, 'Observações': 'NF 1', ...REC },
];
const SETEMBRO = [
  { Solicitante: 'Charles Machado', 'Laboratório': 'Mundo Animal', 'Nome da Campanha': 'Fachada',
    'Tipo de Campanha': 'Campanha de balconista', 'Descrição': null, 'Forma de Pagamento': 'Swile', 'Data Início': 46082, 'Data Fim': 46282,
    'Duração (dias)': 201, 'Meta do Cliente (R$)': 0, 'Custo Total (R$)': 1000, Aprovador: 'Charles Machado', 'Observações': '', ...REC,
    Cliente: 'A J P CORREIA', 'Telefone do Recebedor Swile': 98999120030 },
  { Solicitante: 'Leandra Almeida', Cliente: 'Pets Village', 'Laboratório': 'Recurso próprio', 'Nome da Campanha': 'Hotel',
    'Tipo de Campanha': 'Combo de produtos', 'Forma de Pagamento': 'Bonificação em produto', 'Data Início': 46288, 'Data Fim': 46289,
    'Meta do Cliente (R$)': 2, 'Custo Total (R$)': 256.47, Aprovador: 'Charles Machado', 'Nome do Recebedor Swile': '' },
  { Solicitante: 'X', Cliente: 'Loja Ruim', 'Laboratório': 'Avert', 'Forma de Pagamento': 'Swile', 'Custo Total (R$)': 10,
    'Nome do Recebedor Swile': 'Fulano', 'CPF do Recebedor Swile': '111.111.111-11' },
];

test('datas do Excel e de texto viram data civil', () => {
  assert.equal(dataCivilDe(46321), '2026-10-26');
  assert.equal(dataCivilDe('30/05/2000'), '2000-05-30');
  assert.equal(dataCivilDe(''), null);
  assert.equal(ultimoDiaDoMes('2026-09'), '2026-09-30');
  assert.equal(ultimoDiaDoMes('2028-02'), '2028-02-29');
});

test('nomes: comparação igual à do banco e nome próprio', () => {
  assert.equal(nomeComparavel('L Lazzarotti Reis LTDA.'), nomeComparavel('L LAZZAROTTI REIS LTDA'));
  assert.equal(nomeComparavel('Agropecuária São Luís Ltda'), 'AGROPECUARIA SAO LUIS');
  assert.equal(nomeProprio('MARIONE SOUSA DA SILVA'), 'Marione Sousa da Silva');
  assert.equal(nomeProprio('Cristopher vieira luz'), 'Cristopher vieira luz');
});

test('reconhece os cabeçalhos dos dois formatos', () => {
  const m = mapearColunas(Object.keys(OUTUBRO[0]));
  assert.equal(m.valor, 'Valor a ser pago R$');
  assert.equal(m.data_solicitacao, 'Data Solicitação');
  assert.equal(mapearColunas(Object.keys(SETEMBRO[0])).valor, 'Custo Total (R$)');
});

test('planilha de outubro: de-para, laboratório, recebedor e código fixo', () => {
  const r = converterPlanilha(OUTUBRO, { mes: '2026-10', config: CONFIG, dePara: { 'A J P CORREA': 'A J P CORREIA' }, hoje: '2026-11-23' });
  assert.deepEqual(r.erros, []);
  const l = r.linhas[0];
  assert.equal(l.codigo, 'H2610001');
  assert.equal(l.empresa, 'A J P CORREIA');
  assert.equal(l.laboratorio, 'Ouro Fino');
  assert.equal(l.campanha, 'Campanha de balconista (Ouro Fino)');
  assert.equal(l.data_decisao, '2026-10-26');
  assert.equal(l.valor, 123);
  assert.deepEqual(l.recebedor, { nome: 'Marione Sousa Silva', cpf: '52998224725', nascimento: '1971-06-12', email: 'marione@gmail.com', telefone: '98982366810' });
});

test('planilha de setembro: Mundo Animal, sem recebedor e Swile inválido fica de fora', () => {
  const r = converterPlanilha(SETEMBRO, { mes: '2026-09', config: CONFIG, hoje: '2026-11-23', arquivo: 'set.xlsx' });
  assert.equal(r.linhas.length, 2);
  assert.equal(r.linhas[0].laboratorio, 'Biogénesis Bagó Pet');
  assert.equal(r.linhas[0].data_decisao, '2026-09-30');
  assert.equal(r.linhas[0].recebedor.telefone, '98999120030');
  assert.equal(r.linhas[1].recebedor, null);
  assert.equal(r.linhas[1].forma_pagamento, 'Bonificação em produto');
  assert.match(r.erros[0], /set\.xlsx, linha 4 \(Loja Ruim\).*CPF inválido/);
  assert.ok(r.avisos.some(a => /tipo "Combo de produtos"/.test(a)), 'tipo fora da lista vira aviso');
});

test('juntar planilhas: mais recente primeiro e conflito de cadastro avisado', () => {
  const out = converterPlanilha(OUTUBRO, { mes: '2026-10', config: CONFIG, dePara: { 'A J P CORREA': 'A J P CORREIA' }, hoje: '2026-11-23' });
  const set = converterPlanilha(SETEMBRO.slice(0, 1), { mes: '2026-09', config: CONFIG, hoje: '2026-11-23' });
  const j = juntarPlanilhas([set, out]);
  assert.deepEqual(j.linhas.map(l => l.codigo), ['H2610001', 'H2609001']);
  assert.ok(j.avisos.some(a => /telefone diferente/.test(a) && /usa o de H2610001/.test(a)));
});

test('clientes do Qlik: um por código, com a linha de maior movimento', () => {
  const c = converterClientesQlik([
    { codigo: '10', nome: 'PET A LTDA', documento: '11.222.333/0001-81', cidade: 'SAO LUIS', uf: 'ma', vendedor: 'João', _medida: 3 },
    { codigo: '10', nome: 'PET A LTDA', documento: '', cidade: 'PACO', uf: 'MA', vendedor: 'Ana', _medida: 9 },
    { codigo: '', nome: 'SEM CODIGO' },
    { codigo: '20', nome: '', fantasia: 'Só Fantasia', _medida: 1 },
  ]);
  assert.equal(c.length, 2);
  const a = c.find(x => x.codigo === '10');
  assert.deepEqual(a, { codigo: '10', nome: 'PET A LTDA', fantasia: '', documento: '11222333000181', cidade: 'PACO', uf: 'MA', vendedor: 'Ana' });
  assert.equal(c.find(x => x.codigo === '20').nome, 'Só Fantasia');
});

test('campos do Qlik vêm do .env, com padrão da base de vendas', () => {
  const c = camposDoEnv({ QLIK_CAMPO_FANTASIA: 'Nome Fantasia', QLIK_CAMPO_VENDEDOR: '' });
  assert.equal(c.codigo, 'Cód. Cliente');
  assert.equal(c.fantasia, 'Nome Fantasia');
  assert.equal(c.vendedor, '');
});

test('Engine API: abre o app, monta o hipercubo e lê em páginas', async () => {
  // Qlik simulado: responde OpenDoc, CreateSessionObject, GetLayout e GetHyperCubeData.
  const LINHAS = Array.from({ length: 2600 }, (_, i) => [String(1000 + i), `CLIENTE ${i}`, 'SAO LUIS']);
  const srv = new WebSocketServer({ port: 0 });
  let auth = null, dims = null;
  srv.on('connection', (ws, req) => {
    auth = req.headers.authorization;
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'OnConnected', params: {} }));
    ws.on('message', d => {
      const m = JSON.parse(d);
      const r = res => ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: res }));
      if (m.method === 'OpenDoc') r({ qReturn: { qHandle: 1 } });
      else if (m.method === 'CreateSessionObject') { dims = m.params.qProp.qHyperCubeDef.qDimensions.map(x => x.qDef.qFieldDefs[0]); r({ qReturn: { qHandle: 2 } }); }
      else if (m.method === 'GetLayout') r({ qLayout: { qHyperCube: { qSize: { qcx: 4, qcy: LINHAS.length }, qDimensionInfo: dims.map(() => ({})), qMeasureInfo: [{}] } } });
      else if (m.method === 'GetHyperCubeData') {
        const p = m.params.qPages[0];
        r({ qDataPages: [{ qMatrix: LINHAS.slice(p.qTop, p.qTop + p.qHeight).map(l => [...l.map(t => ({ qText: t })), { qText: '1', qNum: 1 }]) }] });
      }
    });
  });
  await new Promise(ok => srv.once('listening', ok));
  const linhas = await lerClientesQlik({
    tenant: `ws://127.0.0.1:${srv.address().port}`, apiKey: 'chave-teste', appId: 'app-1',
    campos: { codigo: 'Cód. Cliente', nome: 'Razão Social Cliente', fantasia: '', cidade: 'Cidade' },
  });
  srv.close();
  assert.equal(auth, 'Bearer chave-teste');
  assert.deepEqual(dims, ['Cód. Cliente', 'Razão Social Cliente', 'Cidade']);
  assert.equal(linhas.length, 2600, 'leu todas as páginas (2.500 por página com 4 colunas)');
  assert.deepEqual(linhas[2599], { codigo: '3599', nome: 'CLIENTE 2599', cidade: 'SAO LUIS', _medida: 1 });
});

test('Engine API: campo inexistente dá mensagem clara', async () => {
  const srv = new WebSocketServer({ port: 0 });
  srv.on('connection', ws => ws.on('message', d => {
    const m = JSON.parse(d);
    const r = res => ws.send(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: res }));
    if (m.method === 'OpenDoc') r({ qReturn: { qHandle: 1 } });
    else if (m.method === 'CreateSessionObject') r({ qReturn: { qHandle: 2 } });
    else if (m.method === 'GetLayout') r({ qLayout: { qHyperCube: { qSize: { qcy: 0 }, qDimensionInfo: [{}, { qError: { qErrorCode: 7 } }], qMeasureInfo: [{}] } } });
  }));
  await new Promise(ok => srv.once('listening', ok));
  await assert.rejects(
    lerClientesQlik({ tenant: `ws://127.0.0.1:${srv.address().port}`, apiKey: 'x', appId: 'a', campos: { codigo: 'Cód', nome: 'Razão' } }),
    /campo "Razão" não existe.*QLIK_CAMPO_NOME/);
  srv.close();
});
