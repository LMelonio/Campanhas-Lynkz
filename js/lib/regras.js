// ============================================================
//  REGRAS — funções puras do app (sem DOM, sem rede).
//  Testadas em tests/regras.test.mjs:  node --test tests/regras.test.mjs
//  As mesmas regras vivem no banco (sql/schema.sql); aqui servem só para
//  avisar antes de tentar gravar. Quem barra de verdade é o banco.
// ============================================================

export const STATUS = Object.freeze({
  PENDENTE: 'Pendente',
  APROVADA: 'Aprovada',
  REPROVADA: 'Reprovada',
});

export const PAPEL = Object.freeze({
  APROVADOR: 'aprovador',
  COORDENADOR: 'coordenador',
});

// Fuso das datas do app (Maranhão, UTC-3). O banco usa o mesmo em registrar_decisao().
export const FUSO = 'America/Fortaleza';

// A régua de custo vai de 0% a 25% da meta; acima disso o marcador fica no fim.
export const ESCALA_REGUA = 0.25;

// ---------- texto ----------
export const soDigitos = s => String(s ?? '').replace(/\D/g, '');

// Minúsculas e sem acento: "Biogénesis" → "biogenesis".
export const normaliza = s => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim();

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
