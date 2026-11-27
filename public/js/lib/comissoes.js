// ============================================================
//  COMISSÕES — regras puras do cálculo (sem navegador, sem banco).
//  Testes: tests/comissoes.test.mjs. Quem chama: dados/comissoes.js e telas/comissoes.js.
//
//  Regras (revisão nov/2026, decididas com a gestão):
//   - Base: receita menos devolução no Qlik (atacado, regular), do dia seguinte ao
//     corte do mês anterior até o dia do corte (padrão 26 a 25).
//   - Fornecedores (migração 21): grupo principal e secundários. O principal é "todos menos os
//     secundários" (padrão) ou "só estes" (lista); venda de fornecedor fora das listas vai para
//     "Outros fornecedores". Cada secundário (hoje: Farelo 6610) tem % por regime e pode ter % próprio
//     por pessoa (exceção). Sem a tabela de fornecedores, o Farelo vem dos Parâmetros (como antes).
//   - Comissão = principal × % principal do cadastro + cada secundário × % dele + Outros × % de Outros.
//     Nunca 0% em silêncio: falta de % vira alerta na linha.
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

// ---------- fornecedores: principal, secundários e "Outros" ----------
const pctOuNulo = v => (v === null || v === undefined || v === '' ? null : Number(v));
export const ROTULO_REGIME_CURTO = Object.freeze({ CLT: 'CLT', TELEVENDAS: 'Televendas', PJ: 'PJ' });

// O Farelo de antes da migração 21: código e % dos Parâmetros. Vale quando não há tabela de fornecedores.
export function fornecedoresLegado(p = PARAMETROS_PADRAO) {
  return [{ id: 'farelo', codigo: String(p.cod_farelo ?? PARAMETROS_PADRAO.cod_farelo), nome: 'Farelo', grupo: 'secundario',
    pct_clt: Number(p.pct_clt_farelo), pct_televendas: Number(p.pct_televendas_farelo), pct_pj: Number(p.pct_pj_farelo), vale_de: '2000-01', ativo: true }];
}

// Regras do mês: fornecedores ativos com vale_de <= mes. fornecedores = null → o Farelo dos Parâmetros.
// → { principalModo, principal: Set<codigo>, secundarios: [{ id, codigo, nome, pct: { CLT, TELEVENDAS, PJ }, vale_de }],
//     outros: { CLT, TELEVENDAS, PJ } | null, codFarelo }
export function regrasFornecedores(parametros = PARAMETROS_PADRAO, fornecedores = null, mes = '9999-12') {
  const lista = (fornecedores ?? fornecedoresLegado(parametros))
    .filter(f => f.ativo !== false && String(f.vale_de || '2000-01') <= String(mes));
  const principalModo = parametros.principal_modo === 'lista' ? 'lista' : 'todos';
  return {
    principalModo,
    principal: new Set(lista.filter(f => f.grupo === 'principal').map(f => String(f.codigo))),
    secundarios: lista.filter(f => f.grupo === 'secundario').map(f => ({
      id: f.id, codigo: String(f.codigo), nome: f.nome, vale_de: f.vale_de || '2000-01',
      pct: { CLT: pctOuNulo(f.pct_clt), TELEVENDAS: pctOuNulo(f.pct_televendas), PJ: pctOuNulo(f.pct_pj) },
    })),
    outros: principalModo === 'lista'
      ? { CLT: pctOuNulo(parametros.pct_outros_clt), TELEVENDAS: pctOuNulo(parametros.pct_outros_televendas), PJ: pctOuNulo(parametros.pct_outros_pj) }
      : null,
    codFarelo: String(parametros.cod_farelo ?? PARAMETROS_PADRAO.cod_farelo),
  };
}
// As regras como vão para a cópia do fechamento (JSON, sem Set).
export const regrasParaCopia = r => ({ ...r, principal: [...r.principal] });
export const regrasDaCopia = r => ({ ...r, principal: new Set(r.principal || []) });

