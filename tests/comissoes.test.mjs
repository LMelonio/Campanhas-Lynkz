// Testes do cálculo das comissões (public/js/lib/comissoes.js).
// A parte "outubro/2026" refaz a planilha real e só roda se o arquivo privado
// dados-privados/comissoes-outubro-2026.json existir (ele não vai para o GitHub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  periodoApuracao, mesAnteriorFechado, somaMes, rotuloMesComissao, chaveNome, nomeQlik, centavos, arred,
  acordoVigente, juntarVendas, realizadosContrato, avaliarContrato, calcularLinha, apurarMes,
  errosComissionado, pctPadrao, PARAMETROS_PADRAO, nomeLegivel, novoDoQlik,
} from '../public/js/lib/comissoes.js';

test('novos no Qlik (v3.4): cadastro com o regime e os % padrão, nome legível', () => {
  assert.equal(nomeLegivel('DOMINGOS DAS MERCES ARAUJO E FILHOS'), 'Domingos das Merces Araujo e Filhos');
  const p = { ...PARAMETROS_PADRAO, pct_pj_principal: 4, pct_pj_farelo: 1.5 };
  const c = novoDoQlik('  sem  cadastro ltda ', 'PJ', p);
  assert.deepEqual(c, { nome: 'Sem Cadastro Ltda', regime: 'PJ', pct_principal: 4, pct_farelo: 1.5, nomes_qlik: ['SEM CADASTRO LTDA'], ativo: true });
  assert.deepEqual(errosComissionado(c, []), {}, 'passa na validação do cadastro');
  assert.equal(novoDoQlik('X Y').regime, 'CLT', 'CLT por padrão');
});

const P = PARAMETROS_PADRAO;
const quase = (a, b, tol = 0.005, msg = '') => assert.ok(Math.abs(a - b) <= tol + 1e-9, `${msg} ${a} ≠ ${b}`);

test('períodos: apuração 26 a 25 e mês anterior fechado', () => {
  assert.deepEqual(periodoApuracao('2026-10'), { inicio: '2026-09-26', fim: '2026-10-25' });
  assert.deepEqual(periodoApuracao('2027-01'), { inicio: '2026-12-26', fim: '2027-01-25' });
  assert.deepEqual(periodoApuracao('2026-03', 20), { inicio: '2026-02-21', fim: '2026-03-20' });
  assert.deepEqual(mesAnteriorFechado('2026-10'), { inicio: '2026-09-01', fim: '2026-09-30', mes: '2026-09' });
  assert.deepEqual(mesAnteriorFechado('2027-01'), { inicio: '2026-12-01', fim: '2026-12-31', mes: '2026-12' });
  assert.deepEqual(mesAnteriorFechado('2028-03'), { inicio: '2028-02-01', fim: '2028-02-29', mes: '2028-02' });
  assert.equal(somaMes('2026-12', 1), '2027-01');
  assert.equal(rotuloMesComissao('2026-10'), 'Outubro 2026');
  assert.throws(() => periodoApuracao('2026-13'));
});

test('dinheiro: centavos arredondam meio centavo para longe do zero', () => {
  assert.equal(centavos(5920.0945), 592009);
  assert.equal(centavos(0.005), 1);
  assert.equal(centavos(-0.005), -1);
  assert.equal(centavos(1.005), 101);       // 1.005 em binário é 1.00499…: o ajuste fino segura
  assert.equal(arred(2534.67708), 2534.68);
  assert.equal(centavos(-0), 0);
});

test('nomes do Qlik: comparação sem acento, caixa e espaços', () => {
  assert.equal(chaveNome('  Leonardo  Representaçoes '), 'LEONARDO REPRESENTACOES');
  assert.equal(nomeQlik('  maria  betânea '), 'MARIA BETÂNEA');
});

