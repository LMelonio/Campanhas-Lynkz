// Testes do que vai no recibo, na ADP dos PJ e no Excel (public/js/lib/comissoes-documentos.js)
// e das entradas do mês no cálculo (metas do mês, realizado informado, premiações).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apurarMes, entradaContrato, PARAMETROS_PADRAO } from '../public/js/lib/comissoes.js';
import {
  pendenciasPj, errosPj, itensRecibo, recibosDoMes, linhasAdpPj, totalLinhas, modeloExcel, documentoFormatado,
  ABA_ANALISE, ABA_AJUSTES, ABA_CONTRATO, ABA_PREMIACOES, abaBase, NF_RE,
} from '../public/js/lib/comissoes-documentos.js';

const P = { ...PARAMETROS_PADRAO, nomes_ignorados: ['TERRAZOO'] };
const ALEX = {
  id: 5, nome: 'Alex', regime: 'PJ', equipe: 'Equipe 02', pct_principal: 5, pct_farelo: 2, nomes_qlik: ['ALEX REPRESENTAÇÕES'],
  meta_faturamento: 100000, meta_positivacao: 10,
  pj_razao_social: 'Alex Representacoes', pj_documento: '26923986000165', pj_pix: '26.923.986/0001-65', pj_banco: 'Nubank',
  adp_observacao: 'Pagamento dos representantes comerciais da Lynkz do interior do Maranhão',
};
const RAYANE = { id: 3, nome: 'Rayane', regime: 'TELEVENDAS', pct_principal: 1, pct_farelo: 1, nomes_qlik: ['RAYANE CUNHA DOS ANJOS'] };
const SEM_DADOS = { id: 9, nome: 'Novo PJ', regime: 'PJ', pct_principal: 5, pct_farelo: 2, nomes_qlik: ['NOVO PJ LTDA'] };
const VENDAS = [
  { vendedor: 'ALEX REPRESENTAÇÕES', total: 118401.89, farelo: 0 },
  { vendedor: 'RAYANE CUNHA DOS ANJOS', total: 71727.48, farelo: 799.8 },
  { vendedor: 'NOVO PJ LTDA', total: 1000, farelo: 0 },
];
const REALIZADOS = new Map([[5, { faturamento: 211223.09, positivados: 37 }]]);
const MES_PJ = [{ comissionado_id: 5, mes: '2026-10', meta_faturamento: 199360.26, meta_positivacao: 40, nf_numero: '300', nf_valor: 8704.77 }];
const AJUSTES = [
  { id: 1, comissionado_id: 5, mes: '2026-10', motivo: 'Desconto de adiantamento', valor: -50 },
  { id: 2, comissionado_id: 5, mes: '2026-10', motivo: 'Removido', valor: 999, ativo: false },
];
const PREM = [
  { id: 1, comissionado_id: 3, mes: '2026-10', descricao: 'Campanha Ouro Fino', valor: 150 },
  { id: 2, comissionado_id: 5, mes: '2026-10', descricao: 'Campanha Farmina', valor: 200 },
  { id: 3, comissionado_id: 5, mes: '2026-10', descricao: 'Removida', valor: 999, ativo: false },
];
const apurar = (extra = {}) => apurarMes({ mes: '2026-10', comissionados: [ALEX, RAYANE, SEM_DADOS], parametros: P, vendas: VENDAS,
  realizados: REALIZADOS, premiacoes: PREM, mesPj: MES_PJ, ajustes: AJUSTES, ...extra });

test('contrato: meta do mês vence a do cadastro; realizado informado vence o do Qlik', () => {
  const qlik = { faturamento: 211223.09, positivados: 37 };
  assert.deepEqual(
    [entradaContrato(ALEX, null, qlik).meta_faturamento, entradaContrato(ALEX, null, qlik).meta_origem],
    [100000, 'cadastro']);
  const mes = entradaContrato(ALEX, MES_PJ[0], qlik);
  assert.deepEqual([mes.meta_faturamento, mes.meta_positivacao, mes.meta_origem, mes.informado], [199360.26, 40, 'mes', false]);
  const inf = entradaContrato(ALEX, { ...MES_PJ[0], realizado_faturamento: 190000, realizado_motivo: 'Nota fora do Qlik' }, qlik);
  assert.deepEqual([inf.realizado_faturamento, inf.positivados, inf.informado, inf.qlik_faturamento], [190000, 37, true, 211223.09]);
  assert.equal(entradaContrato({ ...ALEX, meta_faturamento: null, meta_positivacao: null }, null, qlik).meta_origem, null);
});

