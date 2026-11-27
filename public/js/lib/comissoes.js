// ============================================================
//  COMISSÕES — regras puras do cálculo (sem navegador, sem banco).
//  Testes: tests/comissoes.test.mjs. Quem chama: dados/comissoes.js e telas/comissoes.js.
//
//  Regras (revisão nov/2026, decididas com a gestão):
//   - Base: receita menos devolução no Qlik (atacado, regular), do dia seguinte ao
//     corte do mês anterior até o dia do corte (padrão 26 a 25).
//   - Venda Farelo = fornecedor do código do parâmetro (6610). Venda Principal = o resto.
//   - Comissão = venda × % do cadastro de cada pessoa (CLT 2,5 · Televendas 1 · PJ 5 · Farelo 1 / 2).
//   - Premiações: lançadas à mão, para CLT e PJ.
//   - Contrato de Resultado (só PJ): mês anterior fechado (01 ao último dia). Paga se
//     faturamento ≥ 100% da meta E positivação ≥ 80% da meta; 1,0% do realizado até 105%,
//     1,2% acima de 105%. Metas do mês (aba Contrato; sem elas, as do cadastro);
//     realizado do Qlik, ou informado à mão com motivo.
//   - Cada pessoa tem um nome só no Qlik (Vendedor B2B); nomes novos aparecem para completar o cadastro.
//   - Acordo mínimo (só CLT, dentro da vigência): paga o maior entre a soma e o acordo.
//   - Ajustes (motivo obrigatório) entram depois do piso.
//   - Parcelas podem ser negativas (devolução maior que a venda); o valor a pagar nunca
//     fica abaixo de zero e nada passa para o mês seguinte.
//   - Cada parcela é arredondada a centavos; os totais são a soma das parcelas arredondadas.
//   - Não existe mais bônus por cliente novo.
// ============================================================

export const REGIMES = Object.freeze(['CLT', 'TELEVENDAS', 'PJ']);
export const ROTULO_REGIME = Object.freeze({ CLT: 'CLT', TELEVENDAS: 'CLT · Televendas', PJ: 'PJ' });
export const ehPJ = c => c?.regime === 'PJ';

// Parâmetros de fábrica (iguais à linha padrão da migração 15).
export const PARAMETROS_PADRAO = Object.freeze({
  cod_farelo: '6610',
  dia_corte: 25,
  pct_clt_principal: 2.5, pct_clt_farelo: 1,
  pct_televendas_principal: 1, pct_televendas_farelo: 1,
  pct_pj_principal: 5, pct_pj_farelo: 2,
  contrato_gatilho_faturamento: 100,
  contrato_gatilho_positivacao: 80,
  contrato_limite_faixa: 105,
  contrato_pct_faixa1: 1,
  contrato_pct_faixa2: 1.2,
  nomes_ignorados: [],
});

// % padrão de um regime (o cadastro de cada pessoa começa com estes valores).
export function pctPadrao(regime, p = PARAMETROS_PADRAO) {
  const k = { CLT: 'clt', TELEVENDAS: 'televendas', PJ: 'pj' }[regime] || 'clt';
  return { principal: Number(p[`pct_${k}_principal`]), farelo: Number(p[`pct_${k}_farelo`]) };
}

// ---------- dinheiro ----------
// Tudo em centavos inteiros por dentro: soma sem erro de vírgula flutuante.
// Meio centavo arredonda para longe do zero (0,005 → 0,01; −0,005 → −0,01).
export const centavos = n => {
  const v = Number(n) || 0;
  return (Math.sign(v) * Math.round(Math.abs(v) * 100 + 1e-7)) || 0;
};
export const reais = c => c / 100;
export const arred = n => reais(centavos(n));
// valor × percentual (2,5 = 2,5%) em centavos.
const aplicar = (valor, pct) => centavos((Number(valor) || 0) * (Number(pct) || 0) / 100);

// ---------- nomes do Qlik ----------
// "  Leonardo  Representaçoes " → "LEONARDO REPRESENTACOES". Só para comparar; o banco
// guarda o nome como veio do Qlik (em maiúsculas).
export const chaveNome = s => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toUpperCase();

