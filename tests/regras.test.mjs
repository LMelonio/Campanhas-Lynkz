// Testes das regras puras. Rodar:  node --test tests/regras.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calc, banda, posRegua, lerValor, valorCampo, pct, brl, contem, cpfValido, cnpjValido, maskCPF, maskCNPJ,
  maskTelefone, telefoneValido, dataCivil, dataBR, dias, dataExcel, colunaExcel, errosRecebedor,
  nomeCompleto, emailValido, textoDevolucoes, listaLaboratorios, juntarLaboratorios,
  MAX_FORNECEDORES, MAX_MARCAS, feriadosNacionais, diaUtil, somaDiasUteis, listaMarcas, juntarMarcas, textoMarcas, lerDivisao, somaDivisao, partilha, errosDivisao, LIMITES as LIM,
  SENHA_MIN, problemaSenha, pedacosPessoais,
} from '../public/js/lib/regras.js';

test('senha nova (v3.4): 10 caracteres e sem o nome nem o e-mail', () => {
  const ana = { nome: 'Maria Eduarda da Silva', email: 'duda.silva@lynkz.com.br' };
  assert.equal(SENHA_MIN, 10);
  assert.match(problemaSenha('123456789', ana), /10 caracteres/);
  assert.equal(problemaSenha('ponte-azul-77', ana), '');
  assert.match(problemaSenha('Maria@2026', ana), /nome nem seu e-mail/, 'padrão "Nome@"');
  assert.match(problemaSenha('EDUARDA1234', ana), /nome/, 'maiúsculas');
  assert.match(problemaSenha('xx-dudá-2026', ana), /e-mail/, 'parte do e-mail, com acento');
  assert.equal(problemaSenha('daqui-pra-la', ana), '', 'partícula "da" não conta');
  assert.deepEqual(pedacosPessoais(ana), ['maria', 'eduarda', 'silva', 'duda']);
  assert.deepEqual(pedacosPessoais({}), []);
  assert.equal(problemaSenha('1234567890'), '', 'sem dados da conta: só o tamanho');
});

test('laboratórios (v2.12): texto da campanha ↔ lista', () => {
  assert.deepEqual(listaLaboratorios('Ouro Fino, Avert'), ['Ouro Fino', 'Avert']);
  assert.deepEqual(listaLaboratorios('Avert'), ['Avert'], 'campanha antiga, com um só');
  assert.deepEqual(listaLaboratorios(' Ouro Fino ,, Avert, Ouro Fino '), ['Ouro Fino', 'Avert'], 'espaços, vazios e repetidos');
  assert.deepEqual(listaLaboratorios(null), []);
  assert.equal(juntarLaboratorios(['Ouro Fino', 'Avert', 'Ouro Fino']), 'Ouro Fino, Avert');
  assert.equal(juntarLaboratorios([]), '');
  // O separador é a vírgula: nenhum nome da lista do config.js pode ter vírgula.
  const cfg = readFileSync(new URL('../public/config.js', import.meta.url), 'utf8');
  const labs = JSON.parse(cfg.match(/LABORATORIOS:\s*(\[[^\]]*\])/)[1]);
  assert.ok(labs.length && labs.every(l => !l.includes(',')), 'LABORATORIOS sem vírgula');
  assert.ok(labs.every(l => l.length <= LIMITES.textos.laboratorio));
});

const FAIXAS = { verde: 0.08, amarela: 0.15 };

test('calc soma investimentos e rebate estimado', () => {
  const k = calc({ investimento_lynkz: 1000, investimento_industria: 500, meta: 20000, rebate_pct: 2 });
  assert.equal(k.inv, 1500);
  assert.equal(k.reb, 400);
  assert.equal(k.total, 1900);
  assert.equal(k.pctMeta, 0.095);
});

test('calc limita o rebate pelo teto e trata meta zero', () => {
  const k = calc({ meta: 100000, rebate_pct: 5, rebate_teto: 1000 });
  assert.equal(k.reb, 1000);
  assert.equal(k.limitado, true);
  assert.equal(calc({ investimento_lynkz: 10 }).pctMeta, null);
});

