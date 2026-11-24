// ============================================================
//  SUPABASE SIMULADO — para rodar o app sem banco (só desenvolvimento).
//
//  Como usar (da raiz do projeto):
//     node dev/servidor.mjs
//  e abra  http://localhost:8000/?papel=aprovador   ou  ?papel=coordenador
//  O servidor entrega este arquivo no lugar de public/js/lib/supabase.js.
//  Nunca copie este arquivo para dentro de public/.
//
//  Imita as regras principais do banco: só o aprovador decide, decisão só
//  sai de Pendente, carimbos de quem decidiu, dados Swile só para o
//  aprovador e o solicitante, balconista da mesma empresa, CPF único por
//  empresa. Os dados ficam no sessionStorage da aba (fechar a aba zera).
//  Para recomeçar do zero: ?zerar=1
//  Muitas empresas do Qlik (testar volume e a leitura em blocos de 1.000): ?muitas=1500
//
//  Para testar falhas (lidos a cada consulta, dá para tirar da URL sem recarregar):
//    ?sem=campanhas_app,empresas   → essas tabelas "não existem" (PGRST205, banco desatualizado)
//    ?falhar=campanhas_app         → consulta falha como se a rede caísse
//  Senha: qualquer uma entra, menos as que começam com "errad" (para testar senha errada).
// ============================================================
const q = new URLSearchParams(location.search);
const PAPEL = q.get('papel') === 'coordenador' ? 'coordenador' : 'aprovador';
const CHAVE = 'simulado-db-v3' + (q.get('muitas') ? '-m' + q.get('muitas') : '');
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
    { id: 1, nome: 'Agropecuária São Luís', cnpj: '12345678000195', cidade: 'São Luís', telefone: '9832210000', observacoes: null, ativo: true, criado_em: agora(60), criado_por: 'u-coord', atualizado_em: null, atualizado_por: null },
    { id: 2, nome: 'Pet Center Imperatriz', cnpj: '11222333000181', cidade: 'Imperatriz', telefone: '99988887777', observacoes: 'Compra concentrada no começo do mês.', ativo: true, criado_em: agora(50), criado_por: 'u-bia', atualizado_em: null, atualizado_por: null },
    { id: 3, nome: 'Casa do Criador', nome_fantasia: 'Criador Agropet', cnpj: null, cidade: 'Caxias', uf: 'MA', vendedor: 'Bia Souza', codigo_cliente: '4821', origem: 'qlik', sincronizado_em: agora(0, 3), telefone: null, observacoes: null, ativo: true, criado_em: agora(40), criado_por: 'u-coord', atualizado_em: null, atualizado_por: null },
    { id: 4, nome: 'Agro Antiga (fechou)', cnpj: null, cidade: 'Bacabal', telefone: null, observacoes: null, ativo: false, criado_em: agora(200), criado_por: 'u-coord', atualizado_em: null, atualizado_por: null },
  ];
  // ?muitas=N: N clientes do Qlik a mais (volume real da base).
  const muitas = Math.min(+q.get('muitas') || 0, 5000);
  for (let i = 0; i < muitas; i++) {
    empresas.push({ id: 100 + i, nome: `CLIENTE QLIK ${String(i + 1).padStart(4, '0')} LTDA`, nome_fantasia: null, cnpj: null, cidade: i % 2 ? 'SAO LUIS' : 'CAXIAS', uf: 'MA',
      vendedor: 'Bia Souza', codigo_cliente: String(9000 + i), origem: 'qlik', sincronizado_em: agora(0, 3), telefone: null, observacoes: null, ativo: true, criado_em: agora(10), criado_por: null, atualizado_em: null, atualizado_por: null });
  }
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
    aprovador_nome: null, data_decisao: null, motivo: null, empresa_id: null, balconista_id: null, importada: false,
    compras_periodo: null, compras_consultado_em: null, compras_marca: null, compras_devolucoes: null, compras_devolvidas: null,
    swile_nome_completo: null, swile_cpf: null, swile_data_nascimento: null, swile_email: null, swile_telefone: null,
    solicitante_nome: USUARIOS[o.solicitante_id]?.nome ?? null, ...o,
  });
  const campanhas = [
    camp({ cliente: 'Agropecuária São Luís', empresa_id: 1, laboratorio: 'Biogénesis Bagó Pet', campanha: 'Vacinas Novembro', tipo: 'Rebate por meta', investimento_lynkz: 1500, investimento_industria: 800, meta: 40000, rebate_pct: 2, rebate_base: 'Sell-in (compras do cliente)', rebate_gatilho: 'Ao atingir 100% da meta', solicitante_id: 'u-coord', criado_em: agora(3) }),
    camp({ cliente: 'Pet Center Imperatriz', empresa_id: 2, balconista_id: 2, laboratorio: 'Premier', campanha: 'Balconista destaque', tipo: 'Campanha de balconista', forma_pagamento: 'Swile', investimento_lynkz: 600, meta: 5000,
      swile_nome_completo: 'João Pedro Lima', swile_cpf: '11144477735', swile_data_nascimento: '1988-09-30', swile_email: 'joao.lima@exemplo.com', swile_telefone: '99999990002', solicitante_id: 'u-bia', criado_em: agora(2) }),
    camp({ cliente: 'Casa do Criador', empresa_id: 3, laboratorio: 'Ouro Fino', campanha: 'Antiparasitários Verão', investimento_lynkz: 3000, investimento_industria: 2000, meta: 20000, solicitante_id: 'u-coord', criado_em: agora(1) }),
    camp({ cliente: 'Agropecuária São Luís', empresa_id: 1, laboratorio: 'Vansil', campanha: 'Combo Vermífugos', investimento_lynkz: 900, meta: 18000, status: 'Aprovada', aprovador_nome: 'Ana Aprovadora', data_decisao: dia(4), solicitante_id: 'u-coord', criado_em: agora(6) }),
    camp({ cliente: 'Pet Center Imperatriz', empresa_id: 2, laboratorio: 'Farmina', campanha: 'Ração Premium', investimento_lynkz: 2500, meta: 12000, status: 'Reprovada', motivo: 'Custo acima do padrão para a meta informada.', aprovador_nome: 'Ana Aprovadora', data_decisao: dia(5), solicitante_id: 'u-coord', criado_em: agora(7) }),
    camp({ codigo: 'H2609001', cliente: 'Casa do Criador', empresa_id: 3, laboratorio: 'Ouro Fino', campanha: 'Campanha WellPet', tipo: 'Campanha de balconista',
      mecanica: 'R$ 3,00 por dose de WellPet vendida', forma_pagamento: 'Bonificação em produto', investimento_lynkz: 159, data_inicio: '2026-08-01', data_fim: '2026-08-31', tipo_meta: null,
      status: 'Aprovada', aprovador_nome: 'Charles Machado', data_decisao: '2026-09-30', solicitante_id: null, solicitante_nome: 'Alexandre Froes', importada: true, criado_em: '2026-09-30T15:00:00.000Z' }),
    camp({ cliente: 'Cliente da v1 Ltda', laboratorio: 'Boehringer', campanha: 'Campanha antiga sem cadastro', investimento_lynkz: 400, meta: 10000, status: 'Aprovada', aprovador_nome: 'Ana Aprovadora', data_decisao: dia(40), solicitante_id: 'u-bia', criado_em: agora(42) }),
  ];
  // Perfis: os 3 de sempre + uma conta nova esperando liberação (tela Usuários).
  const perfis = { ...JSON.parse(JSON.stringify(USUARIOS)),
    'u-novo': { id: 'u-novo', email: 'diego@lynkz.com.br', nome: 'diego', papel: 'coordenador', ativo: false, criado_em: agora(1) } };
  return { perfis, empresas, balconistas, campanhas, campanha_notas: [], seq: { empresas: 100 + muitas, balconistas: 3, campanhas: n, campanha_notas: 0 } };
}