test('acordo mínimo: só CLT, dentro da vigência', () => {
  const c = { regime: 'CLT', acordo_minimo: 3500, acordo_inicio: '2026-10-01', acordo_fim: '2027-03-31' };
  assert.equal(acordoVigente(c, '2026-09'), null);
  assert.equal(acordoVigente(c, '2026-10').valor, 3500);
  assert.equal(acordoVigente(c, '2027-03').valor, 3500);
  assert.equal(acordoVigente(c, '2027-04'), null);
  assert.equal(acordoVigente({ ...c, acordo_fim: null }, '2030-01').valor, 3500);
  assert.equal(acordoVigente({ ...c, regime: 'PJ' }, '2026-10'), null);
  assert.equal(acordoVigente({ ...c, acordo_minimo: 0 }, '2026-10'), null);
});

const CAD = [
  { id: 1, nome: 'Ana CLT', regime: 'CLT', pct_principal: 2.5, pct_farelo: 1, nomes_qlik: ['ANA SILVA'] },
  { id: 2, nome: 'Bruno PJ', regime: 'PJ', pct_principal: 5, pct_farelo: 2, nomes_qlik: ['B REPRESENTAÇÕES', 'BRUNO SOUZA'], meta_faturamento: 200000, meta_positivacao: 40 },
  { id: 3, nome: 'Saiu', regime: 'CLT', pct_principal: 2.5, pct_farelo: 1, nomes_qlik: ['SAIU'], ativo: false },
];

test('vendas: soma os nomes da mesma pessoa e lista quem não tem cadastro', () => {
  const r = juntarVendas([
    { vendedor: 'Ana Silva', total: 1000, farelo: 100 },
    { vendedor: 'B REPRESENTACOES', total: 500.1, farelo: 0 },
    { vendedor: 'BRUNO SOUZA', total: 0.2, farelo: 0 },
    { vendedor: 'SAIU', total: 50, farelo: 0 },
    { vendedor: 'TERRAZOO', total: 9000, farelo: 0 },
  ], CAD.filter(c => c.ativo !== false), ['terrazoo']);
  assert.deepEqual(r.porId.get(1), { totalC: 100000, fareloC: 10000, nomes: ['Ana Silva'] });
  assert.equal(r.porId.get(2).totalC, 50030);
  assert.deepEqual(r.semCadastro.map(x => x.vendedor), ['SAIU']);   // desativado não recebe
  assert.deepEqual(r.ignorados.map(x => x.vendedor), ['TERRAZOO']);
});

test('desativado com venda (v3.5): vai para "desativados", não para Novos no Qlik', () => {
  const r = juntarVendas([
    { vendedor: 'Ana Silva', total: 1000, farelo: 100 },
    { vendedor: 'saiu', total: 50, farelo: 5 },
    { vendedor: 'NOVO NOME', total: 70, farelo: 0 },
  ], CAD, []);
  assert.deepEqual(r.desativados, [{ id: 3, nome: 'Saiu', vendedor: 'saiu', total: 50, farelo: 5 }]);
  assert.deepEqual(r.semCadastro.map(x => x.vendedor), ['NOVO NOME']);
  assert.equal(r.porId.has(3), false, 'não entra na comissão');
});

test('desativado com premiação ou ajuste (v3.5): fica fora do total e aparece em lancamentosOrfaos', () => {
  const r = apurarMes({
    mes: '2026-10', comissionados: CAD, vendas: [{ vendedor: 'SAIU', total: 50, farelo: 0 }],
    premiacoes: [{ id: 7, comissionado_id: 3, mes: '2026-10', descricao: 'Campanha X', valor: 100 }, { id: 8, comissionado_id: 3, mes: '2026-10', descricao: 'Apagada', valor: 5, ativo: false }],
    ajustes: [{ id: 9, comissionado_id: 3, mes: '2026-10', motivo: 'Acerto', valor: -20 }],
  });
  assert.equal(r.linhas.some(l => l.id === 3), false, 'sem linha para quem está desativado');
  assert.deepEqual(r.semCadastro, [], 'o nome não cai em Novos no Qlik');
  assert.deepEqual(r.desativados.map(x => x.id), [3]);
  assert.deepEqual(r.lancamentosOrfaos, [
    { tipo: 'premiacao', id: 7, comissionado_id: 3, nome: 'Saiu', valor: 100, descricao: 'Campanha X' },
    { tipo: 'ajuste', id: 9, comissionado_id: 3, nome: 'Saiu', valor: -20, descricao: 'Acerto' },
  ]);
});

