// Regras puras (sem DOM e sem rede), testadas em tests/regras.test.mjs. O banco aplica as mesmas regras;
// aqui servem para avisar antes de gravar.

export const STATUS = Object.freeze({
  PENDENTE: 'Pendente',
  APROVADA: 'Aprovada',
  REPROVADA: 'Reprovada',
});

export const PAPEL = Object.freeze({
  APROVADOR: 'aprovador',
  COORDENADOR: 'coordenador',
});
// Como o papel aparece na tela. No banco continua "aprovador" / "coordenador".
export const ROTULO_PAPEL = Object.freeze({ aprovador: 'Administrador', coordenador: 'Usuário' });
export const rotuloPapel = papel => ROTULO_PAPEL[papel] || 'Usuário';

// Fuso das datas do app (Maranhão, UTC-3). O banco usa o mesmo em registrar_decisao().
export const FUSO = 'America/Fortaleza';

// Limites de valor e de texto. Os números são os mesmos das constraints
// campanhas_valores_faixa e campanhas_textos_tamanho (sql/schema.sql);
// tests/regras.test.mjs confere que os dois lados batem.
export const LIMITES = Object.freeze({
  balconistas_por_empresa: 2,   // contando os desativados (migração 12)
  compras_devolucoes: 10000000, // devoluções da consulta do Qlik (migração 13, campanhas_devolucoes_faixa)
  compras_devolvidas: 50,       // notas de provável devolução gravadas na campanha (idem)
  rebate_pct: 100,
  meta: 1000000000,
  investimento_lynkz: 10000000,
  investimento_industria: 10000000,
  rebate_teto: 10000000,
  textos: Object.freeze({
    cliente: 200, laboratorio: 120, campanha: 200, tipo: 120, mecanica: 2000, observacoes: 2000,
    motivo: 1000, forma_pagamento: 60, tipo_meta: 60, rebate_base: 120, rebate_gatilho: 120,
    swile_nome_completo: 150, swile_email: 254,
  }),
});

// A régua de custo vai de 0% a 25% da meta; acima disso o marcador fica no fim.
export const ESCALA_REGUA = 0.25;

// ---------- texto ----------
export const soDigitos = s => String(s ?? '').replace(/\D/g, '');

// Minúsculas e sem acento: "Biogénesis" → "biogenesis".
export const normaliza = s => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim();

// ---------- fornecedores (coluna "laboratorio": "Ouro Fino, Avert"; nenhum nome da lista tem vírgula) ----------
export const SEPARADOR_LABORATORIOS = ', ';
export const listaLaboratorios = texto => [...new Set(String(texto ?? '').split(',').map(s => s.trim()).filter(Boolean))];
export const juntarLaboratorios = lista => listaLaboratorios((lista || []).join(',')).join(SEPARADOR_LABORATORIOS);

// ---------- marcas da consulta do Qlik ----------
// Gravadas em compras_marca separadas por "; ". O Worker recusa ";" em marca, então o separador nunca está num nome.
export const MAX_MARCAS = 10;
export const SEPARADOR_MARCAS = '; ';
export const listaMarcas = texto => (Array.isArray(texto) ? texto : String(texto ?? '').split(';'))
  .map(s => String(s).trim()).filter((s, i, a) => s && a.indexOf(s) === i);
