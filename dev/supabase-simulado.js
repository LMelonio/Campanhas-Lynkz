// ============================================================
//  SUPABASE SIMULADO — para rodar o app sem banco (só desenvolvimento).
//
//  Como usar:
//  1. Copie a pasta do app para outro lugar (não publique isto).
//  2. Copie este arquivo por cima de js/lib/supabase.js.
//  3. Na pasta copiada:  python3 -m http.server 8000
//  4. Abra  http://localhost:8000/?papel=aprovador   ou  ?papel=coordenador
//
//  Imita as regras principais do banco: só o aprovador decide, decisão só
//  sai de Pendente, carimbos de quem decidiu, dados Swile só para o
//  aprovador e o solicitante, balconista da mesma empresa, CPF único por
//  empresa. Os dados ficam no sessionStorage da aba (fechar a aba zera).
//  Para recomeçar do zero: ?zerar=1
// ============================================================
const q = new URLSearchParams(location.search);
const PAPEL = q.get('papel') === 'coordenador' ? 'coordenador' : 'aprovador';
const CHAVE = 'simulado-db-v2';
if (q.get('zerar')) sessionStorage.removeItem(CHAVE);

const USUARIOS = {
  'u-aprov': { id: 'u-aprov', email: 'ana@lynkz.com.br', nome: 'Ana Aprovadora', papel: 'aprovador', ativo: true },
  'u-coord': { id: 'u-coord', email: 'carlos@lynkz.com.br', nome: 'Carlos Coordenador', papel: 'coordenador', ativo: true },
  'u-bia':   { id: 'u-bia', email: 'bia@lynkz.com.br', nome: 'Bia Souza', papel: 'coordenador', ativo: true },
};
const EU = PAPEL === 'aprovador' ? 'u-aprov' : 'u-coord';

const agora = (dd = 0, hh = 0) => new Date(Date.now() - dd * 864e5 - hh * 36e5).toISOString();
const dia = dd => agora(dd).slice(0, 10);

