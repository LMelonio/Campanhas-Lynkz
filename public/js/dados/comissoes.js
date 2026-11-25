// Comissões: cadastro de comissionados, parâmetros, consulta ao Qlik e apuração do mês.
// Só o administrador lê e grava (RLS da migração 16). O cálculo é de lib/comissoes.js (puro, com teste);
// este módulo junta banco + Qlik + cálculo para a tela pedir só "apure este mês".
import { sb } from '../lib/supabase.js';
import { exigir, ErroApp } from './erros.js';
import { PARAMETROS_PADRAO, periodoApuracao, mesAnteriorFechado, nomeQlik, chaveNome, apurarMes } from '../lib/comissoes.js';

const NUMEROS_PARAMETROS = Object.keys(PARAMETROS_PADRAO).filter(k => typeof PARAMETROS_PADRAO[k] === 'number');
const NUMEROS_CADASTRO = ['pct_principal', 'pct_farelo', 'acordo_minimo', 'meta_faturamento', 'meta_positivacao'];
const CAMPOS = ['nome', 'regime', 'equipe', 'pct_principal', 'pct_farelo', 'nomes_qlik', 'email',
  'acordo_minimo', 'acordo_inicio', 'acordo_fim', 'meta_faturamento', 'meta_positivacao',
  'pj_razao_social', 'pj_documento', 'pj_pix', 'pj_banco', 'adp_observacao', 'ativo'];

// numeric do Postgres pode chegar como texto: tudo vira número aqui.
const numero = v => (v === null || v === undefined || v === '' ? null : Number(v));
function lerParametros(linha) {
  const p = { ...PARAMETROS_PADRAO, ...(linha || {}) };
  for (const k of NUMEROS_PARAMETROS) p[k] = Number(p[k]);
  p.cod_farelo = String(p.cod_farelo);
  p.nomes_ignorados = Array.isArray(p.nomes_ignorados) ? p.nomes_ignorados : [];
  return p;
}
function lerComissionado(c) {
  const r = { ...c };
  for (const k of NUMEROS_CADASTRO) r[k] = numero(r[k]);
  r.nomes_qlik = Array.isArray(r.nomes_qlik) ? r.nomes_qlik : [];
  return r;
}
// Só as colunas que o app grava; datas da meta e carimbos ficam com o banco.
// PJ não tem acordo; CLT não tem meta do Contrato; sem valor de acordo, sem vigência.
export function camposComissionado(d) {
  const r = {};
  for (const k of CAMPOS) if (k in d) r[k] = d[k] === '' || d[k] === undefined ? null : d[k];
  if (r.nomes_qlik) r.nomes_qlik = [...new Set(r.nomes_qlik.map(nomeQlik).filter(Boolean))];
  if (r.regime === 'PJ') Object.assign(r, { acordo_minimo: null, acordo_inicio: null, acordo_fim: null });
  else if (r.regime) Object.assign(r, { meta_faturamento: null, meta_positivacao: null });
  if (!r.acordo_minimo) Object.assign(r, { acordo_minimo: null, acordo_inicio: null, acordo_fim: null });
  return r;
}

const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
let lista = null;            // cadastro em memória
let params = null;           // parâmetros em memória
const consultas = new Map(); // mês → resposta do Qlik (a tela recalcula sem consultar de novo)

async function pedirAoQlik(mes, sinal) {
  const ap = periodoApuracao(mes, params.dia_corte);
  const ct = mesAnteriorFechado(mes);
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new ErroApp('Entre de novo no app para consultar o Qlik.');
  let resp;
  try {
    resp = await fetch('/api/qlik/comissoes', {
      method: 'POST', signal: sinal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ apuracao_inicio: ap.inicio, apuracao_fim: ap.fim, contrato_inicio: ct.inicio, contrato_fim: ct.fim, cod_farelo: params.cod_farelo }),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ErroApp('Sem conexão para consultar o Qlik. Confira a internet e tente de novo.');
  }
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErroApp(corpo.erro || 'Não foi possível consultar o Qlik agora.');
  return { ...corpo, cod_farelo: params.cod_farelo, dia_corte: params.dia_corte };
}

export const comissoes = {
  // Cadastro e parâmetros do banco para a memória. Chamar ao abrir a tela.
  async carregar() {
    const [linhas, p] = await Promise.all([
      sb.from('comissionados').select('*').order('nome'),
      sb.from('comissao_parametros').select('*').eq('id', 1).maybeSingle(),
    ]);
    lista = (exigir(linhas) || []).map(lerComissionado).sort(porNome);
    params = lerParametros(exigir(p));
  },
  cadastro: () => lista || [],
  parametros: () => params || lerParametros(null),

  async salvar(dados, id = null) {
    const campos = camposComissionado(dados);
    const linha = lerComissionado(exigir(id == null
      ? await sb.from('comissionados').insert(campos).select('*').single()
      : await sb.from('comissionados').update(campos).eq('id', id).select('*').single()));
    lista = [...(lista || []).filter(c => c.id !== linha.id), linha].sort(porNome);
    return linha;
  },

  async salvarParametros(dados) {
    const campos = {};
    for (const k of [...NUMEROS_PARAMETROS, 'cod_farelo', 'nomes_ignorados']) if (k in dados) campos[k] = dados[k];
    params = lerParametros(exigir(await sb.from('comissao_parametros').update(campos).eq('id', 1).select('*').single()));
    return params;
  },

  // "Este nome do Qlik também é desta pessoa."
  ligarNome(nome, comissionadoId) {
    const c = (lista || []).find(x => String(x.id) === String(comissionadoId));
    if (!c) throw new ErroApp('Pessoa não encontrada. Recarregue a página.');
    return this.salvar({ ...c, nomes_qlik: [...c.nomes_qlik, nome] }, c.id);
  },
  // "Este nome do Qlik não comissiona" (venda da empresa, por exemplo).
  ignorarNome(nome) {
    const atuais = this.parametros().nomes_ignorados;
    if (atuais.some(n => chaveNome(n) === chaveNome(nome))) return Promise.resolve(params);
    return this.salvarParametros({ nomes_ignorados: [...atuais, nomeQlik(nome)] });
  },

  // Apuração do mês com o cadastro e os parâmetros atuais.
  // buscar: true consulta o Qlik; false reaproveita a última consulta do mês (null se não houver).
  // Uma consulta feita com outro código de Farelo ou outro corte não é reaproveitada.
  // → resultado de apurarMes + { consulta: { consultado_em, total, sem_vendedor } }
  async apurar(mes, { buscar = true, sinal } = {}) {
    if (!params) await this.carregar();
    let q = consultas.get(mes);
    if (q && (q.cod_farelo !== params.cod_farelo || q.dia_corte !== params.dia_corte)) q = null;
    if (buscar) { q = await pedirAoQlik(mes, sinal); consultas.set(mes, q); }
    if (!q) return null;
    const r = apurarMes({ mes, comissionados: lista, parametros: params, vendas: q.apuracao.vendas, contratoLinhas: q.contrato.linhas });
    return { ...r, consulta: { consultado_em: q.consultado_em, total: q.apuracao.total, sem_vendedor: Number(q.apuracao.sem_vendedor) || 0 } };
  },
};
