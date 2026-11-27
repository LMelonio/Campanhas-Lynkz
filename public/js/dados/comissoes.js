// Comissões: cadastro de comissionados, parâmetros, premiações e dados do PJ no mês, consulta ao Qlik e apuração.
// Só o administrador lê e grava (RLS da migração 16). O cálculo é de lib/comissoes.js (puro, com teste);
// este módulo junta banco + Qlik + cálculo para a tela pedir só "apure este mês".
import { sb } from '../lib/supabase.js';
import { exigir, ErroApp } from './erros.js';
import { PARAMETROS_PADRAO, periodoApuracao, mesAnteriorFechado, nomeQlik, chaveNome, apurarMes, cadastroDaCopia } from '../lib/comissoes.js';

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
const consultas = new Map(); // mês → resposta do Qlik desta sessão (a tela recalcula sem consultar de novo)
const doMes = new Map();     // mês → { premiacoes: [], ajustes: [], mesPj: [], fechamento, consulta } do banco

const lerPremiacao = r => ({ ...r, valor: Number(r.valor) });
const lerMesPj = r => {
  const x = { ...r };
  for (const k of ['meta_faturamento', 'meta_positivacao', 'realizado_faturamento', 'realizado_positivacao', 'nf_valor']) x[k] = numero(x[k]);
  return x;
};
const lerFechamento = r => (r ? { ...r, total: Number(r.total), total_clt: Number(r.total_clt), total_pj: Number(r.total_pj) } : null);
const COLUNAS_HISTORICO = 'id,mes,status,total,total_clt,total_pj,fechado_em,fechado_por,reaberto_em,motivo_reabertura';
const vazioMes = () => ({ premiacoes: [], ajustes: [], mesPj: [], fechamento: null, consulta: null });
const doMesOuNovo = mes => doMes.get(mes) || doMes.set(mes, vazioMes()).get(mes);
// Consulta gravada (migração 19) no formato da resposta do Qlik.
const daConsultaGravada = c => (c?.dados?.apuracao ? { ...c.dados, consultado_em: c.consultado_em, gravada: true } : null);
// Tabela da migração 19 ainda não criada: o app segue como antes (consulta só na memória).
const semTabela = e => ['PGRST205', '42P01'].includes(e?.code);
async function postarQlik(corpo, sinal) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new ErroApp('Entre de novo no app para consultar o Qlik.');
  let resp;
  try {
    resp = await fetch('/api/qlik/comissoes', {
      method: 'POST', signal: sinal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(corpo),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ErroApp('Sem conexão para consultar o Qlik. Confira a internet e tente de novo.');
  }
  const r = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErroApp(r.erro || 'Não foi possível consultar o Qlik agora.');
  return r;
}

async function pedirAoQlik(mes, sinal) {
  const ap = periodoApuracao(mes, params.dia_corte);
  const ct = mesAnteriorFechado(mes);
  const corpo = await postarQlik({ apuracao_inicio: ap.inicio, apuracao_fim: ap.fim, contrato_inicio: ct.inicio, contrato_fim: ct.fim, cod_farelo: params.cod_farelo }, sinal);
  const q = { ...corpo, cod_farelo: params.cod_farelo, dia_corte: params.dia_corte };
  const gravada = await gravarConsulta(mes, q);
  return gravada ? { ...q, consultado_em: gravada.consultado_em, gravada: true } : q;
}

// Grava a consulta do mês (uma linha por mês). Se não der, a apuração segue com a da memória.
async function gravarConsulta(mes, q) {
  const dados = { apuracao: q.apuracao, contrato: q.contrato, cod_farelo: q.cod_farelo, dia_corte: q.dia_corte };
  const atual = doMes.get(mes)?.consulta;
  const tabela = () => sb.from('comissao_consultas');
  let r = atual
    ? await tabela().update({ dados }).eq('id', atual.id).select('*').single()
    : await tabela().insert({ mes, dados }).select('*').single();
  if (!atual && r.error?.code === '23505') r = await tabela().update({ dados }).eq('mes', mes).select('*').single();   // outra pessoa gravou antes
  if (r.error) {
    if (!semTabela(r.error)) console.warn('Consulta do Qlik não foi gravada', r.error);
    return null;
  }
  doMesOuNovo(mes).consulta = r.data;
  return r.data;
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

  // "Este nome do Qlik não comissiona" (venda da empresa, por exemplo). Vários de uma vez: uma gravação só.
  ignorarNomes(nomes) {
    const lista = [...this.parametros().nomes_ignorados];
    for (const n of nomes.map(nomeQlik).filter(Boolean)) if (!lista.some(x => chaveNome(x) === chaveNome(n))) lista.push(n);
    if (lista.length === this.parametros().nomes_ignorados.length) return Promise.resolve(params);
    return this.salvarParametros({ nomes_ignorados: lista });
  },
  ignorarNome(nome) { return this.ignorarNomes([nome]); },

  // ---------- o mês: premiações e dados do PJ (metas, realizado informado, NF) ----------
  // Lê do banco as premiações e os dados do PJ do mês. A tela chama ao trocar de mês.
  async carregarMes(mes) {
    const [p, a, m, f, q] = await Promise.all([
      sb.from('comissao_premiacoes').select('*').eq('mes', mes).order('id'),
      sb.from('comissao_ajustes').select('*').eq('mes', mes).order('id'),
      sb.from('comissao_mes_pj').select('*').eq('mes', mes),
      sb.from('comissao_fechamentos').select('*').eq('mes', mes).maybeSingle(),
      sb.from('comissao_consultas').select('*').eq('mes', mes).maybeSingle(),
    ]);
    if (q.error && !semTabela(q.error)) console.warn('Consulta gravada do Qlik não foi lida', q.error);
    doMes.set(mes, { premiacoes: (exigir(p) || []).map(lerPremiacao), ajustes: (exigir(a) || []).map(lerPremiacao),
      mesPj: (exigir(m) || []).map(lerMesPj), fechamento: lerFechamento(exigir(f)), consulta: q.error ? null : q.data });
    return doMes.get(mes);
  },
  // Consulta ao Qlik gravada do mês (migração 19) ou null: { consultado_em, conferido_em, … }.
  consulta: mes => doMes.get(mes)?.consulta || null,
  // Mês reaberto calcula com o cadastro de quando foi fechado (mudanças de % depois não voltam no tempo).
  usaCadastroDaCopia(mes) {
    const f = this.fechamento(mes);
    return f?.status === 'reaberto' && Array.isArray(f.dados?.cadastro);
  },
  cadastroDoMes(mes) {
    if (!this.usaCadastroDaCopia(mes)) return lista || [];
    return cadastroDaCopia(this.fechamento(mes).dados.cadastro.map(lerComissionado), lista || []).sort(porNome);
  },
  premiacoes: mes => (doMes.get(mes)?.premiacoes || []).filter(x => x.ativo !== false),
  ajustes: mes => (doMes.get(mes)?.ajustes || []).filter(x => x.ativo !== false),
  // Fechamento do mês (com a cópia) ou null. fechado(mes): está no histórico e travado.
  fechamento: mes => doMes.get(mes)?.fechamento || null,
  fechado(mes) { return this.fechamento(mes)?.status === 'fechado'; },
  mesPj: (mes, comissionadoId) => (doMes.get(mes)?.mesPj || []).find(x => String(x.comissionado_id) === String(comissionadoId)) || null,

  async lancarPremiacao({ mes, comissionado_id, descricao, valor }) {
    const r = lerPremiacao(exigir(await sb.from('comissao_premiacoes')
      .insert({ mes, comissionado_id: Number(comissionado_id), descricao: String(descricao).trim(), valor }).select('*').single()));
    const m = doMes.get(mes) || vazioMes();
    m.premiacoes = [...m.premiacoes, r];
    doMes.set(mes, m);
    return r;
  },
  // Ajuste: acréscimo (+) ou desconto (−) fora da regra, com motivo. Entra depois do acordo mínimo.
  async lancarAjuste({ mes, comissionado_id, motivo, valor }) {
    const r = lerPremiacao(exigir(await sb.from('comissao_ajustes')
      .insert({ mes, comissionado_id: Number(comissionado_id), motivo: String(motivo).trim(), valor }).select('*').single()));
    const m = doMes.get(mes) || vazioMes();
    m.ajustes = [...m.ajustes, r];
    doMes.set(mes, m);
    return r;
  },
  async removerAjuste(mes, id) {
    exigir(await sb.from('comissao_ajustes').update({ ativo: false }).eq('id', id).select('id').single());
    const m = doMes.get(mes);
    if (m) m.ajustes = m.ajustes.map(x => (x.id === id ? { ...x, ativo: false } : x));
  },
  // Ninguém apaga: a premiação sai desativada (fica na auditoria).
  async removerPremiacao(mes, id) {
    exigir(await sb.from('comissao_premiacoes').update({ ativo: false }).eq('id', id).select('id').single());
    const m = doMes.get(mes);
    if (m) m.premiacoes = m.premiacoes.map(x => (x.id === id ? { ...x, ativo: false } : x));
  },

  // Grava os campos do PJ no mês (cria a linha na primeira vez).
  // campos: meta_faturamento, meta_positivacao, realizado_faturamento, realizado_positivacao, realizado_motivo, nf_numero.
  async salvarMesPj(mes, comissionadoId, campos) {
    const atual = this.mesPj(mes, comissionadoId);
    const r = lerMesPj(exigir(atual
      ? await sb.from('comissao_mes_pj').update(campos).eq('id', atual.id).select('*').single()
      : await sb.from('comissao_mes_pj').insert({ mes, comissionado_id: Number(comissionadoId), ...campos }).select('*').single()));
    const m = doMes.get(mes) || vazioMes();
    m.mesPj = [...m.mesPj.filter(x => x.id !== r.id), r];
    doMes.set(mes, m);
    return r;
  },

  // Vendas do período linha a linha (aba "Base Qlik" do Excel). Consulta pesada: só ao baixar o Excel.
  async buscarBase(mes, { sinal } = {}) {
    if (!params) await this.carregar();
    const ap = periodoApuracao(mes, params.dia_corte);
    const r = await postarQlik({ apuracao_inicio: ap.inicio, apuracao_fim: ap.fim, base: true }, sinal);
    return r.base;
  },

  // ---------- histórico ----------
  // Meses fechados ou reabertos, sem a cópia (leve). → [{ mes, status, total, total_clt, total_pj, fechado_em, … }]
  async historico() {
    return (exigir(await sb.from('comissao_fechamentos').select(COLUNAS_HISTORICO).order('mes', { ascending: false })) || []).map(lerFechamento);
  },
  // Fecha o mês com a apuração da tela: grava a cópia do que foi pago (cálculo, cadastro usado,
  // premiações, ajustes e parâmetros). Mês reaberto: troca a cópia.
  async fecharMes(resultado) {
    const mes = resultado.mes;
    const ids = new Set(resultado.linhas.map(l => l.id));
    const dados = {
      resultado, parametros: this.parametros(),
      cadastro: this.cadastroDoMes(mes).filter(c => ids.has(c.id)),
      premiacoes: this.premiacoes(mes), ajustes: this.ajustes(mes),
    };
    const campos = { status: 'fechado', dados, total: resultado.totais.geral.valor_pagar, total_clt: resultado.totais.clt.valor_pagar, total_pj: resultado.totais.pj.valor_pagar };
    const atual = this.fechamento(mes);
    const r = lerFechamento(exigir(atual
      ? await sb.from('comissao_fechamentos').update(campos).eq('id', atual.id).select('*').single()
      : await sb.from('comissao_fechamentos').insert({ mes, ...campos }).select('*').single()));
    doMesOuNovo(mes).fechamento = r;
    return r;
  },
  async reabrirMes(mes, motivo) {
    const atual = this.fechamento(mes);
    if (!atual) throw new ErroApp('Este mês não está no histórico.');
    const r = lerFechamento(exigir(await sb.from('comissao_fechamentos').update({ status: 'reaberto', motivo_reabertura: motivo }).eq('id', atual.id).select('*').single()));
    doMes.get(mes).fechamento = r;
    return r;
  },
  // O que os documentos do mês usam: a cópia do histórico (mês fechado) ou o que está no banco agora.
  contextoDocumentos(mes) {
    const f = this.fechamento(mes);
    if (f?.status === 'fechado' && f.dados) {
      const d = f.dados;
      return { cadastro: d.cadastro || [], premiacoes: d.premiacoes || [], ajustes: d.ajustes || [], parametros: { ...PARAMETROS_PADRAO, ...(d.parametros || {}) }, fechado: true };
    }
    return { cadastro: this.cadastroDoMes(mes), premiacoes: this.premiacoes(mes), ajustes: this.ajustes(mes), parametros: this.parametros(), fechado: false };
  },

  // Apuração do mês com o cadastro e os parâmetros atuais.
  // Mês fechado: devolve a cópia do histórico (não consulta o Qlik nem recalcula).
  // Mês reaberto: cadastro da cópia do fechamento (cadastroDoMes), completado com quem é novo.
  // buscar: true consulta o Qlik (e grava); false reaproveita a última consulta do mês, da memória ou a
  // gravada no banco (null se não houver). Uma consulta feita com outro código de Farelo ou outro corte não é reaproveitada.
  // → resultado de apurarMes + { consulta: { consultado_em, total, sem_vendedor, gravada } }
  async apurar(mes, { buscar = true, sinal } = {}) {
    if (!params) await this.carregar();
    if (!doMes.has(mes)) await this.carregarMes(mes);
    const f = this.fechamento(mes);
    if (f?.status === 'fechado' && f.dados?.resultado) return { ...f.dados.resultado, fechado: f };
    let q = consultas.get(mes) || daConsultaGravada(this.consulta(mes));
    if (q && (q.cod_farelo !== params.cod_farelo || q.dia_corte !== params.dia_corte)) q = null;
    if (buscar) { q = await pedirAoQlik(mes, sinal); consultas.set(mes, q); }
    if (!q) return null;
    const m = doMes.get(mes);
    const r = apurarMes({ mes, comissionados: this.cadastroDoMes(mes), parametros: params, vendas: q.apuracao.vendas, contratoLinhas: q.contrato.linhas,
      premiacoes: m.premiacoes, ajustes: m.ajustes, mesPj: m.mesPj });
    return { ...r, consulta: { consultado_em: q.consultado_em, total: q.apuracao.total, sem_vendedor: Number(q.apuracao.sem_vendedor) || 0, gravada: !!q.gravada } };
  },
};