function semente() {
  const empresas = [
    { id: 1, nome: 'Agropecuária São Luís', cnpj: '12345678000190', cidade: 'São Luís', telefone: '9832210000', observacoes: null, ativo: true, criado_em: agora(60), criado_por: 'u-coord', atualizado_em: null, atualizado_por: null },
    { id: 2, nome: 'Pet Center Imperatriz', cnpj: '11222333000181', cidade: 'Imperatriz', telefone: '99988887777', observacoes: 'Compra concentrada no começo do mês.', ativo: true, criado_em: agora(50), criado_por: 'u-bia', atualizado_em: null, atualizado_por: null },
    { id: 3, nome: 'Casa do Criador', cnpj: null, cidade: 'Caxias', telefone: null, observacoes: null, ativo: true, criado_em: agora(40), criado_por: 'u-coord', atualizado_em: null, atualizado_por: null },
    { id: 4, nome: 'Agro Antiga (fechou)', cnpj: null, cidade: 'Bacabal', telefone: null, observacoes: null, ativo: false, criado_em: agora(200), criado_por: 'u-coord', atualizado_em: null, atualizado_por: null },
  ];
  const balconistas = [
    { id: 1, empresa_id: 1, nome_completo: 'Maria Silva Santos', cpf: '52998224725', data_nascimento: '1992-04-12', email: 'maria.silva@exemplo.com', telefone: '98999990001', ativo: true, criado_em: agora(30) },
    { id: 2, empresa_id: 2, nome_completo: 'João Pedro Lima', cpf: '11144477735', data_nascimento: '1988-09-30', email: 'joao.lima@exemplo.com', telefone: '99999990002', ativo: true, criado_em: agora(29) },
    { id: 3, empresa_id: 2, nome_completo: 'Ana Beatriz Costa', cpf: '39053344705', data_nascimento: '1995-01-05', email: 'ana.costa@exemplo.com', telefone: '99999990003', ativo: true, criado_em: agora(28) },
  ];
  let n = 0;
  const camp = (o) => ({
    id: ++n, codigo: 'C2611' + String(1000 + n), tipo: null, mecanica: null, investimento_lynkz: 0, investimento_industria: 0,
    forma_pagamento: 'Desconto em nota', data_inicio: dia(-1), data_fim: dia(-30), tipo_meta: 'Mensal', meta: 0,
    rebate_pct: 0, rebate_teto: 0, rebate_base: null, rebate_gatilho: null, observacoes: null, status: 'Pendente',
    aprovador_nome: null, data_decisao: null, motivo: null, empresa_id: null, balconista_id: null,
    swile_nome_completo: null, swile_cpf: null, swile_data_nascimento: null, swile_email: null, swile_telefone: null,
    ...o, solicitante_nome: USUARIOS[o.solicitante_id].nome,
  });
  const campanhas = [
    camp({ cliente: 'Agropecuária São Luís', empresa_id: 1, laboratorio: 'Biogénesis Bagó Pet', campanha: 'Vacinas Novembro', tipo: 'Rebate por meta', investimento_lynkz: 1500, investimento_industria: 800, meta: 40000, rebate_pct: 2, rebate_base: 'Sell-in (compras do cliente)', rebate_gatilho: 'Ao atingir 100% da meta', solicitante_id: 'u-coord', criado_em: agora(3) }),
    camp({ cliente: 'Pet Center Imperatriz', empresa_id: 2, balconista_id: 2, laboratorio: 'Premier', campanha: 'Balconista destaque', tipo: 'Campanha de balconista', forma_pagamento: 'Swile', investimento_lynkz: 600, meta: 5000,
      swile_nome_completo: 'João Pedro Lima', swile_cpf: '11144477735', swile_data_nascimento: '1988-09-30', swile_email: 'joao.lima@exemplo.com', swile_telefone: '99999990002', solicitante_id: 'u-bia', criado_em: agora(2) }),
    camp({ cliente: 'Casa do Criador', empresa_id: 3, laboratorio: 'Ouro Fino', campanha: 'Antiparasitários Verão', investimento_lynkz: 3000, investimento_industria: 2000, meta: 20000, solicitante_id: 'u-coord', criado_em: agora(1) }),
    camp({ cliente: 'Agropecuária São Luís', empresa_id: 1, laboratorio: 'Vansil', campanha: 'Combo Vermífugos', investimento_lynkz: 900, meta: 18000, status: 'Aprovada', aprovador_nome: 'Ana Aprovadora', data_decisao: dia(4), solicitante_id: 'u-coord', criado_em: agora(6) }),
    camp({ cliente: 'Pet Center Imperatriz', empresa_id: 2, laboratorio: 'Farmina', campanha: 'Ração Premium', investimento_lynkz: 2500, meta: 12000, status: 'Reprovada', motivo: 'Custo acima do padrão para a meta informada.', aprovador_nome: 'Ana Aprovadora', data_decisao: dia(5), solicitante_id: 'u-coord', criado_em: agora(7) }),
    camp({ cliente: 'Cliente da v1 Ltda', laboratorio: 'Boehringer', campanha: 'Campanha antiga sem cadastro', investimento_lynkz: 400, meta: 10000, status: 'Aprovada', aprovador_nome: 'Ana Aprovadora', data_decisao: dia(40), solicitante_id: 'u-bia', criado_em: agora(42) }),
  ];
  return { empresas, balconistas, campanhas, seq: { empresas: 4, balconistas: 3, campanhas: n } };
}

let db = (() => { try { return JSON.parse(sessionStorage.getItem(CHAVE)) || semente(); } catch { return semente(); } })();
const gravarDb = () => { try { sessionStorage.setItem(CHAVE, JSON.stringify(db)); } catch { /* cheio */ } };
gravarDb();

// ---------- regras imitadas ----------
const SWILE = ['swile_nome_completo', 'swile_cpf', 'swile_data_nascimento', 'swile_email', 'swile_telefone'];
const erro = (message, code = 'P0001') => ({ message, code });
function cpfValido(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const n = d.split('').map(Number);
  const dv = f => { let s = 0, p = f; for (let i = 0; i < f - 1; i++) s += n[i] * p--; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(10) === n[9] && dv(11) === n[10];
}
const usuario = () => (sessao ? USUARIOS[sessao.user.id] : null);
const ehAprovador = () => usuario()?.papel === 'aprovador';
const hojeFortaleza = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date());

function verView(c) {
  const pode = ehAprovador() || c.solicitante_id === usuario()?.id;
  const r = { ...c, swile_visivel: pode };
  if (!pode) SWILE.forEach(k => { r[k] = null; });
  return r;
}

