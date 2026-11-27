// Empresas e balconistas. Todo usuário ativo lê e edita; desativar = ativo false. Só o administrador
// exclui balconista (excluir_balconista, migração 18), para liberar a vaga na empresa.
import { sb } from '../lib/supabase.js';
import { soDigitos, maskCNPJ } from '../lib/regras.js';
import { exigir } from './erros.js';

let empresasMap = new Map();
let balconistasMap = new Map();
let porEmpresa = null;   // índice empresa_id → balconistas (refeito quando algo muda)
let carregado = false;
// Empresas desativadas não vêm na abertura (E1): só quando alguém pede (Gestão → "Mostrar desativadas",
// ou uma tela procura uma empresa que não está carregada, como a de uma campanha antiga).
let inativasCarregadas = false;
let lendoInativas = null;
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
// só as colunas que as telas usam (sem criado_por, atualizado_em, atualizado_por).
// Coluna nova que a tela precise mostrar: acrescente aqui.
const COLUNAS = {
  empresas: 'id,nome,nome_fantasia,cnpj,cidade,uf,telefone,observacoes,ativo,codigo_cliente,vendedor,origem,sincronizado_em,criado_em',
  balconistas: 'id,empresa_id,nome_completo,cpf,data_nascimento,email,telefone,ativo',
};
async function lerTudo(tabela, ordem, filtrar = q => q) {
  const todas = [];
  for (let de = 0; ; de += BLOCO) {
    const parte = exigir(await filtrar(sb.from(tabela).select(COLUNAS[tabela] || '*')).order(ordem).order('id').range(de, de + BLOCO - 1)) || [];
    todas.push(...parte);
    if (parte.length < BLOCO) return todas;
  }
}

// Empresa que veio do Qlik: nome, CNPJ e cidade só mudam pela sincronização.
export const ehDoQlik = e => !!e?.codigo_cliente;

// Texto usado nas buscas de empresa (Gestão e Nova campanha).
export const textoBuscaEmpresa = (e, balcs = []) =>
  [e.nome, e.nome_fantasia, e.cidade, e.uf, e.cnpj, e.cnpj ? maskCNPJ(e.cnpj) : '', e.codigo_cliente, e.vendedor, ...balcs.map(b => b.nome_completo)].filter(Boolean).join(' ');

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

export function camposBalconista(d, criando) {
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
    const t0 = performance.now();
    try {
      // Balconistas: todos (o limite de 2 por empresa conta os desativados).
      const [emp, bal] = await Promise.all([
        lerTudo('empresas', 'nome', q => q.eq('ativo', true)),
        lerTudo('balconistas', 'nome_completo'),
      ]);
      empresasMap = new Map(emp.map(e => [String(e.id), e]));
      balconistasMap = new Map(bal.map(b => [String(b.id), b]));
      porEmpresa = null;
      inativasCarregadas = false;
      console.info(`cadastros: ${emp.length} empresas ativas e ${bal.length} balconistas em ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      ultimoErro = e.message;
      avisar({ tipo: 'erro' });
      throw e;
    }
    ultimoErro = null;
    carregado = true;
    avisar({ tipo: 'carga' });
  },

  // Lê as empresas desativadas uma vez; avisa as telas (que redesenham) quando chegarem.
  carregarInativas() {
    if (inativasCarregadas) return Promise.resolve();
    if (!lendoInativas) {
      lendoInativas = lerTudo('empresas', 'nome', q => q.eq('ativo', false))
        .then(l => { for (const e of l) if (!empresasMap.has(String(e.id))) empresasMap.set(String(e.id), e); inativasCarregadas = true; avisar({ tipo: 'carga' }); })
        .catch(e => console.warn('Empresas desativadas não carregaram', e))
        .finally(() => { lendoInativas = null; });
    }
    return lendoInativas;
  },

  empresas({ inativas = false } = {}) {
    if (inativas && !inativasCarregadas) this.carregarInativas();
    return [...empresasMap.values()]
      .filter(e => inativas || e.ativo)
      .sort((a, b) => ordemPt(a.nome, b.nome));
  },

  empresa(id) {
    if (id == null) return null;
    const e = empresasMap.get(String(id));
    if (!e && carregado && !inativasCarregadas) this.carregarInativas();   // talvez seja uma desativada
    return e || null;
  },

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

  // Só administrador (a regra está no banco). O banco barra campanha pendente, guarda a cópia
  // em balconistas_excluidos e solta o balconista das campanhas decididas.
  async excluirBalconista(id, motivo) {
    const r = exigir(await sb.rpc('excluir_balconista', { p_id: Number(id), p_motivo: motivo }));
    balconistasMap.delete(String(id));
    porEmpresa = null;
    avisar({ tipo: 'balconista', id, registro: null });
    return r;
  },

  // Depois de gravar um balconista por fora (enviar_campanha): traz a linha para a memória.
  async relerBalconista(id) {
    const linha = exigir(await sb.from('balconistas').select('*').eq('id', id).maybeSingle());
    if (!linha) return null;
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