test('cadastro (v3.5): nome do Qlik de quem está desativado pede para reativar', () => {
  const e = errosComissionado({ nome: 'Saiu de novo', regime: 'CLT', pct_principal: 2.5, pct_farelo: 1, nomes_qlik: ['SAIU'] }, CAD);
  assert.equal(e.nomes_qlik, '"SAIU" é de Saiu, que está desativado. Reative o cadastro em vez de criar outro.');
  assert.deepEqual(errosComissionado({ ...CAD[2], ativo: true }, CAD), {}, 'reativar o próprio cadastro passa');
});

test('contrato: realizados e positivação líquida por pessoa', () => {
  const r = realizadosContrato([
    { vendedor: 'B REPRESENTAÇÕES', cliente: '10', valor: 1000 },
    { vendedor: 'BRUNO SOUZA', cliente: '10', valor: -1000 },   // devolveu tudo pelo outro nome: não conta
    { vendedor: 'BRUNO SOUZA', cliente: '11', valor: 50 },
    { vendedor: 'B REPRESENTAÇÕES', cliente: '12', valor: -20 },
    { vendedor: 'ANA SILVA', cliente: '10', valor: 999 },
  ], CAD);
  assert.deepEqual(r.get(2), { faturamento: 30, positivados: 1 });
  assert.deepEqual(r.get(1), { faturamento: 999, positivados: 1 });
});

test('contrato: gatilhos e faixas (exemplos do documento de regras)', () => {
  const ok = avaliarContrato({ meta_faturamento: 200000, realizado_faturamento: 212000, meta_positivacao: 40, positivados: 37 }, P);
  assert.equal(ok.atingiu, true); assert.equal(ok.pct_premio, 1.2); assert.equal(ok.valor, 2544);
  const f1 = avaliarContrato({ meta_faturamento: 200000, realizado_faturamento: 210000, meta_positivacao: 40, positivados: 32 }, P);
  assert.equal(f1.pct_premio, 1); assert.equal(f1.valor, 2100);                 // 105% exato: faixa 1; 80% exato: passa
  const semFat = avaliarContrato({ meta_faturamento: 200000, realizado_faturamento: 195600, meta_positivacao: 40, positivados: 40 }, P);
  assert.equal(semFat.atingiu, false); assert.equal(semFat.valor, 0); assert.match(semFat.motivo, /^Faturamento abaixo de 100%$/);
  const semPos = avaliarContrato({ meta_faturamento: 200000, realizado_faturamento: 250000, meta_positivacao: 40, positivados: 30 }, P);
  assert.equal(semPos.atingiu, false); assert.match(semPos.motivo, /^Positivação abaixo de 80%$/);
  const exato100 = avaliarContrato({ meta_faturamento: 199360.26, realizado_faturamento: 199360.26, meta_positivacao: 40, positivados: 40 }, P);
  assert.equal(exato100.atingiu, true);
  assert.equal(avaliarContrato({ meta_faturamento: 0, realizado_faturamento: 9, meta_positivacao: 0, positivados: 1 }, P).motivo, 'Sem meta cadastrada');
});