test('banda usa as faixas do config e posRegua satura em 25%', () => {
  assert.equal(banda(0.05, FAIXAS).nivel, 'verde');
  assert.equal(banda(0.08, FAIXAS).nivel, 'verde');
  assert.equal(banda(0.12, FAIXAS).nivel, 'ambar');
  assert.equal(banda(0.30, FAIXAS).nivel, 'vermelho');
  assert.equal(banda(null, FAIXAS).nivel, 'nenhum');
  assert.equal(posRegua(0.125), 50);
  assert.equal(posRegua(0.9), 100);
});

test("lerValor aceita '1.234,56', '2.000' e '1234.56'", () => {
  assert.equal(lerValor('1.234,56'), 1234.56);
  assert.equal(lerValor('2.000'), 2000);
  assert.equal(lerValor('2000'), 2000);
  assert.equal(lerValor('1234.56'), 1234.56);
  assert.equal(lerValor('R$ 15,5'), 15.5);
  assert.equal(lerValor(''), 0);
  assert.ok(Number.isNaN(lerValor('abc')));
});

test('formatação pt-BR de valores e percentuais', () => {
  assert.equal(brl(1234.5), '1.234,50');
  assert.equal(valorCampo(2000), '2.000,00');
  assert.equal(valorCampo(null), '');
  assert.equal(pct(0.079), '7,9%');
  assert.equal(pct(null), '—');
});

test("contem busca sem acento: 'biogenesis' acha 'Biogénesis Bagó Pet'", () => {
  assert.ok(contem('biogenesis', 'Biogénesis Bagó Pet'));
  assert.ok(contem('BAGO pet', 'Biogénesis Bagó Pet'));
  assert.ok(!contem('ourofino', 'Biogénesis Bagó Pet'));
  assert.ok(contem('', 'qualquer'));
});

test('CPF 529.982.247-25 é válido; sequências e dígitos errados não', () => {
  assert.ok(cpfValido('529.982.247-25'));
  assert.ok(cpfValido('52998224725'));
  assert.ok(!cpfValido('529.982.247-24'));
  assert.ok(!cpfValido('111.111.111-11'));
  assert.ok(!cpfValido('123'));
});

test('máscaras de CPF, CNPJ e telefone', () => {
  assert.equal(maskCPF('52998224725'), '529.982.247-25');
  assert.equal(maskCNPJ('12345678000190'), '12.345.678/0001-90');
  assert.equal(maskTelefone('98999990000'), '(98) 99999-0000');
  assert.equal(maskTelefone('9832210000'), '(98) 3221-0000');
  assert.ok(telefoneValido('(98) 99999-0000'));
  assert.ok(!telefoneValido('9999-0000'));
});

test('2026-11-19T01:30:00Z cai em 18/11/2026 no fuso do Maranhão', () => {
  assert.equal(dataCivil('2026-11-19T01:30:00Z'), '2026-11-18');
  assert.equal(dataBR('2026-11-19T01:30:00Z'), '18/11/2026');
  assert.equal(dataBR('2026-11-18'), '18/11/2026');
  assert.equal(dataBR(null), '—');
});

test('dias conta o primeiro e o último dia', () => {
  assert.equal(dias('2026-11-01', '2026-11-30'), 30);
  assert.equal(dias('2026-11-01', null), null);
});

test('dataExcel gera o serial do Excel no fuso local', () => {
  assert.equal(dataExcel('1900-03-01'), 61);
  assert.equal(dataExcel('2026-11-18'), 46344);
  assert.equal(dataExcel('2026-11-19T01:30:00Z'), 46344);
  assert.equal(dataExcel(''), '');
});

test('colunaExcel calcula a letra da coluna', () => {
  assert.equal(colunaExcel(0), 'A');
  assert.equal(colunaExcel(25), 'Z');
  assert.equal(colunaExcel(26), 'AA');
  assert.equal(colunaExcel(31), 'AF');
  assert.equal(colunaExcel(701), 'ZZ');
});