// Consulta antiga (formato 1: { vendedor, total, farelo }) vira o formato 2 na entrada:
// o principal é total − farelo e o Farelo, o secundário de código codFarelo.
export function vendasFormato2(vendas, codFarelo = PARAMETROS_PADRAO.cod_farelo) {
  return (vendas || []).flatMap(v => ('cod_fornecedor' in v ? [v] : [
    { vendedor: v.vendedor, cod_fornecedor: null, fornecedor: '', total: reais(centavos(v.total) - centavos(v.farelo)), principal: true },
    ...(centavos(v.farelo) ? [{ vendedor: v.vendedor, cod_fornecedor: String(codFarelo), fornecedor: 'Farelo', total: arred(v.farelo) }] : []),
  ]));
}

// Separa as vendas de cada vendedor em principal, secundários e "Outros".
// → [{ vendedor, principalC, secundarios: { codigo: centavos }, outrosC, totalC }]
export function classificarVendas(vendas, regras) {
  const sec = new Set(regras.secundarios.map(x => x.codigo));
  const por = new Map();
  for (const v of vendasFormato2(vendas, regras.codFarelo)) {
    const k = String(v.vendedor ?? '');
    const a = por.get(k) || por.set(k, { vendedor: v.vendedor, principalC: 0, secundarios: {}, outrosC: 0, totalC: 0 }).get(k);
    const c = centavos(v.total);
    const cod = v.cod_fornecedor == null ? null : String(v.cod_fornecedor);
    a.totalC += c;
    if (cod != null && sec.has(cod)) a.secundarios[cod] = (a.secundarios[cod] || 0) + c;
    else if (v.principal || regras.principalModo === 'todos' || regras.principal.has(cod)) a.principalC += c;
    else a.outrosC += c;
  }
  return [...por.values()];
}

// % de um secundário para uma pessoa: a exceção dela, senão o % do regime (null = sem regra).
// excecoes: [{ comissionado_id, codigo, pct }]
export function pctSecundario(c, sec, excecoes = []) {
  const e = (excecoes || []).find(x => String(x.comissionado_id) === String(c.id) && String(x.codigo) === sec.codigo);
  if (e && e.pct != null && e.pct !== '') return Number(e.pct);
  const p = sec.pct?.[c.regime];
  return p == null ? null : Number(p);
}

// Exceções de antes da 21: o pct_farelo de cada pessoa vale para o Farelo.
export const excecoesLegado = (comissionados, codFarelo = PARAMETROS_PADRAO.cod_farelo) => comissionados
  .filter(c => c.pct_farelo != null && c.pct_farelo !== '')
  .map(c => ({ comissionado_id: c.id, codigo: String(codFarelo), pct: Number(c.pct_farelo) }));

