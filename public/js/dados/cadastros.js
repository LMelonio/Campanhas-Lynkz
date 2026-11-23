// ============================================================
//  CADASTROS — empresas e balconistas.
//  Todo usuário ativo lê, cadastra e edita. Nada é apagado: desativar é
//  gravar ativo = false. CPF, CNPJ e telefone saem só com dígitos.
// ============================================================
import { sb } from '../lib/supabase.js';
import { soDigitos } from '../lib/regras.js';
import { exigir } from './erros.js';

let empresasMap = new Map();
let balconistasMap = new Map();
let porEmpresa = null;   // índice empresa_id → balconistas (refeito quando algo muda)
let carregado = false;
let ultimoErro = null;   // mensagem da última carga que falhou (null = ok)
let canal = null;
const ouvintes = new Set();

const ordemPt = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });

function avisar(evento) {
  for (const fn of ouvintes) {
    try { fn(evento); } catch (e) { console.error(e); }
  }
}

// O Supabase devolve no máximo 1.000 linhas por consulta. Com os clientes do
// Qlik passam disso: lê em blocos até acabar.
const BLOCO = 1000;
async function lerTudo(tabela, ordem) {
  const todas = [];
  for (let de = 0; ; de += BLOCO) {
    const parte = exigir(await sb.from(tabela).select('*').order(ordem).order('id').range(de, de + BLOCO - 1)) || [];
    todas.push(...parte);
    if (parte.length < BLOCO) return todas;
  }
}

// Empresa que veio do Qlik: nome, CNPJ e cidade só mudam pela sincronização.
export const ehDoQlik = e => !!e?.codigo_cliente;

// Texto usado nas buscas de empresa (Gestão e Nova campanha).
export const textoBuscaEmpresa = (e, balcs = []) =>
  [e.nome, e.nome_fantasia, e.cidade, e.uf, e.cnpj, e.codigo_cliente, e.vendedor, ...balcs.map(b => b.nome_completo)].filter(Boolean).join(' ');

const textoOuNulo = v => { const s = String(v ?? '').trim(); return s || null; };
const digitosOuNulo = v => soDigitos(v) || null;

// Só as colunas que o banco deixa o app gravar (ver permissões em sql/schema.sql).
function camposEmpresa(d) {
  const r = {};
  if ('nome' in d)        r.nome = String(d.nome ?? '').trim();
  if ('cnpj' in d)        r.cnpj = digitosOuNulo(d.cnpj);
  if ('cidade' in d)      r.cidade = textoOuNulo(d.cidade);
  if ('telefone' in d)    r.telefone = digitosOuNulo(d.telefone);
  if ('observacoes' in d) r.observacoes = textoOuNulo(d.observacoes);
  if ('ativo' in d)       r.ativo = !!d.ativo;
  return r;
}

function camposBalconista(d, criando) {
  const r = {};
  if (criando)                r.empresa_id = d.empresa_id;
  if ('nome_completo' in d)   r.nome_completo = String(d.nome_completo ?? '').trim().replace(/\s+/g, ' ');
  if ('cpf' in d)             r.cpf = soDigitos(d.cpf);
  if ('data_nascimento' in d) r.data_nascimento = d.data_nascimento || null;
  if ('email' in d)           r.email = String(d.email ?? '').trim().toLowerCase();
  if ('telefone' in d)        r.telefone = soDigitos(d.telefone);
  if ('ativo' in d)           r.ativo = !!d.ativo;
  return r;
}

export const cadastros = {
  get carregado() { return carregado; },

  get erro() { return ultimoErro; },

  async carregar() {
    try {
      const [emp, bal] = await Promise.all([lerTudo('empresas', 'nome'), lerTudo('balconistas', 'nome_completo')]);
      empresasMap = new Map(emp.map(e => [String(e.id), e]));
      balconistasMap = new Map(bal.map(b => [String(b.id), b]));
      porEmpresa = null;
    } catch (e) {
      ultimoErro = e.message;
      avisar({ tipo: 'erro' });
      throw e;
    }
    ultimoErro = null;
    carregado = true;
    avisar({ tipo: 'carga' });
  },

  empresas({ inativas = false } = {}) {
    return [...empresasMap.values()]
      .filter(e => inativas || e.ativo)
      .sort((a, b) => ordemPt(a.nome, b.nome));
  },

  empresa(id) { return id == null ? null : empresasMap.get(String(id)) || null; },

  balconista(id) { return id == null ? null : balconistasMap.get(String(id)) || null; },

  balconistasDa(empresaId, { inativos = false } = {}) {
    if (!porEmpresa) {
      porEmpresa = new Map();
      for (const b of balconistasMap.values()) {
        const k = String(b.empresa_id);
        if (!porEmpresa.has(k)) porEmpresa.set(k, []);
        porEmpresa.get(k).push(b);
      }
      for (const l of porEmpresa.values()) l.sort((a, b) => ordemPt(a.nome_completo, b.nome_completo));
    }
    const lista = porEmpresa.get(String(empresaId)) || [];
    return inativos ? [...lista] : lista.filter(b => b.ativo);
  },

  async salvarEmpresa(dados, id = null) {
    const campos = camposEmpresa(dados);
    const linha = exigir(id == null
      ? await sb.from('empresas').insert(campos).select('*').single()
      : await sb.from('empresas').update(campos).eq('id', id).select('*').single());
    empresasMap.set(String(linha.id), linha);
    avisar({ tipo: 'empresa', id: linha.id, registro: linha });
    return linha;
  },

  async salvarBalconista(dados, id = null) {
    const campos = camposBalconista(dados, id == null);
    const linha = exigir(id == null
      ? await sb.from('balconistas').insert(campos).select('*').single()
      : await sb.from('balconistas').update(campos).eq('id', id).select('*').single());
    balconistasMap.set(String(linha.id), linha);
    porEmpresa = null;
    avisar({ tipo: 'balconista', id: linha.id, registro: linha });
    return linha;
  },

  assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },

  // Mudanças feitas por outras pessoas chegam sozinhas.
  aoVivo() {
    if (canal) return;
    const aplicar = (tabela, mapa, tipo) => async p => {
      const id = p.new?.id ?? p.old?.id;
      if (id == null) return;
      const r = await sb.from(tabela).select('*').eq('id', id).maybeSingle();
      if (r.error) return;
      if (r.data) mapa.set(String(id), r.data); else mapa.delete(String(id));
      if (mapa === balconistasMap) porEmpresa = null;
      avisar({ tipo, id, registro: r.data, origem: 'remota' });
    };
    canal = sb.channel('cadastros-ao-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'empresas' }, aplicar('empresas', empresasMap, 'empresa'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'balconistas' }, aplicar('balconistas', balconistasMap, 'balconista'))
      .subscribe();
  },

  parar() {
    if (canal) { sb.removeChannel(canal); canal = null; }
    ouvintes.clear();
    empresasMap = new Map();
    balconistasMap = new Map();
    porEmpresa = null;
    carregado = false;
    ultimoErro = null;
  },
};