test('nome completo e e-mail', () => {
  assert.ok(nomeCompleto('Maria Silva'));
  assert.ok(!nomeCompleto('  Maria  '));
  assert.ok(emailValido('maria@lynkz.com.br'));
  assert.ok(!emailValido('maria@lynkz'));
});

test('errosRecebedor aplica a régua dos 5 dados', () => {
  const certo = { nome_completo: 'Maria Silva', cpf: '529.982.247-25', data_nascimento: '1990-05-10',
                  email: 'maria@x.com', telefone: '(98) 99999-0000' };
  assert.deepEqual(errosRecebedor(certo, '2026-11-18'), {});
  const e = errosRecebedor({ nome_completo: 'Maria', cpf: '111', data_nascimento: '2030-01-01',
                             email: 'x', telefone: '123' }, '2026-11-18');
  assert.deepEqual(Object.keys(e).sort(), ['cpf', 'data_nascimento', 'email', 'nome_completo', 'telefone']);
});

test('datas: soma de dias, mês inteiro e hora no fuso', async () => {
  const { somaDias, periodoMes, horaBR, quandoBR } = await import('../public/js/lib/regras.js');
  assert.equal(somaDias('2026-11-18', 29), '2026-12-17');
  assert.equal(somaDias('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(periodoMes('2026-11-18'), ['2026-11-01', '2026-11-30']);
  assert.deepEqual(periodoMes('2026-12-05', 1), ['2027-01-01', '2027-01-31']);
  assert.deepEqual(periodoMes('2028-01-31', 1), ['2028-02-01', '2028-02-29']);
  assert.equal(horaBR('2026-11-19T01:30:00Z'), '22:30');
  const agora = new Date('2026-11-18T15:00:00Z');
  assert.equal(quandoBR('2026-11-18T13:32:00Z', agora), 'hoje, 10:32');
  assert.equal(quandoBR('2026-11-17T13:32:00Z', agora), 'ontem, 10:32');
  assert.equal(quandoBR('2026-11-10T13:32:00Z', agora), '10/11/2026, 10:32');
});

test('cnpjValido confere os dígitos verificadores', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido('11.111.111/1111-11'), false);
  assert.equal(cnpjValido('11.222.333/0001-82'), false);
  assert.equal(cnpjValido('123'), false);
});

// ---------- LIMITES x banco ----------
// Os limites da tela (LIMITES) e as constraints do banco precisam ser os mesmos números.
import { readFileSync } from 'node:fs';
import { LIMITES } from '../public/js/lib/regras.js';

function constraintDoSchema(nome) {
  const sql = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  const i = sql.indexOf(`add constraint ${nome} check (`);
  assert.ok(i > 0, `constraint ${nome} não encontrada em sql/schema.sql`);
  return sql.slice(i, sql.indexOf('not valid', i));
}

test('LIMITES de valor batem com campanhas_valores_faixa do banco', () => {
  const c = constraintDoSchema('campanhas_valores_faixa');
  for (const campo of ['investimento_lynkz', 'investimento_industria', 'meta', 'rebate_pct', 'rebate_teto']) {
    const m = c.match(new RegExp(String.raw`${campo}\s*<=\s*(\d+)`));
    assert.ok(m, `${campo} sem limite no banco`);
    assert.equal(Number(m[1]), LIMITES[campo], campo);
  }
});

test('LIMITES de texto batem com campanhas_textos_tamanho do banco', () => {
  const c = constraintDoSchema('campanhas_textos_tamanho');
  const doBanco = Object.fromEntries([...c.matchAll(/texto_ate\((\w+),\s*(\d+)\)/g)].map(m => [m[1], Number(m[2])]));
  assert.deepEqual(doBanco, { ...LIMITES.textos });
});

test('limite de balconistas por empresa bate com o gatilho do banco (migração 12)', () => {
  const sql = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  const i = sql.indexOf('function public.limitar_balconistas_empresa()');
  assert.ok(i > 0, 'limitar_balconistas_empresa não encontrada em sql/schema.sql');
  const m = sql.slice(i, i + 1200).match(/count\(\*\) from public\.balconistas where empresa_id = new\.empresa_id\) >= (\d+)/);
  assert.ok(m, 'contagem do limite não encontrada');
  assert.equal(Number(m[1]), LIMITES.balconistas_por_empresa);
});