// ---------- casamento das vendas do Qlik com o cadastro ----------
// vendas: formato 2 [{ vendedor, cod_fornecedor, fornecedor, total }] ou o antigo [{ vendedor, total, farelo }].
// Nome de cadastro desativado não entra na comissão nem em "Novos no Qlik": vai para `desativados`
// (senão "Completar cadastro" criava um segundo cadastro para a mesma pessoa).
// → { porId: Map(id → { principalC, secundarios, outrosC, totalC, nomes:[] }), semCadastro: [{ vendedor, total, farelo }],
//     desativados: [{ id, nome, vendedor, total, farelo }], ignorados: [...] }   (farelo: a venda do secundário Farelo)
export function juntarVendas(vendas, comissionados, nomesIgnorados = [], regras = regrasFornecedores()) {
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
  for (const v of classificarVendas(vendas, regras)) {
    const k = chaveNome(v.vendedor);
    const id = dono.get(k)?.id;
    if (id == null) {
      const linha = { vendedor: v.vendedor, total: reais(v.totalC), farelo: reais(v.secundarios[regras.codFarelo] || 0) };
      const c = inativo.get(k);
      if (c) desativados.push({ id: c.id, nome: c.nome, ...linha });
      else (ignorar.has(k) ? ignorados : semCadastro).push(linha);
      continue;
    }
    const a = porId.get(id) || { principalC: 0, secundarios: {}, outrosC: 0, totalC: 0, nomes: [] };
    a.principalC += v.principalC;
    a.outrosC += v.outrosC;
    a.totalC += v.totalC;
    for (const [cod, c] of Object.entries(v.secundarios)) a.secundarios[cod] = (a.secundarios[cod] || 0) + c;
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
// Meta: a do mês; sem ela, a do cadastro, campo a campo (o mês pode trazer só o faturamento).
// meta_origem: 'mes' (tudo do mês) · 'misto' (parte do mês, parte do cadastro) · 'cadastro' · null (sem meta).
// Realizado: o informado (com motivo) vence o do Qlik.
export function entradaContrato(c, mesPj = null, realizado = null) {
  const doMes = k => mesPj?.[k] != null;
  const origens = ['meta_faturamento', 'meta_positivacao']
    .map(k => (doMes(k) ? 'mes' : c[k] != null ? 'cadastro' : null)).filter(Boolean);
  const informado = !!mesPj && (mesPj.realizado_faturamento != null || mesPj.realizado_positivacao != null);
  const qlikFat = realizado?.faturamento ?? 0;
  const qlikPos = realizado?.positivados ?? 0;
  return {
    meta_faturamento: mesPj?.meta_faturamento ?? c.meta_faturamento,
    meta_positivacao: mesPj?.meta_positivacao ?? c.meta_positivacao,
    meta_origem: !origens.length ? null : origens.every(o => o === 'mes') ? 'mes' : origens.every(o => o === 'cadastro') ? 'cadastro' : 'misto',
    realizado_faturamento: informado && mesPj.realizado_faturamento != null ? mesPj.realizado_faturamento : qlikFat,
    positivados: informado && mesPj.realizado_positivacao != null ? mesPj.realizado_positivacao : qlikPos,
    qlik_faturamento: arred(qlikFat), qlik_positivados: qlikPos,
    informado, motivo_informado: informado ? mesPj.realizado_motivo || '' : '',
  };
}

// ---------- uma pessoa ----------
// c: cadastro · venda: { principalC, secundarios, outrosC, totalC } (ou o antigo { totalC, fareloC })
// regras: regrasFornecedores() · excecoes: [{ comissionado_id, codigo, pct }] (null = o pct_farelo do cadastro vale para o Farelo)
// realizado: { faturamento, positivados } do Qlik (PJ) · mesPj: metas, realizado informado e NF do PJ no mês
// premiacoes / ajustes: [{ valor, descricao|motivo }] desta pessoa.
export function calcularLinha(c, { venda = null, realizado = null, mesPj = null, premiacoes = [], ajustes = [], mes, parametros = PARAMETROS_PADRAO,
  regras = regrasFornecedores(parametros), excecoes = null } = {}) {
  const v = venda && 'fareloC' in venda
    ? { principalC: venda.totalC - venda.fareloC, secundarios: { [regras.codFarelo]: venda.fareloC }, outrosC: 0, totalC: venda.totalC, nomes: venda.nomes }
    : venda;
  const totalC = v?.totalC ?? 0;
  const principalC = v?.principalC ?? 0;
  const outrosC = v?.outrosC ?? 0;
  const exc = excecoes ?? excecoesLegado([c], regras.codFarelo);
  const regime = ROTULO_REGIME_CURTO[c.regime] || c.regime;
  const alertas = [];
  const pctP = Number(c.pct_principal);
  const comPrincipalC = aplicar(reais(principalC), pctP);

  const secundarios = regras.secundarios.map(sec => {
    const vendaC = v?.secundarios?.[sec.codigo] || 0;
    const pct = pctSecundario(c, sec, exc);
    if (vendaC && pct == null) alertas.push({ tipo: 'sem_pct', texto: `Fornecedor ${sec.nome} sem % para ${regime}: a venda dele ficou sem comissão.` });
    const comC = aplicar(reais(vendaC), pct ?? 0);
    return { codigo: sec.codigo, nome: sec.nome, venda: reais(vendaC), pct, comissao: reais(comC), vendaC, comC };
  });
  const pctOutros = regras.outros ? regras.outros[c.regime] ?? null : null;
  if (outrosC && pctOutros == null) alertas.push({ tipo: 'sem_pct', texto: `Outros fornecedores sem % para ${regime}: a venda deles ficou sem comissão.` });
  const comOutrosC = aplicar(reais(outrosC), pctOutros ?? 0);
  const comSecC = secundarios.reduce((s, x) => s + x.comC, 0);
  const comissaoC = comPrincipalC + comSecC + comOutrosC;
  // Farelo: os campos antigos (Excel, recibo e Histórico ainda os leem) são a soma do secundário Farelo.
  const farelo = secundarios.find(x => x.codigo === regras.codFarelo);

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
  const somaC = comissaoC + premC + contratoC;
  const acordo = acordoVigente(c, mes);
  const pisoAplicado = !!acordo && centavos(acordo.valor) > somaC;
  const antesDoAjusteC = pisoAplicado ? centavos(acordo.valor) : somaC;
  const brutoC = antesDoAjusteC + ajC;
  const pagarC = Math.max(0, brutoC);

  if (!venda) alertas.unshift({ tipo: 'sem_venda', texto: 'Nenhuma venda no Qlik no período.' });
  if (principalC < 0 || outrosC < 0 || secundarios.some(x => x.vendaC < 0)) alertas.push({ tipo: 'base_negativa', texto: 'Devoluções maiores que as vendas no período.' });
  if (brutoC < 0) alertas.push({ tipo: 'total_negativo', texto: `O total deu ${brlSimples(reais(brutoC))}; paga R$ 0,00 e o saldo não passa para o mês seguinte.` });

  return {
    id: c.id, nome: c.nome, regime: c.regime, equipe: c.equipe || '',
    nome_qlik: (c.nomes_qlik || [])[0] || '', nomes_qlik: v?.nomes || [],
    pct_principal: pctP, pct_farelo: farelo ? farelo.pct ?? 0 : 0,
    venda_total: reais(totalC), venda_principal: reais(principalC),
    secundarios: secundarios.map(({ vendaC, comC, ...x }) => x),
    venda_outros: reais(outrosC), pct_outros: pctOutros, comissao_outros: reais(comOutrosC),
    venda_farelo: farelo ? farelo.venda : 0, comissao_farelo: farelo ? farelo.comissao : 0,
    comissao_principal: reais(comPrincipalC), comissao_total: reais(comissaoC),
    premiacoes: reais(premC), premiacoes_lista: premiacoes.map(x => ({ descricao: x.descricao || '', valor: arred(x.valor) })),
    ajustes_lista: ajustes.map(x => ({ motivo: x.motivo || x.descricao || '', valor: arred(x.valor) })),
    contrato, contrato_valor: reais(contratoC), nf_numero: mesPj?.nf_numero || '', nf_valor: mesPj?.nf_valor ?? null,
    soma: reais(somaC), acordo, piso_aplicado: pisoAplicado,
    ajustes: reais(ajC), valor_pagar: reais(pagarC), alertas,
  };
}

// Secundários de uma linha, inclusive das cópias de meses fechados antes da 3.6 (só com o Farelo).
export function secundariosDaLinha(l) {
  if (Array.isArray(l.secundarios)) return l.secundarios;
  return l.venda_farelo || l.comissao_farelo
    ? [{ codigo: PARAMETROS_PADRAO.cod_farelo, nome: 'Farelo', venda: l.venda_farelo || 0, pct: l.pct_farelo ?? null, comissao: l.comissao_farelo || 0 }]
    : [];
}

const brlSimples = n => (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// ---------- o mês inteiro ----------
// Entrada:
//   mes: "2026-10" · comissionados (cadastro) · parametros
//   vendas: do período de apuração, formato 2 [{ vendedor, cod_fornecedor, fornecedor, total }] ou o antigo
//   fornecedores: linhas de comissao_fornecedores (null = o Farelo dos Parâmetros) · excecoes: [{ comissionado_id, codigo, pct }]
//   realizados: Map(id → { faturamento, positivados }) do mês anterior (ou contratoLinhas para calcular aqui)
//   premiacoes / ajustes: [{ comissionado_id, valor, descricao|motivo, ativo }] (desativadas ficam de fora)
//   mesPj: [{ comissionado_id, meta_*, realizado_*, realizado_motivo, nf_numero }] do mês (aba Contrato e NF)
// Saída: { mes, linhas (CLT primeiro, depois PJ, por nome), semCadastro, desativados, lancamentosOrfaos, ignorados, totais,
//          regras (as regras de fornecedor usadas, para a cópia do fechamento) }
//   desativados: nomes do Qlik com venda que são de cadastros desativados (fora da comissão)
//   lancamentosOrfaos: premiações e ajustes ativos do mês de quem está desativado (fora do total)
//     [{ tipo: 'premiacao' | 'ajuste', id, comissionado_id, nome, valor, descricao }]
export function apurarMes({ mes, comissionados = [], parametros = PARAMETROS_PADRAO, vendas = [], realizados = null, contratoLinhas = null, premiacoes = [], ajustes = [], mesPj = [],
  fornecedores = null, excecoes = null, regras: regrasProntas = null }) {
  const ativos = comissionados.filter(c => c.ativo !== false);
  const regras = regrasProntas || regrasFornecedores(parametros, fornecedores, mes);
  const { porId, semCadastro, desativados, ignorados } = juntarVendas(vendas, comissionados, parametros.nomes_ignorados, regras);
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
      mes, parametros, regras, excecoes: excecoes ?? excecoesLegado([c], regras.codFarelo),
    }));
  const somar = (ls, k) => reais(ls.reduce((s, l) => s + centavos(l[k]), 0));
  const grupo = ls => ({
    pessoas: ls.length,
    venda_total: somar(ls, 'venda_total'), venda_farelo: somar(ls, 'venda_farelo'), venda_principal: somar(ls, 'venda_principal'),
    venda_outros: somar(ls, 'venda_outros'),
    comissao_total: somar(ls, 'comissao_total'), premiacoes: somar(ls, 'premiacoes'), contrato: somar(ls, 'contrato_valor'),
    ajustes: somar(ls, 'ajustes'), valor_pagar: somar(ls, 'valor_pagar'),
  });
  const clt = linhas.filter(l => l.regime !== 'PJ');
  const pj = linhas.filter(l => l.regime === 'PJ');
  return {
    mes, periodo: periodoApuracao(mes, parametros.dia_corte), contrato_periodo: mesAnteriorFechado(mes),
    linhas, semCadastro, desativados, lancamentosOrfaos, ignorados,
    totais: { clt: grupo(clt), pj: grupo(pj), geral: grupo(linhas) },
    regras: regrasParaCopia(regras),
  };
}