test('contrato (v3.5): meta do mês só de faturamento usa a positivação do cadastro', () => {
  const qlik = { faturamento: 211223.09, positivados: 37 };
  const so = { mes: '2026-10', comissionado_id: 5, meta_faturamento: 199360.26, meta_positivacao: null };
  const e = entradaContrato(ALEX, so, qlik);
  assert.deepEqual([e.meta_faturamento, e.meta_positivacao, e.meta_origem], [199360.26, ALEX.meta_positivacao, 'misto']);
  const r = apurar({ mesPj: [so] }).linhas.find(l => l.id === 5);
  assert.notEqual(r.contrato.motivo, 'Sem meta cadastrada', 'não cai em "Sem meta"');
  assert.equal(entradaContrato({ ...ALEX, meta_positivacao: null }, so, qlik).meta_origem, 'mes', 'o que existe é só do mês');
});

test('apuração do mês: premiações ativas do mês e contrato com a meta do mês', () => {
  const r = apurar();
  const a = r.linhas.find(l => l.id === 5);
  assert.equal(a.comissao_principal, 5920.09);
  assert.equal(a.contrato.meta_origem, 'mes');
  assert.equal(a.contrato_valor, 2534.68);              // 105,95% → 1,2% de 211.223,09
  assert.equal(a.premiacoes, 200);                       // a removida fica de fora
  assert.equal(a.ajustes, -50);                          // o desativado fica de fora
  assert.equal(a.valor_pagar, 8604.77);
  assert.equal(a.nf_numero, '300');
  assert.equal(a.nf_valor, 8704.77);
  assert.equal(a.nome_qlik, 'ALEX REPRESENTAÇÕES');
  assert.equal(r.linhas.find(l => l.id === 3).premiacoes, 150);
  // Premiação de outro mês não entra.
  const outro = apurar({ premiacoes: [{ ...PREM[0], mes: '2026-09' }] });
  assert.equal(outro.linhas.find(l => l.id === 3).premiacoes, 0);
});

test('recibo: comissões, contrato e cada premiação; só PJ com valor a pagar', () => {
  const r = apurar();
  const a = r.linhas.find(l => l.id === 5);
  const itens = itensRecibo(a, { contratoMes: '2026-09' });
  assert.deepEqual(itens.map(i => i.descricao), [
    'Comissão sobre a venda principal', 'Contrato de Resultado de setembro/2026 (01/09 a 30/09)', 'Premiação de campanha: Campanha Farmina',
    'Desconto: Desconto de adiantamento']);
  assert.equal(itens.reduce((s, i) => s + i.valor, 0).toFixed(2), a.valor_pagar.toFixed(2), 'itens somam o total');
  assert.deepEqual([itens[0].base, itens[0].pct, itens[0].valor], [118401.89, 5, 5920.09]);
  const recibos = recibosDoMes(r, [ALEX, RAYANE, SEM_DADOS]);
  assert.deepEqual(recibos.map(x => x.linha.nome), ['Alex', 'Novo PJ']);
  assert.equal(recibos[0].cnpj, '26.923.986/0001-65');
  assert.deepEqual(recibos[1].falta, ['razão social', 'CNPJ', 'chave PIX', 'banco']);
  assert.deepEqual(pendenciasPj(ALEX), []);
});

test('PJ (v3.6): dados de pagamento obrigatórios, CPF e CNPJ pelos dígitos verificadores', () => {
  assert.deepEqual(errosPj(ALEX), {});
  assert.deepEqual(errosPj({ ...ALEX, pj_documento: '529.982.247-25' }), {}, 'CPF válido');
  assert.deepEqual(errosPj({ ...ALEX, pj_documento: '52998224724' }), { pj_documento: 'CNPJ ou CPF inválido.' }, 'CPF com dígito errado');
  assert.deepEqual(errosPj({ ...ALEX, pj_documento: '26923986000166' }), { pj_documento: 'CNPJ ou CPF inválido.' }, 'CNPJ com dígito errado');
  assert.deepEqual(errosPj({ ...ALEX, pj_documento: '11111111111111' }), { pj_documento: 'CNPJ ou CPF inválido.' }, 'sequência repetida');
  assert.deepEqual(errosPj(SEM_DADOS), {
    pj_razao_social: 'Informe a razão social.', pj_documento: 'CNPJ ou CPF inválido.', pj_pix: 'Informe a chave PIX.', pj_banco: 'Informe o banco.',
  });
  assert.deepEqual(pendenciasPj({ ...ALEX, pj_banco: '  ' }), ['banco']);
});