test('textoDevolucoes: valor negativo e quantas notas (ou que o Qlik não diz qual)', () => {
  assert.equal(textoDevolucoes(300, 1), '−R$ 300,00 (1 nota)');
  assert.equal(textoDevolucoes(2892.47, 2), '−R$ 2.892,47 (2 notas)');
  assert.equal(textoDevolucoes(50, 0), '−R$ 50,00 (nota de origem não identificada no Qlik)');
});

test('LIMITES das devoluções batem com campanhas_devolucoes_faixa do banco (migração 13)', () => {
  const c = constraintDoSchema('campanhas_devolucoes_faixa');
  assert.equal(Number(c.match(/compras_devolucoes <= (\d+)/)[1]), LIMITES.compras_devolucoes);
  assert.equal(Number(c.match(/jsonb_array_length\(compras_devolvidas\) <= (\d+)/)[1]), LIMITES.compras_devolvidas);
});

// ---------- fornecedores ----------
const divisao = (o = {}) => ({
  laboratorio: 'Ouro Fino, Avert', meta: 30000, investimento_industria: 1500, rebate_pct: 2, rebate_teto: 0,
  fornecedores: [{ nome: 'Ouro Fino', meta: 20000, investimento_industria: 1000 }, { nome: 'Avert', meta: 10000, investimento_industria: 500 }],
  ...o,
});

test('lerDivisao: só com 2 ou mais fornecedores; números vindos do banco (texto) viram número', () => {
  assert.equal(lerDivisao({ fornecedores: null }), null);
  assert.equal(lerDivisao({}), null);
  assert.equal(lerDivisao({ fornecedores: [{ nome: 'A', meta: 1 }] }), null, 'um só não é divisão');
  assert.deepEqual(lerDivisao({ fornecedores: [{ nome: 'A', meta: '10.5' }, { nome: 'B' }] }),
    [{ nome: 'A', meta: 10.5, investimento_industria: 0 }, { nome: 'B', meta: 0, investimento_industria: 0 }]);
});

test('somaDivisao soma em centavos', () => {
  assert.deepEqual(somaDivisao([{ meta: 0.1, investimento_industria: 0.2 }, { meta: 0.2, investimento_industria: 0.1 }]), { meta: 0.3, investimento_industria: 0.3 });
  assert.deepEqual(somaDivisao([]), { meta: 0, investimento_industria: 0 });
});

test('partilha: rebate proporcional à meta de cada fornecedor', () => {
  const p = partilha(divisao());
  assert.deepEqual(p.map(x => x.rebate), [400, 200], '2% de 20 mil e de 10 mil');
  assert.deepEqual(p.map(x => Math.round(x.peso * 1000) / 1000), [0.667, 0.333]);
  assert.equal(p[0].investimento_industria, 1000);
  assert.equal(partilha({ ...divisao(), fornecedores: null }), null, 'sem divisão');
});

test('partilha: o teto é repartido na mesma proporção e as partes fecham com o total', () => {
  const p = partilha(divisao({ rebate_teto: 500 }));
  assert.equal(calc(divisao({ rebate_teto: 500 })).reb, 500);
  assert.deepEqual(p.map(x => x.rebate), [333.33, 166.67]);
  assert.equal(Math.round(p.reduce((s, x) => s + x.rebate, 0) * 100), 50000, 'soma = R$ 500,00 exatos');
  const tres = partilha({ meta: 3, rebate_pct: 100, rebate_teto: 1, fornecedores: [{ nome: 'A', meta: 1 }, { nome: 'B', meta: 1 }, { nome: 'C', meta: 1 }] });
  assert.deepEqual(tres.map(x => x.rebate), [0.33, 0.33, 0.34], 'centavos que sobram vão para o último');
});