// Nome do Qlik como o banco guarda: maiúsculas, um espaço entre palavras, acentos mantidos.
export const nomeQlik = s => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

// "DOMINGOS DAS MERCES" → "Domingos das Merces": nome sugerido para quem chega do Qlik.
export const nomeLegivel = n => String(n ?? '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, x => x.toLowerCase());

// Cadastro de quem apareceu em "Novos no Qlik": regime e % padrão dos parâmetros; o resto fica em branco
// (dados da PJ, acordo e equipe se completam depois, no Cadastro).
export function novoDoQlik(nomeDoQlik, regime = 'CLT', p = PARAMETROS_PADRAO) {
  const pct = pctPadrao(regime, p);
  return {
    nome: nomeLegivel(nomeQlik(nomeDoQlik)), regime, pct_principal: pct.principal, pct_farelo: pct.farelo,
    nomes_qlik: [nomeQlik(nomeDoQlik)], ativo: true,
  };
}

// ---------- períodos ----------
const iso = t => new Date(t).toISOString().slice(0, 10);
const partesMes = mes => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(mes || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) throw new Error(`Mês inválido: ${mes}`);
  return [+m[1], +m[2]];
};
export const ultimoDia = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();

// Apuração de "2026-10" com corte 25 → 26/09/2026 a 25/10/2026.
export function periodoApuracao(mes, diaCorte = PARAMETROS_PADRAO.dia_corte) {
  const [a, m] = partesMes(mes);
  const corte = Math.max(1, Math.min(28, Math.trunc(diaCorte) || 25));
  return { inicio: iso(Date.UTC(a, m - 2, corte + 1)), fim: iso(Date.UTC(a, m - 1, corte)) };
}

// Mês anterior fechado (Contrato de Resultado): "2026-10" → 01/09/2026 a 30/09/2026.
export function mesAnteriorFechado(mes) {
  const [a, m] = partesMes(mes);
  return { inicio: iso(Date.UTC(a, m - 2, 1)), fim: iso(Date.UTC(a, m - 1, 0)), mes: iso(Date.UTC(a, m - 2, 1)).slice(0, 7) };
}