test('ADP dos PJ: número e valor da NF, digitados vencem os gravados, pendências do cadastro', () => {
  const r = apurar();
  const ls = linhasAdpPj(r, [ALEX, RAYANE, SEM_DADOS]);
  assert.equal(ls.length, 2);
  assert.deepEqual([ls[0].fornecedor, ls[0].cnpj, ls[0].nf, ls[0].nf_valor, ls[0].banco, ls[0].falta], ['ALEX REPRESENTACOES', '26.923.986/0001-65', '300', 8704.77, 'NUBANK', []]);
  assert.equal(ls[0].diferenca, true, 'NF de R$ 8.704,77 e valor a pagar de R$ 8.604,77');
  assert.ok(ls[0].observacao.includes('interior do Maranhão'));
  assert.deepEqual(ls[1].falta, ['número da NF', 'valor da NF', 'razão social', 'CNPJ', 'chave PIX', 'banco']);
  const digitada = linhasAdpPj(r, [ALEX, RAYANE, SEM_DADOS], { nfs: { 5: { numero: '301', valor: 8604.77 }, 9: { numero: '7', valor: 40 } } });
  assert.deepEqual(digitada.map(l => [l.nf, l.diferenca]), [['301', false], ['7', true]]);
  assert.equal(totalLinhas(ls), 8654.77);
  assert.ok(NF_RE.test('000300') && NF_RE.test('2026/18') && !NF_RE.test('18; drop') && !NF_RE.test(''));
  assert.equal(documentoFormatado('12345678901'), '123.456.789-01');
});

// Mini avaliador das fórmulas do modelo (só o que o modelo usa), para conferir que o Excel recalcula igual à tela.
function avaliar(abas) {
  const porNome = new Map(abas.map(a => [a.nome, a]));
  const col = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const cel = (aba, ref) => { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref); return porNome.get(aba).linhas[+m[2] - 1]?.[col(m[1])] ?? null; };
  const valor = (aba, ref) => { const c = cel(aba, ref); if (!c) return 0; return c.f ? calcular(aba, c.f) : c.v; };
  const coluna = (aba, intervalo) => {
    const m = /^\$?([A-Z]+)(?:\$?(\d+))?:\$?([A-Z]+)(?:\$?(\d+))?$/.exec(intervalo);
    const a = porNome.get(aba); const ini = m[2] ? +m[2] : 1; const fim = m[4] ? +m[4] : a.linhas.length;
    const out = []; for (let r = ini; r <= fim; r++) out.push(valor(aba, `${m[1]}${r}`)); return out;
  };
  const num = v => (typeof v === 'number' ? v : 0);
  function calcular(aba, f) {
    const guardados = [];
    const guardar = txt => `§${guardados.push(txt) - 1}§`;
    let e = f.replace(/"[^"]*"/g, guardar)
      .replace(/'([^']+)'!(\$?[A-Z]+\$?\d*:\$?[A-Z]+\$?\d*)/g, (_, a, i) => guardar(`__R(${JSON.stringify(a)},${JSON.stringify(i)})`))
      .replace(/\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+/g, i => guardar(`__R(${JSON.stringify(aba)},${JSON.stringify(i)})`))
      .replace(/(?<![A-Z_])\$?([A-Z]{1,2})\$?(\d+)(?![\d(])/g, (_, c, r) => guardar(`__V(${JSON.stringify(aba)},"${c}${r}")`))
      .replace(/&/g, '+')
      .replace(/<>/g, '!=').replace(/(?<![<>!])=/g, '==');
    while (/§\d+§/.test(e)) e = e.replace(/§(\d+)§/g, (_, n) => guardados[+n]);
    const fn = {
      __R: (a, i) => coluna(a, i), __V: (a, r) => valor(a, r),
      SUMIFS: (soma, ...pares) => soma.reduce((s, v, k) => {
        for (let j = 0; j < pares.length; j += 2) if (String(pares[j][k]) !== String(pares[j + 1])) return s;
        return s + num(v);
      }, 0),
      SUM: x => x.reduce((s, v) => s + num(v), 0), ROUND: (x, n) => Math.sign(x) * Math.round(Math.abs(x) * 10 ** n + 1e-7) / 10 ** n,
      MAX: (...x) => Math.max(...x), IF: (c, a, b) => (c ? a : b), AND: (...x) => x.every(Boolean), N: x => num(x),
      IFERROR: (x, alt) => (Number.isFinite(x) || typeof x === 'string' ? x : alt),
    };
    try { return Function(...Object.keys(fn), `return (${e});`)(...Object.values(fn)); } catch (x) { throw new Error(`${f} → ${e}: ${x.message}`); }
  }
  return { valor, cel };
}