// ---------- mês reaberto ----------
// Cadastro de um mês reaberto: o da cópia do fechamento para quem estava nela (o %, o acordo e o
// regime daquele mês), completado com o cadastro atual só para quem não estava (gente nova).
// copia: dados.cadastro do fechamento · atual: cadastro de hoje.
export function cadastroDaCopia(copia, atual = []) {
  if (!Array.isArray(copia)) return atual;
  const ids = new Set(copia.map(c => String(c.id)));
  return [...copia, ...atual.filter(c => !ids.has(String(c.id)))];
}

// ---------- conferência do cadastro (antes de salvar) ----------
// → { campo: mensagem }. Vazio = ok. outros: os demais comissionados (nome do Qlik não pode repetir).
export function errosComissionado(d, outros = []) {
  const e = {};
  const nome = String(d.nome ?? '').trim();
  if (nome.length < 2 || nome.length > 80) e.nome = 'Informe o nome (2 a 80 letras).';
  if (!REGIMES.includes(d.regime)) e.regime = 'Escolha o regime.';
  for (const [k, rot] of [['pct_principal', '% principal'], ['pct_farelo', '% Farelo']]) {
    if (k === 'pct_farelo' && !(k in d)) continue;   // obsoleto desde a 21: o % do Farelo é por secundário
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
