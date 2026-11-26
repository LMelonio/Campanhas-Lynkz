// ADP (autorização de pagamento) das campanhas pagas pela Swile, em PDF A4 deitado.
// A parte pura (quem entra, recebedor, linhas, vencimento) é testada em tests/adp.test.mjs;
// o desenho é de pdf/motor.js (pdf-lib, carregado só ao gerar), o mesmo dos recibos e da ADP dos PJ.
import { calc, dataCivil, dataBR, maskCPF, soDigitos, hojeCivil, somaDiasUteis } from './lib/regras.js';
import { ErroApp } from './dados/erros.js';
import { abrirPdf, dinheiro, A4_DEITADA, MM } from './pdf/motor.js';

export { textoPdf } from './pdf/motor.js';

// Textos fixos da ADP. Mudam no config.js (ADP: { ... }) sem mexer aqui.
const PADRAO = {
  EMPRESA_PAGADORA: 'LYNKZ DIST S.A - MATRIZ',
  LOJA: 'LYNKZ - MATRIZ',
  DEPARTAMENTO: 'COMERCIAL',
  FORMA: 'SWILE',
  TIPO_SEM_TIPO: 'PREMIAÇÃO CAMPANHA',
};
export const textosAdp = () => ({ ...PADRAO, ...(globalThis.CONFIG?.ADP || {}) });

export const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

// "2026-10" → "OUTUBRO 2026".
export function rotuloMes(mes) {
  const [a, m] = String(mes).split('-').map(Number);
  return MESES[m - 1] ? `${MESES[m - 1]} ${a}` : '';
}

// Período de uma ADP com campanhas de vários meses:
// ["2026-10"] → "OUTUBRO 2026"; ["2026-09","2026-10"] → "SETEMBRO A OUTUBRO 2026";
// ["2025-12","2026-01"] → "DEZEMBRO 2025 A JANEIRO 2026".
export function rotuloPeriodo(meses) {
  const ms = [...new Set([].concat(meses).filter(Boolean))].sort();
  if (ms.length <= 1) return rotuloMes(ms[0] || '');
  const [ini, fim] = [ms[0], ms[ms.length - 1]];
  const mesmoAno = ini.slice(0, 4) === fim.slice(0, 4);
  return `${mesmoAno ? MESES[+ini.slice(5, 7) - 1] : rotuloMes(ini)} A ${rotuloMes(fim)}`;
}

// Valor do seletor de mês que lista todas as aprovadas com Swile, de qualquer mês.
export const TODAS = 'todas';

// Mês de referência da campanha: o mês em que terminou (é quando se apura e paga).
// Sem data de fim, o mês da aprovação.
export const mesDaCampanha = c => dataCivil(c.data_fim || c.data_decisao).slice(0, 7);

export const entraNaAdp = c => c.status === 'Aprovada' && c.forma_pagamento === 'Swile';

// Meses com campanhas para a ADP, do mais recente para o mais antigo: [{ mes, total }].
export function mesesAdp(campanhas) {
  const conta = new Map();
  for (const c of campanhas) {
    if (!entraNaAdp(c)) continue;
    const m = mesDaCampanha(c);
    if (m) conta.set(m, (conta.get(m) || 0) + 1);
  }
  return [...conta].map(([mes, total]) => ({ mes, total })).sort((a, b) => b.mes.localeCompare(a.mes));
}

// Mês sugerido ao abrir: o mês passado (o que costuma ser pago agora), se tiver campanha;
// senão o mais recente que tiver.
export function mesSugerido(meses, hoje) {
  const [a, m] = String(hoje).split('-').map(Number);
  const passado = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
  return meses.some(x => x.mes === passado) ? passado : meses[0]?.mes || '';
}

// Quem recebe: os dados Swile gravados na campanha (aprovador e quem pediu enxergam);
// senão o cadastro do balconista (todos enxergam). Sem nenhum dos dois → null.
export function recebedorAdp(c, cad) {
  if (c.swile_visivel !== false && c.swile_nome_completo) {
    return { nome: c.swile_nome_completo, cpf: c.swile_cpf, email: c.swile_email, nascimento: c.swile_data_nascimento, origem: 'campanha' };
  }
  const b = c.balconista_id ? cad.balconista(c.balconista_id) : null;
  if (b) return { nome: b.nome_completo, cpf: b.cpf, email: b.email, nascimento: b.data_nascimento, origem: 'cadastro' };
  return null;
}

// Campanhas do mês (ou de todos os meses, com mes = TODAS) para o diálogo:
// { c, mes, recebedor, valor, motivo }. motivo ≠ '' → não pode entrar (fica no fim).
export function itensAdp(campanhas, cad, mes) {
  return campanhas
    .filter(c => entraNaAdp(c) && mesDaCampanha(c) && (mes === TODAS || mesDaCampanha(c) === mes))
    .sort((a, b) => String(a.cliente).localeCompare(String(b.cliente), 'pt-BR') || String(a.codigo).localeCompare(String(b.codigo)))
    .map(c => {
      const recebedor = recebedorAdp(c, cad);
      return {
        c, mes: mesDaCampanha(c), recebedor,
        valor: calc(c).invL,
        motivo: recebedor ? '' : 'Os dados de quem recebe ficam visíveis só para o Administrador e para quem pediu a campanha.',
      };
    })
    .sort((a, b) => Number(!!a.motivo) - Number(!!b.motivo));
}