test('Excel: abas da planilha de outubro, fórmulas que recalculam igual à tela', () => {
  const r = apurar();
  const base = [
    { data: '2026-09-26', cod_fornecedor: '7064', fornecedor: 'OURO FINO', segmento: 'PET', marca: 'X', cod_vendedor: '1', vendedor: 'ALEX REPRESENTAÇÕES', produto: 'A', valor: 100000 },
    { data: '2026-10-25', cod_fornecedor: '7064', fornecedor: 'OURO FINO', segmento: 'PET', marca: 'X', cod_vendedor: '1', vendedor: 'ALEX REPRESENTAÇÕES', produto: 'B', valor: 18401.89 },
    { data: '2026-10-01', cod_fornecedor: '6610', fornecedor: 'FARELO', segmento: 'AGRO', marca: 'F', cod_vendedor: '2', vendedor: 'RAYANE CUNHA DOS ANJOS', produto: 'C', valor: 799.8 },
    { data: '2026-10-01', cod_fornecedor: '7064', fornecedor: 'OURO FINO', segmento: 'PET', marca: 'X', cod_vendedor: '2', vendedor: 'RAYANE CUNHA DOS ANJOS', produto: 'D', valor: 70927.68 },
    { data: '2026-10-01', cod_fornecedor: '7064', fornecedor: 'OURO FINO', segmento: 'PET', marca: 'X', cod_vendedor: '3', vendedor: 'NOVO PJ LTDA', produto: 'E', valor: 1000 },
  ];
  const m = modeloExcel(r, { parametros: P, cadastro: [ALEX, RAYANE, SEM_DADOS], premiacoes: PREM, ajustes: AJUSTES, base });
  assert.deepEqual(m.abas.map(a => a.nome), [ABA_PREMIACOES, ABA_AJUSTES, ABA_CONTRATO, ABA_ANALISE, abaBase(25)]);
  assert.equal(m.abas[1].linhas.length, 2, 'cabeçalho + 1 ajuste ativo');
  assert.equal(abaBase(25), 'Base Qlik 26 - 25');
  assert.equal(m.arquivo, 'Comissoes Lynkz - Outubro 2026.xlsx');
  assert.equal(modeloExcel({ ...r, mes: '2027-03' }, { parametros: P }).arquivo, 'Comissoes Lynkz - Marco 2027.xlsx');
  const prem = m.abas[0].linhas;
  assert.equal(prem.length, 3, 'cabeçalho + 2 premiações ativas');
  // Cada célula com fórmula recalcula para o mesmo valor guardado.
  const { valor } = avaliar(m.abas);
  let conferidas = 0;
  for (const aba of m.abas) aba.linhas.forEach((linha, i) => (linha || []).forEach((c, j) => {
    if (!c?.f) return;
    const ref = `${String.fromCharCode(65 + j)}${i + 1}`;
    const v = valor(aba.nome, ref);
    if (typeof c.v === 'number') assert.ok(Math.abs(v - c.v) < 0.006, `${aba.nome}!${ref}: ${c.f} = ${v}, esperado ${c.v}`);
    else assert.equal(v, c.v, `${aba.nome}!${ref}`);
    conferidas++;
  }));
  assert.ok(conferidas > 30, `fórmulas conferidas: ${conferidas}`);
  const an = m.abas[3].linhas;
  const ultima = an[an.length - 1];
  assert.equal(ultima[16].v, r.totais.geral.valor_pagar);
  // Sem a base: valores, sem fórmula de vendas, e um aviso.
  const sem = modeloExcel(r, { parametros: P, cadastro: [ALEX, RAYANE, SEM_DADOS], premiacoes: PREM, ajustes: AJUSTES, base: null });
  assert.equal(sem.abas.length, 4);
  assert.ok(sem.abas[3].linhas[1][1].v.includes('Sem a aba Base Qlik'));
  const { valor: v2 } = avaliar(sem.abas);
  const linhaAlex = sem.abas[3].linhas.findIndex(l => l?.[2]?.v === 'Alex') + 1;
  assert.equal(v2(ABA_ANALISE, `Q${linhaAlex}`), 8604.77);
  assert.equal(v2(ABA_ANALISE, `P${linhaAlex}`), -50);
});