test('CLT: exemplo do documento (R$ 100 mil + R$ 10 mil de Farelo, sem cliente novo) e acordo como piso', () => {
  const c = { id: 1, nome: 'X', regime: 'CLT', pct_principal: 2.5, pct_farelo: 1 };
  const l = calcularLinha(c, { venda: { totalC: 11000000, fareloC: 1000000 }, mes: '2026-10' });
  assert.equal(l.comissao_principal, 2500); assert.equal(l.comissao_farelo, 100); assert.equal(l.valor_pagar, 2600);
  const comAcordo = { ...c, acordo_minimo: 3500, acordo_inicio: '2026-10-01', acordo_fim: '2027-03-31' };
  const piso = calcularLinha(comAcordo, { venda: { totalC: 11000000, fareloC: 1000000 }, premiacoes: [{ valor: 300 }], mes: '2026-10' });
  assert.equal(piso.soma, 2900); assert.equal(piso.piso_aplicado, true); assert.equal(piso.valor_pagar, 3500);
  const acima = calcularLinha(comAcordo, { venda: { totalC: 27200000, fareloC: 0 }, mes: '2026-10' });
  assert.equal(acima.valor_pagar, 6800); assert.equal(acima.piso_aplicado, false);
  const ajuste = calcularLinha(comAcordo, { venda: { totalC: 11000000, fareloC: 1000000 }, ajustes: [{ valor: -100, motivo: 'acerto' }], mes: '2026-10' });
  assert.equal(ajuste.valor_pagar, 3400);   // ajuste entra depois do piso
});

test('PJ: comissão + premiação + contrato; total negativo paga zero', () => {
  const c = CAD[1];
  const l = calcularLinha(c, { venda: { totalC: 11840189, fareloC: 0 }, realizado: { faturamento: 211223.09, positivados: 37 },
    premiacoes: [{ valor: 100 }], mes: '2026-10' });
  assert.equal(l.comissao_principal, 5920.09);
  assert.equal(l.contrato.atingiu, true); assert.equal(l.contrato_valor, 2534.68);
  assert.equal(l.valor_pagar, 8554.77);
  const neg = calcularLinha({ ...c, meta_faturamento: null }, { venda: { totalC: -200000, fareloC: 0 }, premiacoes: [{ valor: 50 }], mes: '2026-10' });
  assert.equal(neg.soma, -50); assert.equal(neg.valor_pagar, 0);
  assert.deepEqual(neg.alertas.map(a => a.tipo), ['base_negativa', 'total_negativo']);
  assert.equal(calcularLinha(c, { mes: '2026-10' }).alertas[0].tipo, 'sem_venda');
});

test('mês: CLT antes de PJ, desativados fora, totais somam as linhas', () => {
  const r = apurarMes({ mes: '2026-10', comissionados: CAD, vendas: [
    { vendedor: 'ANA SILVA', total: 1000, farelo: 100 }, { vendedor: 'B REPRESENTAÇÕES', total: 2000, farelo: 0 }, { vendedor: 'ZÉ', total: 1, farelo: 0 },
  ] });
  assert.deepEqual(r.linhas.map(l => l.id), [1, 2]);
  assert.deepEqual(r.semCadastro.map(x => x.vendedor), ['ZÉ']);
  assert.equal(r.totais.geral.valor_pagar, r.linhas.reduce((s, l) => s + l.valor_pagar, 0));
  assert.deepEqual(r.periodo, { inicio: '2026-09-26', fim: '2026-10-25' });
});

test('cadastro: conferências antes de salvar', () => {
  assert.deepEqual(errosComissionado({ nome: 'Ana', regime: 'CLT', pct_principal: 2.5, pct_farelo: 1, nomes_qlik: ['ANA'] }), {});
  const e = errosComissionado({ id: 9, nome: 'A', regime: 'X', pct_principal: 50, pct_farelo: '', nomes_qlik: ['ana silva'] }, CAD);
  assert.deepEqual(Object.keys(e).sort(), ['nome', 'nomes_qlik', 'pct_farelo', 'pct_principal', 'regime']);
  assert.match(e.nomes_qlik, /Ana CLT/);
  assert.ok(errosComissionado({ nome: 'Ana', regime: 'CLT', pct_principal: 2.5, pct_farelo: 1, nomes_qlik: ['A'], acordo_minimo: 3500 }).acordo_inicio);
  assert.ok(errosComissionado({ nome: 'Pj', regime: 'PJ', pct_principal: 5, pct_farelo: 2, nomes_qlik: ['P'], acordo_minimo: 10 }).acordo_minimo);
  assert.deepEqual(pctPadrao('TELEVENDAS'), { principal: 1, farelo: 1 });
});