export const mesDe = civil => String(civil || '').slice(0, 7);
// "2026-10" → mês anterior / seguinte.
export function somaMes(mes, n) {
  const [a, m] = partesMes(mes);
  return iso(Date.UTC(a, m - 1 + n, 1)).slice(0, 7);
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export function rotuloMesComissao(mes) {
  const [a, m] = partesMes(mes);
  return `${MESES[m - 1]} ${a}`;
}

// Acordo mínimo vale no mês se o valor for > 0 e a vigência cruzar o mês (fim em branco = sem fim).
export function acordoVigente(c, mes) {
  const valor = Number(c?.acordo_minimo) || 0;
  if (ehPJ(c) || valor <= 0 || !c.acordo_inicio) return null;
  const [a, m] = partesMes(mes);
  const primeiro = iso(Date.UTC(a, m - 1, 1));
  const ultimo = iso(Date.UTC(a, m, 0));
  if (c.acordo_inicio > ultimo) return null;
  if (c.acordo_fim && c.acordo_fim < primeiro) return null;
  return { valor: arred(valor), inicio: c.acordo_inicio, fim: c.acordo_fim || null };
}

// ---------- casamento das vendas do Qlik com o cadastro ----------
// vendas: [{ vendedor, total, farelo }] (uma linha por "Vendedor B2B").
// Nome de cadastro desativado não entra na comissão nem em "Novos no Qlik": vai para `desativados`
// (senão "Completar cadastro" criava um segundo cadastro para a mesma pessoa).
// → { porId: Map(id → { totalC, fareloC, nomes:[] }), semCadastro: [{ vendedor, total, farelo }],
//     desativados: [{ id, nome, vendedor, total, farelo }], ignorados: [...] }
export function juntarVendas(vendas, comissionados, nomesIgnorados = []) {
  const dono = new Map();
  const inativo = new Map();
  for (const c of comissionados) {
    for (const n of c.nomes_qlik || []) (c.ativo === false ? inativo : dono).set(chaveNome(n), c);
  }
  const ignorar = new Set((nomesIgnorados || []).map(chaveNome));
  const porId = new Map();
  const semCadastro = [];
  const desativados = [];
  const ignorados = [];
  for (const v of vendas || []) {
    const k = chaveNome(v.vendedor);
    const id = dono.get(k)?.id;
    if (id == null) {
      const linha = { vendedor: v.vendedor, total: arred(v.total), farelo: arred(v.farelo) };
      const c = inativo.get(k);
      if (c) desativados.push({ id: c.id, nome: c.nome, ...linha });
      else (ignorar.has(k) ? ignorados : semCadastro).push(linha);
      continue;
    }
    const a = porId.get(id) || { totalC: 0, fareloC: 0, nomes: [] };
    a.totalC += centavos(v.total);
    a.fareloC += centavos(v.farelo);
    a.nomes.push(v.vendedor);
    porId.set(id, a);
  }
  const porValor = (x, y) => Math.abs(y.total) - Math.abs(x.total) || String(x.vendedor).localeCompare(String(y.vendedor), 'pt-BR');
  return { porId, semCadastro: semCadastro.sort(porValor), desativados: desativados.sort(porValor), ignorados: ignorados.sort(porValor) };
}

// Realizados do Contrato de Resultado a partir das linhas vendedor × cliente do mês anterior.
// linhas: [{ vendedor, cliente, valor }]. Positivado = cliente com receita líquida > 0 no mês,
// somando todos os nomes do Qlik da mesma pessoa.
// → Map(id → { faturamento, positivados })
export function realizadosContrato(linhas, comissionados) {
  const dono = new Map();
  for (const c of comissionados) {
    if (c.ativo === false) continue;
    for (const n of c.nomes_qlik || []) dono.set(chaveNome(n), c.id);
  }
  const porId = new Map();
  for (const l of linhas || []) {
    const id = dono.get(chaveNome(l.vendedor));
    if (id == null) continue;
    const a = porId.get(id) || { fatC: 0, clientes: new Map() };
    const v = centavos(l.valor);
    a.fatC += v;
    const cli = String(l.cliente ?? '').trim();
    if (cli) a.clientes.set(cli, (a.clientes.get(cli) || 0) + v);
    porId.set(id, a);
  }
  const r = new Map();
  for (const [id, a] of porId) {
    r.set(id, { faturamento: reais(a.fatC), positivados: [...a.clientes.values()].filter(v => v > 0).length });
  }
  return r;
}

// ---------- Contrato de Resultado ----------
// meta/realizado → { atingiu, pct_faturamento, pct_positivacao, pct_premio, valor, motivo }
// Comparações em inteiros (centavos × percentual), sem arredondar o atingimento.
export function avaliarContrato({ meta_faturamento, realizado_faturamento, meta_positivacao, positivados }, p = PARAMETROS_PADRAO) {
  const metaC = centavos(meta_faturamento);
  const realC = centavos(realizado_faturamento);
  const metaP = Math.trunc(Number(meta_positivacao) || 0);
  const realP = Math.trunc(Number(positivados) || 0);
  const base = {
    meta_faturamento: reais(metaC), realizado_faturamento: reais(realC),
    meta_positivacao: metaP || null, positivados: realP,
    pct_faturamento: metaC > 0 ? realC / metaC * 100 : null,
    pct_positivacao: metaP > 0 ? realP / metaP * 100 : null,
  };
  if (metaC <= 0 || metaP <= 0) return { ...base, atingiu: false, pct_premio: 0, valor: 0, motivo: 'Sem meta cadastrada' };
  const gFat = Number(p.contrato_gatilho_faturamento);
  const gPos = Number(p.contrato_gatilho_positivacao);
  const okFat = realC * 100 >= metaC * gFat;
  const okPos = realP * 100 >= metaP * gPos;
  if (!okFat || !okPos) {
    const faltou = [!okFat && `faturamento abaixo de ${gFat}%`, !okPos && `positivação abaixo de ${gPos}%`].filter(Boolean).join(' e ');
    return { ...base, atingiu: false, pct_premio: 0, valor: 0, motivo: faltou.charAt(0).toUpperCase() + faltou.slice(1) };
  }
  const faixa2 = realC * 100 > metaC * Number(p.contrato_limite_faixa);
  const pctPremio = Number(faixa2 ? p.contrato_pct_faixa2 : p.contrato_pct_faixa1);
  return { ...base, atingiu: true, pct_premio: pctPremio, valor: reais(aplicar(reais(realC), pctPremio)), motivo: '' };
}

// Metas e realizado do Contrato de um PJ no mês.
// mesPj: linha da aba Contrato (comissao_mes_pj) ou null · realizado: do Qlik ({ faturamento, positivados }) ou null.
// Meta: a do mês; sem ela, a do cadastro. Realizado: o informado (com motivo) vence o do Qlik.
export function entradaContrato(c, mesPj = null, realizado = null) {
  const temMetaMes = mesPj && (mesPj.meta_faturamento != null || mesPj.meta_positivacao != null);
  const informado = !!mesPj && (mesPj.realizado_faturamento != null || mesPj.realizado_positivacao != null);
  const qlikFat = realizado?.faturamento ?? 0;
  const qlikPos = realizado?.positivados ?? 0;
  return {
    meta_faturamento: temMetaMes ? mesPj.meta_faturamento : c.meta_faturamento,
    meta_positivacao: temMetaMes ? mesPj.meta_positivacao : c.meta_positivacao,
    meta_origem: temMetaMes ? 'mes' : (c.meta_faturamento != null || c.meta_positivacao != null ? 'cadastro' : null),
    realizado_faturamento: informado && mesPj.realizado_faturamento != null ? mesPj.realizado_faturamento : qlikFat,
    positivados: informado && mesPj.realizado_positivacao != null ? mesPj.realizado_positivacao : qlikPos,
    qlik_faturamento: arred(qlikFat), qlik_positivados: qlikPos,
    informado, motivo_informado: informado ? mesPj.realizado_motivo || '' : '',
  };
}

// ---------- uma pessoa ----------
// c: cadastro · venda: { totalC, fareloC } · realizado: { faturamento, positivados } do Qlik (PJ)
// mesPj: metas, realizado informado e NF do PJ no mês · premiacoes / ajustes: [{ valor, descricao|motivo }] desta pessoa.
export function calcularLinha(c, { venda = null, realizado = null, mesPj = null, premiacoes = [], ajustes = [], mes, parametros = PARAMETROS_PADRAO } = {}) {
  const totalC = venda?.totalC ?? 0;
  const fareloC = venda?.fareloC ?? 0;
  const principalC = totalC - fareloC;
  const pctP = Number(c.pct_principal);
  const pctF = Number(c.pct_farelo);
  const comPrincipalC = aplicar(reais(principalC), pctP);
  const comFareloC = aplicar(reais(fareloC), pctF);
  const premC = premiacoes.reduce((s, x) => s + centavos(x.valor), 0);
  const ajC = ajustes.reduce((s, x) => s + centavos(x.valor), 0);

  let contrato = null;
  if (ehPJ(c)) {
    const e = entradaContrato(c, mesPj, realizado);
    contrato = {
      ...avaliarContrato(e, parametros),
      meta_origem: e.meta_origem, informado: e.informado, motivo_informado: e.motivo_informado,
      qlik_faturamento: e.qlik_faturamento, qlik_positivados: e.qlik_positivados,
    };
  }
  const contratoC = centavos(contrato?.valor || 0);
  const somaC = comPrincipalC + comFareloC + premC + contratoC;
  const acordo = acordoVigente(c, mes);
  const pisoAplicado = !!acordo && centavos(acordo.valor) > somaC;
  const antesDoAjusteC = pisoAplicado ? centavos(acordo.valor) : somaC;
  const brutoC = antesDoAjusteC + ajC;
  const pagarC = Math.max(0, brutoC);

  const alertas = [];
  if (!venda) alertas.push({ tipo: 'sem_venda', texto: 'Nenhuma venda no Qlik no período.' });
  if (principalC < 0 || fareloC < 0) alertas.push({ tipo: 'base_negativa', texto: 'Devoluções maiores que as vendas no período.' });
  if (brutoC < 0) alertas.push({ tipo: 'total_negativo', texto: `O total deu ${brlSimples(reais(brutoC))}; paga R$ 0,00 e o saldo não passa para o mês seguinte.` });

  return {
    id: c.id, nome: c.nome, regime: c.regime, equipe: c.equipe || '',
    nome_qlik: (c.nomes_qlik || [])[0] || '', nomes_qlik: venda?.nomes || [],
    pct_principal: pctP, pct_farelo: pctF,
    venda_total: reais(totalC), venda_farelo: reais(fareloC), venda_principal: reais(principalC),
    comissao_principal: reais(comPrincipalC), comissao_farelo: reais(comFareloC),
    comissao_total: reais(comPrincipalC + comFareloC),
    premiacoes: reais(premC), premiacoes_lista: premiacoes.map(x => ({ descricao: x.descricao || '', valor: arred(x.valor) })),
    ajustes_lista: ajustes.map(x => ({ motivo: x.motivo || x.descricao || '', valor: arred(x.valor) })),
    contrato, contrato_valor: reais(contratoC), nf_numero: mesPj?.nf_numero || '', nf_valor: mesPj?.nf_valor ?? null,
    soma: reais(somaC), acordo, piso_aplicado: pisoAplicado,
    ajustes: reais(ajC), valor_pagar: reais(pagarC), alertas,
  };
}

const brlSimples = n => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// ---------- o mês inteiro ----------
// Entrada:
//   mes: "2026-10" · comissionados (cadastro) · parametros
//   vendas: [{ vendedor, total, farelo }] do período de apuração
//   realizados: Map(id → { faturamento, positivados }) do mês anterior (ou contratoLinhas para calcular aqui)
//   premiacoes / ajustes: [{ comissionado_id, valor, descricao|motivo, ativo }] (desativadas ficam de fora)
//   mesPj: [{ comissionado_id, meta_*, realizado_*, realizado_motivo, nf_numero }] do mês (aba Contrato e NF)
// Saída: { mes, linhas (CLT primeiro, depois PJ, por nome), semCadastro, desativados, lancamentosOrfaos, ignorados, totais }
//   desativados: nomes do Qlik com venda que são de cadastros desativados (fora da comissão)
//   lancamentosOrfaos: premiações e ajustes ativos do mês de quem está desativado (fora do total)
//     [{ tipo: 'premiacao' | 'ajuste', id, comissionado_id, nome, valor, descricao }]
export function apurarMes({ mes, comissionados = [], parametros = PARAMETROS_PADRAO, vendas = [], realizados = null, contratoLinhas = null, premiacoes = [], ajustes = [], mesPj = [] }) {
  const ativos = comissionados.filter(c => c.ativo !== false);
  const { porId, semCadastro, desativados, ignorados } = juntarVendas(vendas, comissionados, parametros.nomes_ignorados);
  const real = realizados || realizadosContrato(contratoLinhas || [], ativos);
  const doId = (lista, id) => lista.filter(x => String(x.comissionado_id) === String(id) && x.ativo !== false && (!x.mes || x.mes === mes));
  const lancamentosOrfaos = comissionados.filter(c => c.ativo === false).flatMap(c => [
    ...doId(premiacoes, c.id).map(x => ({ tipo: 'premiacao', id: x.id, comissionado_id: c.id, nome: c.nome, valor: arred(x.valor), descricao: x.descricao || '' })),
    ...doId(ajustes, c.id).map(x => ({ tipo: 'ajuste', id: x.id, comissionado_id: c.id, nome: c.nome, valor: arred(x.valor), descricao: x.motivo || x.descricao || '' })),
  ]);
  const ordem = c => (ehPJ(c) ? 1 : 0);
  const linhas = ativos
    .slice()
    .sort((a, b) => ordem(a) - ordem(b) || String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' }))
    .map(c => calcularLinha(c, {
      venda: porId.get(c.id) || null,
      realizado: real.get(c.id) || null,
      premiacoes: doId(premiacoes, c.id), ajustes: doId(ajustes, c.id),
      mesPj: doId(mesPj, c.id)[0] || null,
      mes, parametros,
    }));
  const somar = (ls, k) => reais(ls.reduce((s, l) => s + centavos(l[k]), 0));
  const grupo = ls => ({
    pessoas: ls.length,
    venda_total: somar(ls, 'venda_total'), venda_farelo: somar(ls, 'venda_farelo'), venda_principal: somar(ls, 'venda_principal'),
    comissao_total: somar(ls, 'comissao_total'), premiacoes: somar(ls, 'premiacoes'), contrato: somar(ls, 'contrato_valor'),
    ajustes: somar(ls, 'ajustes'), valor_pagar: somar(ls, 'valor_pagar'),
  });
  const clt = linhas.filter(l => l.regime !== 'PJ');
  const pj = linhas.filter(l => l.regime === 'PJ');
  return {
    mes, periodo: periodoApuracao(mes, parametros.dia_corte), contrato_periodo: mesAnteriorFechado(mes),
    linhas, semCadastro, desativados, lancamentosOrfaos, ignorados,
    totais: { clt: grupo(clt), pj: grupo(pj), geral: grupo(linhas) },
  };
}

// ---------- conferência do cadastro (antes de salvar) ----------
// → { campo: mensagem }. Vazio = ok. outros: os demais comissionados (nome do Qlik não pode repetir).
export function errosComissionado(d, outros = []) {
  const e = {};
  const nome = String(d.nome ?? '').trim();
  if (nome.length < 2 || nome.length > 80) e.nome = 'Informe o nome (2 a 80 letras).';
  if (!REGIMES.includes(d.regime)) e.regime = 'Escolha o regime.';
  for (const [k, rot] of [['pct_principal', '% principal'], ['pct_farelo', '% Farelo']]) {
    const v = Number(d[k]);
    if (d[k] === '' || d[k] == null || !Number.isFinite(v) || v < 0 || v > 20) e[k] = `${rot}: de 0 a 20.`;
  }
  const nomes = (d.nomes_qlik || []).map(nomeQlik).filter(Boolean);
  if (!nomes.length) e.nomes_qlik = 'Informe pelo menos um nome como aparece no Qlik (Vendedor B2B).';
  if (new Set(nomes.map(chaveNome)).size !== nomes.length) e.nomes_qlik = 'Há nomes do Qlik repetidos.';
  const usados = new Map();
  for (const o of outros) if (o.ativo !== false && String(o.id) !== String(d.id)) for (const n of o.nomes_qlik || []) usados.set(chaveNome(n), o.nome);
  const repetido = nomes.find(n => usados.has(chaveNome(n)));
  if (repetido && d.ativo !== false) e.nomes_qlik = `"${repetido}" já está ligado a ${usados.get(chaveNome(repetido))}.`;
  // Nome de quem foi desativado: reativar, para não ficar a mesma pessoa em dois cadastros.
  const deInativo = new Map();
  for (const o of outros) if (o.ativo === false && String(o.id) !== String(d.id)) for (const n of o.nomes_qlik || []) deInativo.set(chaveNome(n), o.nome);
  const deDesativado = nomes.find(n => deInativo.has(chaveNome(n)));
  if (!e.nomes_qlik && deDesativado && d.ativo !== false) e.nomes_qlik = `"${deDesativado}" é de ${deInativo.get(chaveNome(deDesativado))}, que está desativado. Reative o cadastro em vez de criar outro.`;
  if (d.regime === 'PJ') {
    if (d.acordo_minimo) e.acordo_minimo = 'Acordo mínimo é só para CLT.';
    const mf = d.meta_faturamento, mp = d.meta_positivacao;
    if (mf != null && mf !== '' && !(Number(mf) >= 0 && Number(mf) <= 100000000)) e.meta_faturamento = 'Meta de faturamento inválida.';
    if (mp != null && mp !== '' && !(Number.isInteger(Number(mp)) && Number(mp) >= 0 && Number(mp) <= 100000)) e.meta_positivacao = 'Meta de positivação: número inteiro.';
  } else {
    const v = d.acordo_minimo;
    if (v != null && v !== '' && Number(v) > 0) {
      if (!(Number(v) <= 1000000)) e.acordo_minimo = 'Acordo mínimo inválido.';
      if (!d.acordo_inicio) e.acordo_inicio = 'Informe o início da vigência.';
      if (d.acordo_fim && d.acordo_inicio && d.acordo_fim < d.acordo_inicio) e.acordo_fim = 'O fim está antes do início.';
    }
  }
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(d.email).trim())) e.email = 'Digite um e-mail válido.';
  return e;
}
