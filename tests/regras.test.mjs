// Testes das regras puras. Rodar:  node --test tests/regras.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calc, banda, posRegua, lerValor, valorCampo, pct, brl, contem, cpfValido, maskCPF, maskCNPJ,
  maskTelefone, telefoneValido, dataCivil, dataBR, dias, dataExcel, colunaExcel, errosRecebedor,
  nomeCompleto, emailValido,
} from '../public/js/lib/regras.js';

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