// Toda fórmula do modelo recalcula para o valor que a tela mostra.
function conferirFormulas(m) {
  const { valor } = avaliar(m.abas);
  let n = 0;
  for (const aba of m.abas) aba.linhas.forEach((linha, i) => (linha || []).forEach((c, j) => {
    if (!c?.f) return;
    const ref = `${String.fromCharCode(65 + j)}${i + 1}`;
    const v = valor(aba.nome, ref);
    if (typeof c.v === 'number') assert.ok(Math.abs(v - c.v) < 0.006, `${aba.nome}!${ref}: ${c.f} = ${v}, esperado ${c.v}`);
    else assert.equal(v, c.v, `${aba.nome}!${ref}`);
    n++;
  }));
  return n;
}

test('Excel (v3.6): uma coluna por secundário, com as fórmulas da base', () => {
  const forn = [
    { id: 1, codigo: '6610', nome: 'Farelo', grupo: 'secundario', pct_clt: 1, pct_televendas: 1, pct_pj: 2, ativo: true },
    { id: 2, codigo: '7064', nome: 'Ouro Fino', grupo: 'secundario', pct_clt: 0.5, pct_televendas: 0.5, pct_pj: 3, ativo: true },
  ];
  const vendas = [
    { vendedor: 'ALEX REPRESENTAÇÕES', cod_fornecedor: '7064', fornecedor: 'OURO FINO', total: 18401.89 },
    { vendedor: 'ALEX REPRESENTAÇÕES', cod_fornecedor: '21610', fornecedor: 'DBM', total: 100000 },
    { vendedor: 'RAYANE CUNHA DOS ANJOS', cod_fornecedor: '6610', fornecedor: 'FARELO', total: 799.8 },
    { vendedor: 'RAYANE CUNHA DOS ANJOS', cod_fornecedor: '21610', fornecedor: 'DBM', total: 70927.68 },
  ];
  const r = apurar({ vendas, fornecedores: forn, excecoes: [] });
  const base = vendas.map((v, i) => ({ data: '2026-10-01', cod_fornecedor: v.cod_fornecedor, fornecedor: v.fornecedor, segmento: 'X', marca: 'X', cod_vendedor: String(i), vendedor: v.vendedor, produto: 'P', valor: v.total }));
  const m = modeloExcel(r, { parametros: P, cadastro: [ALEX, RAYANE, SEM_DADOS], premiacoes: PREM, ajustes: AJUSTES, base });
  const an = m.abas[3].linhas;
  const cab = an.find(l => l?.[2]?.v === 'NOME').map(c => c?.v);
  assert.deepEqual(cab.slice(5, 16), ['% PRINCIPAL', '% FARELO', '% OURO FINO', 'Venda Principal', 'Venda Farelo', 'Venda Ouro Fino', 'Venda Total',
    'Comissão Principal', 'Comissão Farelo', 'Comissão Ouro Fino', 'Comissão Total']);
  assert.deepEqual([an[0][6].v, an[0][7].v], [6610, 7064], 'código de cada secundário acima do % dele');
  assert.ok(conferirFormulas(m) > 30);
  const alex = an.find(l => l?.[2]?.v === 'Alex');
  assert.equal(alex[10].v, 18401.89, 'venda Ouro Fino do Alex');
  assert.equal(alex[14].v, 552.06, 'comissão Ouro Fino: 3% do PJ');
});