function inserir(tabela, d) {
  const u = usuario();
  if (!u) return { error: erro('permission denied', '42501') };
  if (tabela === 'empresas') {
    if (String(d.nome || '').trim().length < 2) return { error: erro('violates check constraint "empresas_nome_valido"', '23514') };
    if (d.cnpj && db.empresas.some(e => e.cnpj === d.cnpj)) return { error: erro('duplicate key value violates unique constraint "empresas_cnpj_unico"', '23505') };
    const r = { cnpj: null, cidade: null, telefone: null, observacoes: null, ativo: true, ...d, id: ++db.seq.empresas, criado_em: new Date().toISOString(), criado_por: u.id, atualizado_em: null, atualizado_por: null };
    db.empresas.push(r); return { row: r };
  }
  if (tabela === 'balconistas') {
    if (!cpfValido(d.cpf)) return { error: erro('violates check constraint "balconistas_cpf_valido"', '23514') };
    if (db.balconistas.some(b => b.empresa_id == d.empresa_id && b.cpf === d.cpf)) return { error: erro('duplicate key value violates unique constraint "balconistas_empresa_cpf_unico"', '23505') };
    const r = { ativo: true, ...d, empresa_id: +d.empresa_id, id: ++db.seq.balconistas, criado_em: new Date().toISOString(), criado_por: u.id };
    db.balconistas.push(r); return { row: r };
  }
  if (tabela === 'campanhas') {
    if (d.solicitante_id !== u.id || d.status !== 'Pendente') return { error: erro('new row violates row-level security policy for table "campanhas"', '42501') };
    if (d.balconista_id != null) {
      if (d.empresa_id == null) return { error: erro('Escolha a empresa antes do balconista.') };
      if (!db.balconistas.some(b => b.id == d.balconista_id && b.empresa_id == d.empresa_id)) return { error: erro('O balconista escolhido não pertence a esta empresa.') };
    }
    if (d.forma_pagamento === 'Swile' && !(cpfValido(d.swile_cpf) && /\S+\s+\S+/.test(d.swile_nome_completo || '') && /^\d{10,11}$/.test(d.swile_telefone || ''))) {
      return { error: erro('new row violates check constraint "campanhas_swile_valido"', '23514') };
    }
    const empresa = db.empresas.find(e => e.id == d.empresa_id);
    const id = ++db.seq.campanhas;
    const r = { ...d, id, codigo: 'C2611' + String(1000 + id), criado_em: new Date().toISOString(), cliente: empresa ? empresa.nome : d.cliente,
      empresa_id: d.empresa_id == null ? null : +d.empresa_id, balconista_id: d.balconista_id == null ? null : +d.balconista_id,
      solicitante_nome: u.nome, aprovador_nome: null, data_decisao: null, motivo: null };
    db.campanhas.push(r); return { row: r };
  }
  return { error: erro('permission denied', '42501') };
}

function atualizar(tabela, linhas, d) {
  const u = usuario();
  if (tabela === 'campanhas') {
    if (!ehAprovador()) return { rows: [] };       // RLS: nenhuma linha muda
    for (const c of linhas) {
      if (d.status === 'Reprovada' && !String(d.motivo || '').trim()) return { error: erro('Reprova exige motivo.') };
    }
    linhas.forEach(c => Object.assign(c, d, { aprovador_nome: u.nome, data_decisao: hojeFortaleza() }));
    return { rows: linhas };
  }
  if (tabela === 'balconistas' && 'cpf' in d) {
    for (const b of linhas) {
      if (!cpfValido(d.cpf)) return { error: erro('violates check constraint "balconistas_cpf_valido"', '23514') };
      if (db.balconistas.some(x => x.id !== b.id && x.empresa_id === b.empresa_id && x.cpf === d.cpf)) return { error: erro('duplicate key value violates unique constraint "balconistas_empresa_cpf_unico"', '23505') };
    }
  }
  linhas.forEach(r => Object.assign(r, d, { atualizado_em: new Date().toISOString(), atualizado_por: u.id }));
  return { rows: linhas };
}

// ---------- tempo real ----------
const canais = new Set();
function emitir(tabela, eventType, row) {
  setTimeout(() => canais.forEach(c => c.ouvintes.forEach(o => {
    if (o.filtro.table === tabela) o.fn({ eventType, new: { id: row.id }, old: {} });
  })), 50);
}

// ---------- construtor de consultas ----------
class Consulta {
  constructor(tabela) { this.tabela = tabela; this.op = 'select'; this.filtros = []; this.ordem = null; this.modo = null; this.retornar = false; }
  select() { if (this.op !== 'select') this.retornar = true; return this; }
  insert(d) { this.op = 'insert'; this.dados = d; return this; }
  update(d) { this.op = 'update'; this.dados = d; return this; }
  eq(col, val) { this.filtros.push([col, val]); return this; }
  order(col, { ascending = true } = {}) { this.ordem = [col, ascending]; return this; }
  single() { this.modo = 'single'; return this; }
  maybeSingle() { this.modo = 'maybe'; return this; }
  then(ok, falha) { return new Promise(r => setTimeout(r, 120 + Math.random() * 180)).then(() => this.executar()).then(ok, falha); }