let db = (() => { try { return JSON.parse(sessionStorage.getItem(CHAVE)) || semente(); } catch { return semente(); } })();
db.campanha_notas ||= []; db.seq.campanha_notas ||= 0;
db.perfis ||= JSON.parse(JSON.stringify(USUARIOS));
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
const usuario = () => (sessao ? db.perfis[sessao.user.id] || null : null);
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
    const r = { cnpj: null, cidade: null, telefone: null, observacoes: null, ativo: true, nome_fantasia: null, uf: null, vendedor: null, codigo_cliente: null, origem: 'app', sincronizado_em: null, ...d, id: ++db.seq.empresas, criado_em: new Date().toISOString(), criado_por: u.id, atualizado_em: null, atualizado_por: null };
    db.empresas.push(r); return { row: r };
  }
  if (tabela === 'balconistas') {
    // Migração 12: no máximo 2 por empresa, contando os desativados.
    if (db.balconistas.filter(b => b.empresa_id == d.empresa_id).length >= 2) return { error: erro('Esta empresa já tem 2 balconistas cadastrados, que é o limite. Edite um deles na ficha da empresa.') };
    if (!cpfValido(d.cpf)) return { error: erro('violates check constraint "balconistas_cpf_valido"', '23514') };
    if (db.balconistas.some(b => b.empresa_id == d.empresa_id && b.cpf === d.cpf)) return { error: erro('duplicate key value violates unique constraint "balconistas_empresa_cpf_unico"', '23505') };
    const r = { ativo: true, ...d, empresa_id: +d.empresa_id, id: ++db.seq.balconistas, criado_em: new Date().toISOString(), criado_por: u.id };
    db.balconistas.push(r); return { row: r };
  }
  if (tabela === 'campanhas') {
    if (d.solicitante_id !== u.id || d.status !== 'Pendente') return { error: erro('new row violates row-level security policy for table "campanhas"', '42501') };
    if (d.rebate_pct > 100 || d.meta > 1e9 || d.investimento_lynkz > 1e7 || d.investimento_industria > 1e7 || d.rebate_teto > 1e7) {
      return { error: erro('new row for relation "campanhas" violates check constraint "campanhas_valores_faixa"', '23514') };
    }
    if (d.balconista_id != null) {
      if (d.empresa_id == null) return { error: erro('Escolha a empresa antes do balconista.') };
      if (!db.balconistas.some(b => b.id == d.balconista_id && b.empresa_id == d.empresa_id)) return { error: erro('O balconista escolhido não pertence a esta empresa.') };
    }
    if (d.forma_pagamento === 'Swile' && !(cpfValido(d.swile_cpf) && /\S+\s+\S+/.test(d.swile_nome_completo || '') && /^\d{10,11}$/.test(d.swile_telefone || ''))) {
      return { error: erro('new row violates check constraint "campanhas_swile_valido"', '23514') };
    }
    const empresa = db.empresas.find(e => e.id == d.empresa_id);
    const id = ++db.seq.campanhas;
    const r = { compras_periodo: null, compras_consultado_em: null, compras_marca: null, compras_devolucoes: null, compras_devolvidas: null, ...d, id, importada: false, codigo: 'C2611' + String(1000 + id), criado_em: new Date().toISOString(), cliente: empresa ? empresa.nome : d.cliente,
      empresa_id: d.empresa_id == null ? null : +d.empresa_id, balconista_id: d.balconista_id == null ? null : +d.balconista_id,
      solicitante_nome: u.nome, aprovador_nome: null, data_decisao: null, motivo: null };
    db.campanhas.push(r); return { row: r };
  }
  if (tabela === 'campanha_notas') {
    const c = db.campanhas.find(x => x.id == d.campanha_id);
    if (!c || c.solicitante_id !== u.id || c.status !== 'Pendente') return { error: erro('new row violates row-level security policy for table "campanha_notas"', '42501') };
    if (!String(d.numero || '').trim()) return { error: erro('violates check constraint "campanha_notas_numero_valido"', '23514') };
    if (db.campanha_notas.some(n => n.campanha_id == d.campanha_id && n.numero === d.numero && (n.serie || '') === (d.serie || ''))) {
      return { error: erro('duplicate key value violates unique constraint "campanha_notas_unica"', '23505') };
    }
    const r = { serie: '', data_emissao: null, valor: 0, ...d, campanha_id: +d.campanha_id, id: ++db.seq.campanha_notas, criado_em: new Date().toISOString() };
    db.campanha_notas.push(r); return { row: r };
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
  if (tabela === 'empresas') {
    for (const e of linhas) {
      if (e.codigo_cliente && ['nome', 'cnpj', 'cidade'].some(k => k in d && (d[k] ?? null) !== (e[k] ?? null))) {
        return { error: erro('Nome, CNPJ e cidade desta empresa vêm do Qlik e não podem ser alterados no app.') };
      }
    }
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

// enviar_campanha(p_campanha, p_balconista, p_notas): balconista + campanha + notas numa
// transação só. Qualquer erro desfaz tudo (o banco guarda uma cópia e volta a ela).
function enviarCampanha({ p_campanha: c, p_balconista: b = null, p_notas: notas = [] }) {
  const u = usuario();
  if (!u) return { error: erro('JWT expired', 'PGRST301') };
  const antes = JSON.stringify(db);
  const falha = e => { db = JSON.parse(antes); return { error: e }; };
  const eventos = [];
  let balId = c.balconista_id ?? null;
  if (b) {
    if (b.id != null) {
      const alvo = db.balconistas.find(x => x.id == b.id);
      if (!alvo) return falha(erro('O balconista escolhido não foi encontrado.'));
      const { id, ...resto } = b;
      const res = atualizar('balconistas', [alvo], resto);
      if (res.error) return falha(res.error);
      balId = alvo.id; eventos.push(['balconistas', 'UPDATE', alvo]);
    } else {
      const res = inserir('balconistas', { ...b });
      if (res.error) return falha(res.error);
      balId = res.row.id; eventos.push(['balconistas', 'INSERT', res.row]);
    }
  }
  const res = inserir('campanhas', { ...c, balconista_id: balId, solicitante_id: u.id, status: 'Pendente' });
  if (res.error) return falha(res.error);
  eventos.push(['campanhas', 'INSERT', res.row]);
  for (const n of notas) {
    const r = inserir('campanha_notas', { campanha_id: res.row.id, numero: n.numero, serie: n.serie || '', data_emissao: n.data || null, valor: n.valor });
    if (r.error) return falha(r.error);
  }
  gravarDb();
  eventos.forEach(e => emitir(...e));
  return { data: { id: res.row.id, codigo: res.row.codigo, balconista_id: balId }, error: null };
}

// definir_perfil(p_id, p_papel, p_ativo, p_nome): só administrador; ninguém se rebaixa nem se desativa.
function definirPerfil({ p_id: id, p_papel: papel = null, p_ativo: ativo = null, p_nome: nome = null }) {
  const u = usuario();
  if (!u) return { data: null, error: erro('JWT expired', 'PGRST301') };
  if (!(u.papel === 'aprovador' && u.ativo)) return { data: null, error: erro('Só um administrador muda usuários.', '42501') };
  if (papel != null && !['aprovador', 'coordenador'].includes(papel)) return { data: null, error: erro('Papel inválido.') };
  const n = nome == null ? null : String(nome).trim().replace(/\s+/g, ' ');
  if (nome != null && (n.length < 2 || n.length > 80)) return { data: null, error: erro('O nome precisa ter de 2 a 80 caracteres.') };
  if (id === u.id && ((papel != null && papel !== 'aprovador') || ativo === false)) {
    return { data: null, error: erro('Você não pode tirar o seu próprio acesso de administrador. Peça a outro administrador.') };
  }
  const alvo = db.perfis[id];
  if (!alvo) return { data: null, error: erro('Usuário não encontrado.') };
  if (papel != null) alvo.papel = papel;
  if (ativo != null) alvo.ativo = ativo;
  if (n) alvo.nome = n;
  gravarDb();
  return { data: JSON.parse(JSON.stringify(alvo)), error: null };
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
  constructor(tabela) { this.tabela = tabela; this.op = 'select'; this.filtros = []; this.ordem = []; this.modo = null; this.retornar = false; }
  select() { if (this.op !== 'select') this.retornar = true; return this; }
  insert(d) { this.op = 'insert'; this.dados = d; return this; }
  update(d) { this.op = 'update'; this.dados = d; return this; }
  eq(col, val) { this.filtros.push([col, val]); return this; }
  order(col, { ascending = true } = {}) { this.ordem.push([col, ascending]); return this; }
  range(de, ate) { this.faixa = [de, ate]; return this; }
  limit(n) { this.limite = n; return this; }
  single() { this.modo = 'single'; return this; }
  maybeSingle() { this.modo = 'maybe'; return this; }
  then(ok, falha) { return new Promise(r => setTimeout(r, 120 + Math.random() * 180)).then(() => this.executar()).then(ok, falha); }

  executar() {
    if (!usuario()) return { data: null, error: erro('JWT expired', 'PGRST301') };
    const qs = new URLSearchParams(location.search);
    const lista = k => (qs.get(k) || '').split(',').filter(Boolean);
    if (lista('sem').includes(this.tabela)) {
      return { data: null, error: erro(`Could not find the table 'public.${this.tabela}' in the schema cache`, 'PGRST205') };
    }
    if (lista('falhar').includes(this.tabela)) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
    const view = this.tabela === 'campanhas_app';
    const nome = view ? 'campanhas' : this.tabela;
    if (nome === 'perfis') {
      const r = Object.values(db.perfis).filter(p => this.filtros.every(([c, v]) => String(p[c]) === String(v)));
      return this.fim(r);
    }
    const tabela = db[nome];
    if (!tabela) return { data: null, error: erro(`relation "${this.tabela}" does not exist`, '42P01') };
    const casa = r => this.filtros.every(([c, v]) => String(r[c]) === String(v));

    if (this.op === 'insert') {
      const lote = Array.isArray(this.dados) ? this.dados : [this.dados];
      const feitas = [];
      for (const dado of lote) {
        const res = inserir(nome, dado);
        if (res.error) {   // tudo ou nada, como um insert de várias linhas no Postgres
          feitas.forEach(r => db[nome].splice(db[nome].indexOf(r), 1));
          return { data: null, error: res.error };
        }
        feitas.push(res.row);
      }
      gravarDb(); feitas.forEach(r => emitir(nome, 'INSERT', r));
      return this.fim(this.retornar ? feitas : []);
    }
    if (this.op === 'update') {
      const res = atualizar(nome, tabela.filter(casa), this.dados);
      if (res.error) return { data: null, error: res.error };
      gravarDb(); res.rows.forEach(r => emitir(nome, 'UPDATE', r));
      return this.fim(this.retornar ? res.rows : []);
    }
    let linhas = tabela.filter(casa).map(r => (nome === 'campanhas' ? verView(r) : { ...r }));
    if (nome === 'campanhas' && !view) linhas = linhas.map(r => { const x = { ...r }; SWILE.forEach(k => delete x[k]); delete x.swile_visivel; return x; });
    if (this.ordem.length) {
      const cmp = (x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR'));
      linhas.sort((a, b) => { for (const [c, asc] of this.ordem) { const r = cmp(a[c], b[c]); if (r) return asc ? r : -r; } return 0; });
    }
    // Como o PostgREST do Supabase: no máximo 1.000 linhas por consulta.
    linhas = this.faixa ? linhas.slice(this.faixa[0], this.faixa[1] + 1) : linhas.slice(0, 1000);
    return this.fim(linhas);
  }

  fim(linhas) {
    if (this.limite != null) linhas = linhas.slice(0, this.limite);
    const copia = linhas.map(r => JSON.parse(JSON.stringify(r)));
    if (this.modo === 'single') return copia.length === 1 ? { data: copia[0], error: null } : { data: null, error: erro('JSON object requested, multiple (or no) rows returned', 'PGRST116') };
    if (this.modo === 'maybe') return { data: copia[0] ?? null, error: null };
    return { data: copia, error: null };
  }
}

// ---------- autenticação ----------
const CHAVE_SAIU = 'simulado-saiu';
const novaSessao = u => ({ user: { id: u.id, email: u.email, last_sign_in_at: new Date().toISOString() }, access_token: 'simulado' });
let sessao = sessionStorage.getItem(CHAVE_SAIU) ? null : novaSessao(db.perfis[EU] || USUARIOS[EU]);
const ouvintesAuth = new Set();
const avisarAuth = evt => setTimeout(() => ouvintesAuth.forEach(fn => fn(evt, sessao)), 0);

export const sb = {
  from: tabela => new Consulta(tabela),
  rpc(nome, args = {}) {
    const rodar = () => {
      if (nome === 'definir_perfil') return definirPerfil(args);
      if (nome !== 'enviar_campanha') return { data: null, error: erro(`Could not find the function public.${nome} in the schema cache`, 'PGRST202') };
      const r = enviarCampanha(args);
      return r.error ? { data: null, error: r.error } : r;
    };
    return { then: (ok, falha) => new Promise(r => setTimeout(r, 120 + Math.random() * 180)).then(rodar).then(ok, falha) };
  },
  channel(nome) {
    const c = { nome, ouvintes: [], on(_tipo, filtro, fn) { this.ouvintes.push({ filtro, fn }); return this; }, subscribe() { canais.add(this); return this; } };
    return c;
  },
  removeChannel(c) { canais.delete(c); },
  auth: {
    async getSession() { return { data: { session: sessao }, error: null }; },
    async getUser() { return sessao ? { data: { user: sessao.user }, error: null } : { data: { user: null }, error: erro('Auth session missing') }; },
    async signInWithPassword({ email, password = '' }) {
      const u = Object.values(db.perfis).find(x => x.email === email);
      if (!u || /^errad/i.test(password)) return { data: {}, error: { message: 'Invalid login credentials', status: 400 } };
      sessao = novaSessao(u);
      sessionStorage.removeItem(CHAVE_SAIU);
      avisarAuth('SIGNED_IN');
      return { data: { session: sessao }, error: null };
    },
    async signOut() { sessao = null; sessionStorage.setItem(CHAVE_SAIU, '1'); avisarAuth('SIGNED_OUT'); return { error: null }; },
    async resetPasswordForEmail() { return { data: {}, error: null }; },
    async verifyOtp() { return { data: {}, error: { message: 'Simulador: link de recuperação não existe.' } }; },
    async updateUser({ password } = {}) {
      if (password === 'senha-igual') return { data: {}, error: { code: 'same_password', message: 'same password' } };
      return { data: {}, error: null };
    },
    onAuthStateChange(fn) { ouvintesAuth.add(fn); return { data: { subscription: { unsubscribe: () => ouvintesAuth.delete(fn) } } }; },
  },
};