test('partilha: sem meta, partes iguais e rebate zero', () => {
  const p = partilha({ meta: 0, rebate_pct: 2, fornecedores: [{ nome: 'A', meta: 0 }, { nome: 'B', meta: 0 }] });
  assert.deepEqual(p.map(x => x.peso), [0.5, 0.5]);
  assert.deepEqual(p.map(x => x.rebate), [0, 0]);
});

test('errosDivisao: valor inválido, negativo, acima do limite e soma acima do limite', () => {
  assert.deepEqual(errosDivisao([{ meta: 1, investimento_industria: 0 }, { meta: 2, investimento_industria: 0 }]), { porLinha: {}, geral: '' });
  const e = errosDivisao([{ meta: NaN, investimento_industria: -1 }, { meta: LIM.meta + 1, investimento_industria: LIM.investimento_industria + 1 }]);
  assert.match(e.porLinha[0].meta, /inválido/);
  assert.match(e.porLinha[0].investimento_industria, /inválido/);
  assert.match(e.porLinha[1].meta, /limite/);
  assert.match(e.porLinha[1].investimento_industria, /limite/);
  assert.match(errosDivisao([{ meta: LIM.meta, investimento_industria: 0 }, { meta: 1, investimento_industria: 0 }]).geral, /soma das metas/);
});

test('MAX_FORNECEDORES bate com o banco (migração 14)', () => {
  assert.equal(MAX_FORNECEDORES, 5);
  const sql = readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  const i = sql.indexOf('add constraint campanhas_fornecedores_max');
  assert.ok(i > 0, 'campanhas_fornecedores_max não encontrada em sql/schema.sql');
  assert.match(sql.slice(i, sql.indexOf('not valid', i)), /<= 5\)/);
  assert.match(sql, /jsonb_array_length\(f\) > 5/);
});

test('marcas (v2.14): texto gravado ↔ lista, sem repetir; vírgula no nome não separa', () => {
  assert.deepEqual(listaMarcas('WELLPET; PROTEÇÃO'), ['WELLPET', 'PROTEÇÃO']);
  assert.deepEqual(listaMarcas('WELLPET'), ['WELLPET'], 'campanha antiga, com uma marca');
  assert.deepEqual(listaMarcas(' A ;; B; A '), ['A', 'B']);
  assert.deepEqual(listaMarcas('CAES, GATOS; X'), ['CAES, GATOS', 'X'], 'vírgula fica no nome');
  assert.deepEqual(listaMarcas(null), []);
  assert.deepEqual(listaMarcas(['A', 'A', 'B']), ['A', 'B']);
  assert.equal(juntarMarcas(['WELLPET', 'PROTEÇÃO']), 'WELLPET; PROTEÇÃO');
  assert.equal(textoMarcas('A; B; C'), 'A, B e C');
  assert.equal(textoMarcas('A'), 'A');
  assert.equal(MAX_MARCAS, 10);
});

test('MAX_MARCAS bate com o Worker', async () => {
  const { MAX_MARCAS: doWorker } = await import('../worker/qlik-engine.js');
  assert.equal(doWorker, MAX_MARCAS);
});

test('dias úteis: fins de semana e feriados nacionais (fixos e móveis) não contam', () => {
  const f = feriadosNacionais(2026);
  for (const d of ['2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-06-04', '2026-11-20', '2026-12-25']) assert.ok(f.has(d), d);
  assert.ok(feriadosNacionais(2027).has('2027-03-26'), 'Sexta-feira Santa de 2027');
  assert.equal(diaUtil('2026-11-28'), false, 'sábado');
  assert.equal(diaUtil('2026-11-25'), true, 'quarta comum');
  assert.equal(somaDiasUteis('2026-11-25', 7), '2026-12-04');
  assert.equal(somaDiasUteis('2026-12-22', 7), '2027-01-04', 'pula Natal e Ano-Novo');
  assert.equal(somaDiasUteis('2027-02-05', 7), '2027-02-18', 'pula o Carnaval');
  assert.equal(somaDiasUteis('2026-11-27', 1), '2026-11-30', 'sexta + 1 = segunda');
});