export const juntarMarcas = lista => listaMarcas(lista).join(SEPARADOR_MARCAS);
// Para mostrar: "WELLPET" · "WELLPET e PROTEÇÃO" · "WELLPET, PROTEÇÃO e GOLDEN"
export function textoMarcas(texto) {
  const l = listaMarcas(texto);
  return l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}` : l[0] || '';
}

// Busca sem acento: todas as palavras do termo precisam aparecer no texto.
export function contem(termo, texto) {
  const palavras = normaliza(termo).split(/\s+/).filter(Boolean);
  if (!palavras.length) return true;
  const alvo = normaliza(texto);
  return palavras.every(p => alvo.includes(p));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailValido = s => EMAIL_RE.test(String(s ?? '').trim());

// Nome e sobrenome (duas palavras ou mais).
export const nomeCompleto = s => String(s ?? '').trim().split(/\s+/).filter(Boolean).length >= 2;

// ---------- números ----------
const fmt2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export const brl  = n => fmt2.format(Number(n) || 0);
export const brl0 = n => fmt0.format(Number(n) || 0);

// "−R$ 300,00 (1 nota)" — devoluções no período da consulta do Qlik. O total já desconta;
// nNotas = notas de provável devolução (valor que fecha com o devolvido). Zero: o Qlik não diz qual foi.
export function textoDevolucoes(valor, nNotas) {
  const quais = nNotas > 0 ? `${nNotas} ${nNotas === 1 ? 'nota' : 'notas'}` : 'nota de origem não identificada no Qlik';
  return `−R$ ${brl(valor)} (${quais})`;
}

// Fração → percentual pt-BR: 0.079 → "7,9%".
export function pct(p, casas = 1) {
  if (p == null || !Number.isFinite(Number(p))) return '—';
  return (Number(p) * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
}

// Lê valor digitado: "1.234,56" → 1234.56 · "2.000" → 2000 · "1234.56" → 1234.56.
// Vazio vira 0; texto que não é número vira NaN.
export function lerValor(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? '').replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');      // vírgula decimal, ponto de milhar
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');                         // só pontos de milhar
  }
  if (!/^-?\d*\.?\d*$/.test(s) || s === '.' || s === '-') return NaN;
  return Number(s);
}

// Número → texto do campo de valor: 1234.5 → "1.234,50". Vazio para null/''.
export function valorCampo(n) {
  if (n === null || n === undefined || n === '') return '';
  const x = Number(n);
  return Number.isFinite(x) ? brl(x) : '';
}

// ---------- a conta do custo (fonte única) ----------
// Custo real = investimento LYNKZ + investimento indústria + rebate estimado
// (devido se o cliente bater a meta). Rebate = meta × %, limitado pelo teto.
export function calc(c) {
  const invL = +c.investimento_lynkz || 0;
  const invI = +c.investimento_industria || 0;
  const inv = invL + invI;
  const meta = +c.meta || 0, p = +c.rebate_pct || 0, teto = +c.rebate_teto || 0;
  let reb = (meta > 0 && p > 0) ? meta * (p / 100) : 0;
  const limitado = teto > 0 && reb > teto;
  if (limitado) reb = teto;
  const total = inv + reb;
  return { invL, invI, inv, meta, reb, total, limitado, pctMeta: meta > 0 ? total / meta : null };
}

// ---------- divisão da meta e do investimento da indústria por fornecedor ----------
// campanhas.fornecedores = [{ nome, meta, investimento_industria }]; meta e investimento_industria guardam a soma.
export const MAX_FORNECEDORES = 5;
const centavos = n => Math.round((Number(n) || 0) * 100);

// A divisão gravada na campanha (ou montada na tela), com números; null se a campanha não divide.
export function lerDivisao(c) {
  const f = c?.fornecedores;
  if (!Array.isArray(f) || f.length < 2) return null;
  return f.map(x => ({ nome: String(x?.nome ?? ''), meta: +x?.meta || 0, investimento_industria: +x?.investimento_industria || 0 }));
}

// Totais da divisão, em reais, somados em centavos (0,1 + 0,2 = 0,3).
export function somaDivisao(linhas) {
  return {
    meta: (linhas || []).reduce((s, l) => s + centavos(l.meta), 0) / 100,
    investimento_industria: (linhas || []).reduce((s, l) => s + centavos(l.investimento_industria), 0) / 100,
  };
}

// Parte de cada fornecedor: peso = meta dele ÷ meta total (sem meta, partes iguais); rebate = rebate total × peso,
// o que reparte também o teto. O último leva o resto dos centavos, então as partes fecham com o total.
export function partilha(c) {
  const linhas = lerDivisao(c);
  if (!linhas) return null;
  const k = calc(c);
  const metaTotal = linhas.reduce((s, l) => s + centavos(l.meta), 0);
  const rebTotal = centavos(k.reb);
  let usado = 0;
  return linhas.map((l, i) => {
    const peso = metaTotal > 0 ? centavos(l.meta) / metaTotal : 1 / linhas.length;
    const reb = i === linhas.length - 1 ? rebTotal - usado : Math.round(rebTotal * peso);
    usado += reb;
    return { ...l, peso, rebate: reb / 100 };
  });
}

// Erros da divisão na tela: { [índice]: { meta?, investimento_industria? } } e geral (texto ou '').
export function errosDivisao(linhas) {
  const porLinha = {};
  let geral = '';
  (linhas || []).forEach((l, i) => {
    const e = {};
    for (const [chave, limite] of [['meta', LIMITES.meta], ['investimento_industria', LIMITES.investimento_industria]]) {
      const v = l[chave];
      if (!Number.isFinite(v) || v < 0) e[chave] = 'Valor inválido. Use só números, como 1.500,00.';
      else if (v > limite) e[chave] = `Passou do limite de R$ ${brl(limite)}.`;
    }
    if (Object.keys(e).length) porLinha[i] = e;
  });
  if (!Object.keys(porLinha).length) {
    const t = somaDivisao(linhas);
    if (t.meta > LIMITES.meta) geral = `A soma das metas passou do limite de R$ ${brl(LIMITES.meta)}.`;
    else if (t.investimento_industria > LIMITES.investimento_industria) geral = `A soma da indústria passou do limite de R$ ${brl(LIMITES.investimento_industria)}.`;
  }
  return { porLinha, geral };
}

// Faixa do custo sobre a meta. faixas = { verde: 0.08, amarela: 0.15 } (config.js).
export function banda(p, faixas) {
  if (p == null) return { nivel: 'nenhum', txt: 'sem meta informada' };
  if (p <= faixas.verde) return { nivel: 'verde', txt: 'dentro do padrão' };
  if (p <= faixas.amarela) return { nivel: 'ambar', txt: 'atenção' };
  return { nivel: 'vermelho', txt: 'acima do padrão' };
}

// Posição (0–100) de um percentual no trilho da régua.
export const posRegua = p => (p == null ? 0 : Math.max(0, Math.min(p / ESCALA_REGUA, 1)) * 100);

// ---------- documentos ----------
// CPF: dígitos verificadores (módulo 11) e sem sequência repetida.
// Mesma regra de cpf_valido() no banco.
export function cpfValido(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const n = d.split('').map(Number);
  const dv = fator => {
    let soma = 0, peso = fator;
    for (let i = 0; i < fator - 1; i++) soma += n[i] * peso--;
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(10) === n[9] && dv(11) === n[10];
}

// CNPJ: dígitos verificadores (módulo 11, pesos 5..2/9..2) e sem sequência repetida.
export function cnpjValido(cnpj) {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const n = d.split('').map(Number);
  const dv = tam => {
    let soma = 0, peso = tam - 7;
    for (let i = 0; i < tam; i++) { soma += n[i] * peso--; if (peso < 2) peso = 9; }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(12) === n[12] && dv(13) === n[13];
}

export function maskCPF(v) {
  const d = soDigitos(v).slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function maskCNPJ(v) {
  const d = soDigitos(v).slice(0, 14);
  return d.replace(/^(\d{2})(\d)/, '$1.$2')
          .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
          .replace(/\.(\d{3})(\d)/, '.$1/$2')
          .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function maskTelefone(v) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length > 10) return d.replace(/(\d{2})(\d{5})(\d{0,4})/, (m, a, b, c) => `(${a}) ${b}${c ? '-' + c : ''}`);
  if (d.length > 6)  return d.replace(/(\d{2})(\d{4})(\d{0,4})/, (m, a, b, c) => `(${a}) ${b}${c ? '-' + c : ''}`);
  if (d.length > 2)  return d.replace(/(\d{2})(\d{0,4})/, (m, a, b) => `(${a}) ${b}`);
  if (d.length > 0)  return `(${d}`;
  return '';
}

export const telefoneValido = v => /^\d{10,11}$/.test(soDigitos(v));

// ---------- datas (sempre no fuso do app) ----------
const fmtCivil = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });

// "AAAA-MM-DD" no fuso do app. Data pura ("2026-11-18") volta igual;
// instante ("2026-11-19T01:30:00Z") é convertido para o dia em São Luís.
export function dataCivil(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return fmtCivil.format(d);
}

export function dataBR(v) {
  const c = dataCivil(v);
  return c ? c.split('-').reverse().join('/') : '—';
}

export const hojeCivil = (agora = new Date()) => dataCivil(agora);

// Soma dias a uma data civil "AAAA-MM-DD" (conta pura de calendário, sem fuso).
export function somaDias(civil, n) {
  const [y, m, d] = civil.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher).
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Feriados nacionais, incluindo Carnaval (segunda e terça), Sexta-feira Santa e Corpus Christi.
const feriadosCache = new Map();
export function feriadosNacionais(ano) {
  if (!feriadosCache.has(ano)) {
    const p = pascoa(ano);
    const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map(d => `${ano}-${d}`);
    feriadosCache.set(ano, new Set([...fixos, somaDias(p, -48), somaDias(p, -47), somaDias(p, -2), somaDias(p, 60)]));
  }
  return feriadosCache.get(ano);
}

export function diaUtil(civil) {
  const dia = new Date(`${civil}T12:00:00Z`).getUTCDay();
  return dia !== 0 && dia !== 6 && !feriadosNacionais(+civil.slice(0, 4)).has(civil);
}

// Data civil n dias úteis depois de "civil" (o próprio dia não conta).
export function somaDiasUteis(civil, n) {
  let d = civil;
  for (let contados = 0; contados < n;) {
    d = somaDias(d, 1);
    if (diaUtil(d)) contados++;
  }
  return d;
}

// [primeiro dia, último dia] do mês de "hoje" deslocado (0 = este mês, 1 = próximo).
export function periodoMes(hoje = hojeCivil(), deslocamento = 0) {
  const [y, m] = hoje.split('-').map(Number);
  const iso = t => new Date(t).toISOString().slice(0, 10);
  return [iso(Date.UTC(y, m - 1 + deslocamento, 1)), iso(Date.UTC(y, m + deslocamento, 0))];
}

const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
// "10:32" no fuso do app.
export function horaBR(v = new Date()) {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : fmtHora.format(d);
}

// "hoje, 10:32" · "ontem, 10:32" · "15/11/2026, 10:32" (no fuso do app).
export function quandoBR(v, agora = new Date()) {
  if (!v) return '';
  const dia = dataCivil(v), hoje = dataCivil(agora);
  if (!dia) return '';
  const rotulo = dia === hoje ? 'hoje' : dia === somaDias(hoje, -1) ? 'ontem' : dataBR(dia);
  return `${rotulo}, ${horaBR(v)}`;
}

// Duração em dias, contando o primeiro e o último.
export function dias(a, b) {
  const ca = dataCivil(a), cb = dataCivil(b);
  if (!ca || !cb) return null;
  const [y1, m1, d1] = ca.split('-').map(Number), [y2, m2, d2] = cb.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5) + 1;
}

// Serial de data do Excel (dias desde 30/12/1899), sem passar Date para a
// biblioteca — assim não sobra horário residual nem a data "pula" um dia.
export function dataExcel(v) {
  const c = dataCivil(v);
  if (!c) return '';
  const [ano, mes, dia] = c.split('-').map(Number);
  return Math.round((Date.UTC(ano, mes - 1, dia) - Date.UTC(1899, 11, 30)) / 864e5);
}

// Índice da coluna (0 = A) → letra do Excel: 0 → A, 25 → Z, 26 → AA.
export function colunaExcel(i) {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ---------- quem recebe a premiação ----------
// Mesma régua da constraint campanhas_swile_valido e da tabela balconistas.
// Devolve { campo: mensagem } — vazio quando está tudo certo.
export function errosRecebedor(r, hoje = hojeCivil()) {
  const e = {};
  if (!nomeCompleto(r.nome_completo)) e.nome_completo = 'Informe nome e sobrenome.';
  if (!soDigitos(r.cpf)) e.cpf = 'Informe o CPF.';
  else if (!cpfValido(r.cpf)) e.cpf = 'CPF inválido. Confira os números.';
  if (!r.data_nascimento) e.data_nascimento = 'Informe a data de nascimento.';
  else if (r.data_nascimento > hoje) e.data_nascimento = 'A data não pode ser no futuro.';
  if (!String(r.email ?? '').trim()) e.email = 'Informe o e-mail.';
  else if (!emailValido(r.email)) e.email = 'Digite um e-mail válido.';
  if (!telefoneValido(r.telefone)) e.telefone = 'Informe o telefone com DDD (10 ou 11 números).';
  return e;
}