// ---------- outubro/2026: tem de bater com a planilha ----------
const ARQ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dados-privados', 'comissoes-outubro-2026.json');
const temOutubro = fs.existsSync(ARQ);

test('outubro/2026: refaz a planilha (sem o bônus de cliente novo, que acabou)', { skip: !temOutubro && 'sem dados-privados/comissoes-outubro-2026.json' }, () => {
  const fx = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  assert.ok(fx.datas[0] >= '2026-09-26' && fx.datas[1] <= '2026-10-25', 'base dentro do período 26/09 a 25/10');
  // Cadastro como estava em outubro: Maria Amanda PJ com os dois nomes do Qlik.
  const porNome = new Map();
  let id = 0;
  for (const e of fx.esperado) {
    const pessoa = e.nome_qlik === 'MARIA AMANDA FARIAS DE SOUSA' || e.nome_qlik === 'M A F DE SOUSA' ? 'MARIA AMANDA' : e.nome_qlik;
    if (!porNome.has(pessoa)) {
      const ct = fx.contrato[e.nome_qlik] || fx.contrato[pessoa === 'MARIA AMANDA' ? 'M A F DE SOUSA' : ''];
      porNome.set(pessoa, {
        id: ++id, nome: pessoa, regime: e.regime === 'PJ' ? 'PJ' : (e.equipe === 'TELEVENDAS' ? 'TELEVENDAS' : 'CLT'),
        pct_principal: e.pct_principal, pct_farelo: e.pct_farelo, nomes_qlik: [],
        acordo_minimo: e.acordo || null, acordo_inicio: e.acordo ? '2026-10-01' : null, acordo_fim: e.acordo ? '2027-03-31' : null,
        meta_faturamento: ct?.meta_faturamento ?? null, meta_positivacao: ct?.meta_positivacao ?? null,
        _ct: ct, _esp: [],
      });
    }
    const c = porNome.get(pessoa);
    c.nomes_qlik.push(e.nome_qlik);
    c._esp.push(e);
  }
  const cad = [...porNome.values()];
  const realizados = new Map(cad.filter(c => c._ct).map(c => [c.id, { faturamento: c._ct.realizado_faturamento, positivados: c._ct.positivados }]));
  const r = apurarMes({ mes: '2026-10', comissionados: cad, vendas: fx.vendas, realizados, parametros: { ...P, nomes_ignorados: [] } });

  let totalPlanilha = 0;
  for (const c of cad) {
    const l = r.linhas.find(x => x.id === c.id);
    const soma = k => c._esp.reduce((s, e) => s + (Number(e[k]) || 0), 0);
    quase(l.venda_principal, soma('venda_principal'), 0.005, `${c.nome} venda principal`);
    quase(l.venda_farelo, soma('venda_farelo'), 0.005, `${c.nome} venda farelo`);
    quase(l.comissao_principal, soma('comissao_principal'), 0.006 * c._esp.length, `${c.nome} comissão principal`);
    quase(l.comissao_farelo, soma('comissao_farelo'), 0.006 * c._esp.length, `${c.nome} comissão farelo`);
    if (c.regime === 'PJ') quase(l.contrato_valor, c._ct?.premio || 0, 0.006, `${c.nome} contrato`);
    const esperado = soma('valor_pagar') - soma('novos_clientes');
    // CLT no piso: a planilha paga o acordo (o bônus não muda nada ali).
    const alvo = l.piso_aplicado ? c.acordo_minimo : esperado;
    quase(l.valor_pagar, alvo, 0.02, `${c.nome} valor a pagar`);
    totalPlanilha += alvo;
  }
  quase(r.totais.geral.valor_pagar, totalPlanilha, 0.1, 'total geral');
  // Quem vendeu e não está no cadastro de outubro (para conferir na tela).
  assert.ok(r.semCadastro.some(x => x.vendedor === 'TERRAZOO'));
});