test('Excel e recibo (v3.6): principal em lista tem coluna e linha de Outros', () => {
  const p = { ...P, principal_modo: 'lista', pct_outros_clt: 0.2, pct_outros_televendas: 0.2, pct_outros_pj: 0.5 };
  const forn = [{ id: 1, codigo: '6610', nome: 'Farelo', grupo: 'secundario', pct_clt: 1, pct_televendas: 1, pct_pj: 2, ativo: true },
    { id: 2, codigo: '7064', nome: 'Ouro Fino', grupo: 'principal', ativo: true }];
  const vendas = [
    { vendedor: 'ALEX REPRESENTAÇÕES', cod_fornecedor: '7064', fornecedor: 'OURO FINO', total: 18401.89 },
    { vendedor: 'ALEX REPRESENTAÇÕES', cod_fornecedor: '21610', fornecedor: 'DBM', total: 1000 },
  ];
  const r = apurar({ vendas, fornecedores: forn, excecoes: [], parametros: p });
  const m = modeloExcel(r, { parametros: p, cadastro: [ALEX, RAYANE, SEM_DADOS], premiacoes: PREM, ajustes: AJUSTES, base: null });
  const cab = m.abas[3].linhas.find(l => l?.[2]?.v === 'NOME').map(c => c?.v);
  assert.ok(cab.includes('% OUTROS') && cab.includes('Venda Outros') && cab.includes('Comissão Outros'));
  conferirFormulas(m);
  const alex = r.linhas.find(l => l.id === 5);
  const itens = itensRecibo(alex);
  assert.deepEqual(itens.find(i => i.descricao === 'Comissão sobre outros fornecedores'), { descricao: 'Comissão sobre outros fornecedores', base: 1000, pct: 0.5, valor: 5 });
});

// ---------- outubro/2026 com as decisões de nov/2026 ----------
const ARQ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dados-privados', 'comissoes-outubro-2026.json');
test('outubro/2026: um nome por pessoa, sem bônus de cliente novo; ADP sem a Alsimar', { skip: !fs.existsSync(ARQ) && 'sem dados-privados/comissoes-outubro-2026.json' }, () => {
  const fx = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  let id = 0;
  // Douglas fica só com D K J SANTANA (o outro nome, com −R$ 16,16, vira "novo no Qlik").
  const cad = fx.esperado.filter(e => e.regime === 'PJ' && e.nome_qlik !== 'M A F DE SOUSA').map(e => {
    const ct = fx.contrato[e.nome_qlik] || (e.nome_qlik === 'MARIA AMANDA FARIAS DE SOUSA' ? fx.contrato['M A F DE SOUSA'] : null);
    return {
      id: ++id, nome: e.nome_qlik, regime: 'PJ', pct_principal: e.pct_principal, pct_farelo: e.pct_farelo,
      // Maria Amanda tinha dois nomes em outubro; a partir de agora o Qlik traz um só.
      nomes_qlik: e.nome_qlik === 'MARIA AMANDA FARIAS DE SOUSA' ? [e.nome_qlik, 'M A F DE SOUSA'] : [e.nome_qlik],
      meta_faturamento: ct?.meta_faturamento ?? null, meta_positivacao: ct?.meta_positivacao ?? null,
      pj_razao_social: e.nome_qlik, pj_documento: '11222333000181', pj_pix: 'x', pj_banco: 'y', _ct: ct,
    };
  });
  const realizados = new Map(cad.filter(c => c._ct).map(c => [c.id, { faturamento: c._ct.realizado_faturamento, positivados: c._ct.positivados }]));
  const r = apurarMes({ mes: '2026-10', comissionados: cad, vendas: fx.vendas, realizados, parametros: { ...P, nomes_ignorados: [] } });
  const valor = n => r.linhas.find(l => l.nome === n).valor_pagar;
  assert.equal(valor('D K J SANTANA'), 15391.46 - 50);
  assert.equal(valor('ALEX REPRESENTAÇÕES'), 8504.77 - 50);
  assert.equal(valor('SELDIANA ARAUJO BARROS'), 5658.89);
  assert.ok(r.semCadastro.some(x => x.vendedor === 'DOUGLAS KRUG JOHN SANTANA'), 'o outro nome do Douglas aparece como novo no Qlik');
  const ls = linhasAdpPj(r, cad).filter(l => l.nome !== 'ALSIMAR COSTA DA SILVA');   // em outubro ficou fora; a partir de agora entra
  // ADP de outubro: R$ 56.702,72, com R$ 300,00 de bônus de cliente novo que não existe mais.
  assert.equal(totalLinhas(ls), 56402.72);
});
