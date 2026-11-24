// Testes do e-mail de campanha nova (supabase/functions/avisar-aprovador/mensagem.js — C3, v2.9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarAviso, custoTotal } from '../supabase/functions/avisar-aprovador/mensagem.js';
import { calc } from '../public/js/lib/regras.js';

const CAMP = {
  id: 42, codigo: 'C26111042', cliente: 'Pet Center <Imperatriz>', laboratorio: 'Ouro Fino', campanha: 'Genéricos',
  solicitante_nome: 'Leandra', investimento_lynkz: 1500, investimento_industria: 500, meta: 20000, rebate_pct: 5, rebate_teto: 800,
  status: 'Pendente', swile_cpf: '11144477735', swile_email: 'segredo@exemplo.com', swile_nome_completo: 'Maria Recebedora',
};

test('custo do e-mail = custo do app (calc de regras.js)', () => {
  for (const c of [CAMP, { ...CAMP, rebate_teto: 0 }, { ...CAMP, meta: 0 }, { investimento_lynkz: 10 }]) {
    const a = custoTotal(c), b = calc(c);
    assert.equal(a.total, b.total);
    assert.equal(a.pctMeta, b.pctMeta);
  }
});

test('e-mail traz código, empresa, laboratório, custo e o link; nada dos dados Swile', () => {
  const m = montarAviso(CAMP, 'https://campanhas.exemplo.com.br/');
  assert.equal(m.link, 'https://campanhas.exemplo.com.br/#/campanhas/42');
  assert.match(m.assunto, /Pet Center <Imperatriz> · R\$ 2\.800,00/);
  for (const t of [m.texto, m.html]) {
    assert.ok(t.includes('C26111042') && t.includes('Ouro Fino') && t.includes('R$ 2.800,00'), t);
    assert.ok(!/11144477735|segredo@exemplo|Maria Recebedora/.test(t), 'sem dados Swile');
  }
  assert.ok(m.html.includes('Pet Center &lt;Imperatriz&gt;') && !m.html.includes('<Imperatriz>'), 'HTML escapado');
  assert.ok(m.texto.includes('14%') || m.texto.includes('da meta'), m.texto);
});
