// Testes da parte pura da ADP (quem entra, de quem são os dados, linhas). Rodar: node --test tests/adp.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mesesAdp, mesSugerido, itensAdp, linhaAdp, recebedorAdp, rotuloMes, nomeArquivoAdp, mesDaCampanha, textosAdp, textoPdf, totalAdp,
} from '../public/js/adp.js';

const balc = { id: 7, empresa_id: 1, nome_completo: 'Irene Dias de Sales', cpf: '00368088308', email: 'irene@exemplo.com', data_nascimento: '1990-05-04' };
const cad = { balconista: id => (String(id) === '7' ? balc : null) };
const base = { status: 'Aprovada', forma_pagamento: 'Swile', investimento_lynkz: 120, data_fim: '2026-10-31', tipo: 'Campanha de balconista' };
const camp = [
  { ...base, id: 1, codigo: 'CMP-0001', cliente: 'Zeta Pet', campanha: 'WellPet', mecanica: 'R$ 3,00 por dose',
    swile_nome_completo: 'Maria Clara Andrade', swile_cpf: '04246148393', swile_email: 'maria@exemplo.com', swile_data_nascimento: '1995-02-10', swile_visivel: true },
  { ...base, id: 2, codigo: 'CMP-0002', cliente: 'Alfa Vet', campanha: 'Avert', mecanica: '', swile_visivel: false, balconista_id: 7, investimento_lynkz: 69, tipo: '' },
  { ...base, id: 3, codigo: 'CMP-0003', cliente: 'Beta', campanha: 'X', swile_visivel: false },                 // sem dados visíveis
  { ...base, id: 4, codigo: 'CMP-0004', cliente: 'Gama', campanha: 'Y', forma_pagamento: 'Desconto em nota' }, // não é Swile
  { ...base, id: 5, codigo: 'CMP-0005', cliente: 'Delta', campanha: 'Z', status: 'Pendente' },                 // não aprovada
  { ...base, id: 6, codigo: 'CMP-0006', cliente: 'Épsilon', campanha: 'W', data_fim: '2026-09-15', balconista_id: 7 },
];

test('mês da campanha = mês do fim; sem fim, mês da decisão', () => {
  assert.equal(mesDaCampanha({ data_fim: '2026-10-31' }), '2026-10');
  assert.equal(mesDaCampanha({ data_fim: null, data_decisao: '2026-09-02T15:00:00Z' }), '2026-09');
});

test('mesesAdp conta só aprovadas com Swile, do mais novo ao mais velho', () => {
  assert.deepEqual(mesesAdp(camp), [{ mes: '2026-10', total: 3 }, { mes: '2026-09', total: 1 }]);
});

test('mesSugerido prefere o mês passado; senão o mais recente', () => {
  const m = mesesAdp(camp);
  assert.equal(mesSugerido(m, '2026-11-24'), '2026-10');
  assert.equal(mesSugerido(m, '2026-10-05'), '2026-09');
  assert.equal(mesSugerido(m, '2027-01-10'), '2026-10');
  assert.equal(mesSugerido([{ mes: '2025-12', total: 1 }], '2026-01-03'), '2025-12');
  assert.equal(mesSugerido([], '2026-01-03'), '');
});

test('recebedor: dados Swile da campanha; senão cadastro do balconista; senão null', () => {
  assert.equal(recebedorAdp(camp[0], cad).origem, 'campanha');
  assert.equal(recebedorAdp(camp[0], cad).nascimento, '1995-02-10');
  assert.deepEqual(recebedorAdp(camp[1], cad), { nome: balc.nome_completo, cpf: balc.cpf, email: balc.email, nascimento: '1990-05-04', origem: 'cadastro' });
  assert.equal(recebedorAdp(camp[2], cad), null);
});

test('itensAdp: ordem por cliente (bloqueadas no fim), valor = investimento LYNKZ, motivo quando falta quem recebe', () => {
  const it = itensAdp(camp, cad, '2026-10');
  assert.deepEqual(it.map(x => x.c.codigo), ['CMP-0002', 'CMP-0001', 'CMP-0003'], 'por cliente; sem dados no fim');
  assert.deepEqual(it.map(x => x.valor), [69, 120, 120]);
  assert.equal(it[0].motivo, '');
  assert.match(it[2].motivo, /Administrador/);
});

test('linhaAdp monta o texto inicial de cada linha (editável no diálogo)', () => {
  const it = itensAdp(camp, cad, '2026-10').filter(x => !x.motivo);
  assert.deepEqual(linhaAdp(it[0]), {
    cliente: 'ALFA VET', tipo: 'PREMIAÇÃO CAMPANHA', observacao: 'Avert', favorecido: 'Irene Dias de Sales',
    cpf: '003.680.883-08', email: 'irene@exemplo.com', nascimento: '1990-05-04', valor: 69,
  });
  const l = linhaAdp({ ...it[1], valor: 150.456 });
  assert.equal(l.valor, 150.46);
  assert.equal(l.tipo, 'Campanha de balconista');
  assert.equal(l.observacao, 'R$ 3,00 por dose');
  assert.equal(totalAdp([{ valor: 0.1 }, { valor: 0.2 }, { valor: '3' }]), 3.3);
});

test('textoPdf troca o que a fonte do PDF não tem', () => {
  assert.equal(textoPdf('  Prescrição  ‐ ação “Avert” — 10%  '), 'Prescrição - ação “Avert” — 10%');
  assert.equal(textoPdf('Pet 🐶 Shop ≥ 2'), 'Pet ? Shop ? 2');
});

test('textos do config.js substituem os padrões', () => {
  globalThis.CONFIG = { ADP: { DEPARTAMENTO: 'MARKETING' } };
  try { assert.equal(textosAdp().DEPARTAMENTO, 'MARKETING'); assert.equal(textosAdp().LOJA, 'LYNKZ - MATRIZ'); }
  finally { delete globalThis.CONFIG; }
});

test('rótulo e nome do arquivo', () => {
  assert.equal(rotuloMes('2026-10'), 'OUTUBRO 2026');
  assert.equal(rotuloMes('2026-03'), 'MARÇO 2026');
  assert.equal(nomeArquivoAdp('2026-10'), 'ADP - CAMPANHAS - OUTUBRO 2026.pdf');
});