  executar() {
    if (!usuario()) return { data: null, error: erro('JWT expired', 'PGRST301') };
    const view = this.tabela === 'campanhas_app';
    const nome = view ? 'campanhas' : this.tabela;
    if (nome === 'perfis') {
      const r = Object.values(USUARIOS).filter(p => this.filtros.every(([c, v]) => String(p[c]) === String(v)));
      return this.fim(r);
    }
    const tabela = db[nome];
    if (!tabela) return { data: null, error: erro(`relation "${this.tabela}" does not exist`, '42P01') };
    const casa = r => this.filtros.every(([c, v]) => String(r[c]) === String(v));

    if (this.op === 'insert') {
      const res = inserir(nome, this.dados);
      if (res.error) return { data: null, error: res.error };
      gravarDb(); emitir(nome, 'INSERT', res.row);
      return this.fim(this.retornar ? [res.row] : []);
    }
    if (this.op === 'update') {
      const res = atualizar(nome, tabela.filter(casa), this.dados);
      if (res.error) return { data: null, error: res.error };
      gravarDb(); res.rows.forEach(r => emitir(nome, 'UPDATE', r));
      return this.fim(this.retornar ? res.rows : []);
    }
    let linhas = tabela.filter(casa).map(r => (nome === 'campanhas' ? verView(r) : { ...r }));
    if (nome === 'campanhas' && !view) linhas = linhas.map(r => { const x = { ...r }; SWILE.forEach(k => delete x[k]); delete x.swile_visivel; return x; });
    if (this.ordem) {
      const [c, asc] = this.ordem;
      linhas.sort((a, b) => String(a[c] ?? '').localeCompare(String(b[c] ?? ''), 'pt-BR') * (asc ? 1 : -1));
    }
    return this.fim(linhas);
  }

  fim(linhas) {
    const copia = linhas.map(r => JSON.parse(JSON.stringify(r)));
    if (this.modo === 'single') return copia.length === 1 ? { data: copia[0], error: null } : { data: null, error: erro('JSON object requested, multiple (or no) rows returned', 'PGRST116') };
    if (this.modo === 'maybe') return { data: copia[0] ?? null, error: null };
    return { data: copia, error: null };
  }
}

// ---------- autenticação ----------
const CHAVE_SAIU = 'simulado-saiu';
let sessao = sessionStorage.getItem(CHAVE_SAIU) ? null : { user: { id: EU, email: USUARIOS[EU].email }, access_token: 'simulado' };
const ouvintesAuth = new Set();
const avisarAuth = evt => setTimeout(() => ouvintesAuth.forEach(fn => fn(evt, sessao)), 0);

export const sb = {
  from: tabela => new Consulta(tabela),
  channel(nome) {
    const c = { nome, ouvintes: [], on(_tipo, filtro, fn) { this.ouvintes.push({ filtro, fn }); return this; }, subscribe() { canais.add(this); return this; } };
    return c;
  },
  removeChannel(c) { canais.delete(c); },
  auth: {
    async getSession() { return { data: { session: sessao }, error: null }; },
    async getUser() { return sessao ? { data: { user: sessao.user }, error: null } : { data: { user: null }, error: erro('Auth session missing') }; },
    async signInWithPassword({ email }) {
      const u = Object.values(USUARIOS).find(x => x.email === email);
      if (!u) return { data: {}, error: { message: 'Invalid login credentials' } };
      sessao = { user: { id: u.id, email: u.email }, access_token: 'simulado' };
      sessionStorage.removeItem(CHAVE_SAIU);
      avisarAuth('SIGNED_IN');
      return { data: { session: sessao }, error: null };
    },
    async signOut() { sessao = null; sessionStorage.setItem(CHAVE_SAIU, '1'); avisarAuth('SIGNED_OUT'); return { error: null }; },
    async resetPasswordForEmail() { return { data: {}, error: null }; },
    async verifyOtp() { return { data: {}, error: { message: 'Simulador: link de recuperação não existe.' } }; },
    async updateUser() { return { data: {}, error: null }; },
    onAuthStateChange(fn) { ouvintesAuth.add(fn); return { data: { subscription: { unsubscribe: () => ouvintesAuth.delete(fn) } } }; },
  },
};