// Texto inicial de cada linha da ADP (o diálogo deixa editar tudo antes de gerar).
export function linhaAdp({ c, recebedor, valor }) {
  const t = textosAdp();
  return {
    cliente: String(c.cliente || '').toUpperCase(),
    tipo: c.tipo || t.TIPO_SEM_TIPO,
    observacao: String(c.mecanica || '').trim() || c.campanha || '',
    favorecido: recebedor.nome || '',
    cpf: soDigitos(recebedor.cpf).length === 11 ? maskCPF(recebedor.cpf) : String(recebedor.cpf || ''),
    email: recebedor.email || '',
    nascimento: dataCivil(recebedor.nascimento) || '',
    valor: Math.round((+valor || 0) * 100) / 100,
  };
}

// Vencimento padrão: 7 dias úteis após a emissão.
export const DIAS_UTEIS_VENCIMENTO = 7;
export const vencimentoPadrao = (emissao = hojeCivil()) => somaDiasUteis(emissao, DIAS_UTEIS_VENCIMENTO);

// mes: '2026-10' ou a lista de meses das campanhas da ADP.
export const nomeArquivoAdp = mes => `ADP - CAMPANHAS - ${rotuloPeriodo(mes)}.pdf`;
export const totalAdp = linhas => Math.round(linhas.reduce((s, l) => s + (+l.valor || 0), 0) * 100) / 100;

// ---------------- PDF (navegador; o desenho é de pdf/motor.js) ----------------
// linhas: [{ cliente, tipo, observacao, favorecido, cpf, email, nascimento, valor }] já conferidas.
// opcoes: { mes: '2026-10' (ou a lista de meses das linhas), vencimento: '2026-11-06', emitidoEm }
// Sem nomes no PDF: quem autoriza se identifica na assinatura (SignZoo).
export async function gerarAdp(linhas, { mes, vencimento, emitidoEm = hojeCivil() }) {
  if (!linhas.length) throw new ErroApp('Marque pelo menos uma campanha para a ADP.');
  const t = textosAdp();
  const P = await abrirPdf(nomeArquivoAdp(mes).replace(/\.pdf$/, ''));
  const { B, C } = P;
  // A4 deitada. Aqui "R$" pode quebrar a linha longe do número, como sempre saiu.
  const F = P.fluxo({ tamanho: A4_DEITADA, x: 13 * MM, topo: 14 * MM, base: 11 * MM, grudarReais: false });
  const total = totalAdp(linhas);

  F.cabecalho('AUTORIZAÇÃO DE PAGAMENTO', `CAMPANHAS  ·  ${rotuloPeriodo(mes)}`);
  F.faixa([
    ['EMPRESA PAGADORA', t.EMPRESA_PAGADORA, 1.35], ['LOJA', t.LOJA, 1], ['DEPARTAMENTO', t.DEPARTAMENTO, 1],
    ['FORMA DE PAGAMENTO', t.FORMA, 1], ['VENCIMENTO', dataBR(vencimento), 1],
    [`TOTAL A PAGAR · ${linhas.length} ${linhas.length === 1 ? 'CRÉDITO' : 'CRÉDITOS'}`, dinheiro(total), 1.25],
  ]);
  F.tabela('CAMPANHAS', [
    { titulo: 'ITEM', w: 28, alinhar: 'centro', f: B, cor: C.ink2, valor: (l, i) => String(i + 1) },
    { titulo: 'CLIENTE', w: 196, f: B, linhas: 2, valor: l => l.cliente },
    { titulo: 'TIPO', w: 112, cor: C.ink2, linhas: 2, valor: l => l.tipo },
    { titulo: 'OBSERVAÇÃO AO FISCAL - CAMPANHA E RECEBEDOR', w: 0, linhas: 3, valor: l => l.observacao },
    { titulo: 'VALOR', w: 72, alinhar: 'dir', f: B, valor: l => dinheiro(l.valor) },
  ], linhas, { total: { rotulo: 'TOTAL GERAL DA CAMPANHA', valor: total } });
  F.tabela('DADOS DOS RECEBEDORES', [
    { titulo: 'ITEM', w: 28, alinhar: 'centro', f: B, cor: C.ink2, valor: (l, i) => String(i + 1) },
    { titulo: 'EMPRESA PAGADORA', w: 112, valor: () => t.EMPRESA_PAGADORA },
    { titulo: 'FAVORECIDO', w: 158, f: B, valor: l => l.favorecido },
    { titulo: 'FORMA', w: 46, valor: () => t.FORMA },
    { titulo: 'CPF', w: 78, alinhar: 'centro', valor: l => l.cpf },
    { titulo: 'NASCIMENTO', w: 62, alinhar: 'centro', valor: l => (l.nascimento ? dataBR(l.nascimento) : '') },
    { titulo: 'E-MAIL DO RECEBEDOR SWILE', w: 0, valor: l => l.email },
    { titulo: 'R$', w: 72, alinhar: 'dir', f: B, valor: l => dinheiro(l.valor) },
  ], linhas);
  F.assinatura(emitidoEm);
  F.numerarPaginas();

  await P.baixar(nomeArquivoAdp(mes));
  return { total, quantidade: linhas.length, paginas: F.paginas };
}
