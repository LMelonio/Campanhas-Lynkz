// Comissões: cadastro de comissionados, parâmetros, premiações e dados do PJ no mês, consulta ao Qlik e apuração.
// Só o administrador lê e grava (RLS da migração 16). O cálculo é de lib/comissoes.js (puro, com teste);
// este módulo junta banco + Qlik + cálculo para a tela pedir só "apure este mês".
import { sb } from '../lib/supabase.js';
import { exigir, ErroApp } from './erros.js';
import { PARAMETROS_PADRAO, periodoApuracao, mesAnteriorFechado, nomeQlik, chaveNome, apurarMes, cadastroDaCopia,
  regrasFornecedores, regrasDaCopia, excecoesLegado, pctSecundario, pctPadrao, nomeLegivel } from '../lib/comissoes.js';

const NUMEROS_PARAMETROS = Object.keys(PARAMETROS_PADRAO).filter(k => typeof PARAMETROS_PADRAO[k] === 'number');
const NUMEROS_CADASTRO = ['pct_principal', 'pct_farelo', 'acordo_minimo', 'meta_faturamento', 'meta_positivacao'];
const CAMPOS = ['nome', 'regime', 'equipe', 'pct_principal', 'pct_farelo', 'nomes_qlik', 'email',
  'acordo_minimo', 'acordo_inicio', 'acordo_fim', 'meta_faturamento', 'meta_positivacao',
  'pj_razao_social', 'pj_documento', 'pj_pix', 'pj_banco', 'adp_observacao', 'ativo'];

// numeric do Postgres pode chegar como texto: tudo vira número aqui.
const numero = v => (v === null || v === undefined || v === '' ? null : Number(v));
const NUMEROS_OUTROS = ['pct_outros_clt', 'pct_outros_televendas', 'pct_outros_pj'];
const NUMEROS_FORNECEDOR = ['pct_clt', 'pct_televendas', 'pct_pj'];
const lerFornecedor = f => { const r = { ...f }; for (const k of NUMEROS_FORNECEDOR) r[k] = numero(r[k]); return r; };
function lerParametros(linha) {
  const p = { ...PARAMETROS_PADRAO, ...(linha || {}) };
  for (const k of NUMEROS_PARAMETROS) p[k] = Number(p[k]);
  for (const k of NUMEROS_OUTROS) p[k] = numero(p[k]);
  p.principal_modo = p.principal_modo === 'lista' ? 'lista' : 'todos';
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
let fornecedores = null;     // comissao_fornecedores (migração 21); null = ainda sem a tabela (vale o Farelo dos Parâmetros)
let excecoes = [];           // comissao_excecoes, com o código do fornecedor: [{ id, comissionado_id, fornecedor_id, codigo, pct }]
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
  const corpo = await postarQlik({ apuracao_inicio: ap.inicio, apuracao_fim: ap.fim, contrato_inicio: ct.inicio, contrato_fim: ct.fim }, sinal);
  const q = { ...corpo, dia_corte: params.dia_corte };
  const gravada = await gravarConsulta(mes, q);
  return gravada ? { ...q, consultado_em: gravada.consultado_em, gravada: true } : q;
}

// Grava a consulta do mês (uma linha por mês). Se não der, a apuração segue com a da memória.
async function gravarConsulta(mes, q) {
  const dados = { formato: q.formato || 1, apuracao: q.apuracao, contrato: q.contrato, dia_corte: q.dia_corte, ...(q.cod_farelo ? { cod_farelo: q.cod_farelo } : {}) };
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
    const [linhas, p, f, e] = await Promise.all([
      sb.from('comissionados').select('*').order('nome'),
      sb.from('comissao_parametros').select('*').eq('id', 1).maybeSingle(),
      sb.from('comissao_fornecedores').select('*').order('id'),
      sb.from('comissao_excecoes').select('*').order('id'),
    ]);
    lista = (exigir(linhas) || []).map(lerComissionado).sort(porNome);
    params = lerParametros(exigir(p));
    // Sem a migração 21, o app segue com o Farelo dos Parâmetros e o pct_farelo de cada pessoa.
    if (f.error && !semTabela(f.error)) exigir(f);
    fornecedores = f.error ? null : (f.data || []).map(lerFornecedor);
    const codigoDe = new Map((fornecedores || []).map(x => [x.id, x.codigo]));
    excecoes = e.error ? [] : (e.data || []).map(x => ({ ...x, pct: Number(x.pct), codigo: codigoDe.get(x.fornecedor_id) }));
  },
  cadastro: () => lista || [],
  parametros: () => params || lerParametros(null),
  // Tem a tabela de fornecedores (migração 21)? Sem ela, a tela de Parâmetros mostra o Farelo antigo.
  temFornecedores: () => fornecedores != null,
  fornecedores: () => fornecedores || [],
  // Exceções de uma pessoa (ou de todas): [{ comissionado_id, fornecedor_id, codigo, pct }].
  excecoes: (comissionadoId = null) => (comissionadoId == null ? excecoes : excecoes.filter(x => String(x.comissionado_id) === String(comissionadoId))),
  // Regras de fornecedor de hoje para um mês (vale_de <= mês).
  regras(mes) { return regrasFornecedores(this.parametros(), fornecedores, mes); },
  // Exceções que valem no cálculo: as da tabela (21) ou, sem ela, o pct_farelo de cada pessoa.
  excecoesDoCalculo(cadastro = lista || []) {
    return fornecedores == null ? excecoesLegado(cadastro, this.parametros().cod_farelo) : excecoes;
  },

  // Secundário novo ou alterado. dados: { codigo, nome, grupo, pct_clt, pct_televendas, pct_pj, vale_de, ativo }.
  async salvarFornecedor(dados, id = null) {
    const campos = {};
    for (const k of ['nome', 'grupo', 'pct_clt', 'pct_televendas', 'pct_pj', 'vale_de', 'ativo']) if (k in dados) campos[k] = dados[k];
    if (id == null) campos.codigo = String(dados.codigo).trim();
    const linha = lerFornecedor(exigir(id == null
      ? await sb.from('comissao_fornecedores').insert(campos).select('*').single()
      : await sb.from('comissao_fornecedores').update(campos).eq('id', id).select('*').single()));
    fornecedores = [...(fornecedores || []).filter(x => x.id !== linha.id), linha].sort((a, b) => a.id - b.id);
    return linha;
  },
  // Lista do principal ("só estes fornecedores"): liga os códigos da lista e desliga os que saíram.
  async salvarListaPrincipal(codigos) {
    const quero = new Set(codigos.map(x => String(x).trim()).filter(Boolean));
    for (const f of this.fornecedores().filter(x => x.grupo === 'principal')) {
      if (quero.has(f.codigo) !== (f.ativo !== false)) await this.salvarFornecedor({ ativo: quero.has(f.codigo) }, f.id);
      quero.delete(f.codigo);
    }
    for (const codigo of quero) {
      const outro = this.fornecedores().find(x => x.codigo === codigo);
      if (outro) throw new ErroApp(`O fornecedor ${codigo} já é secundário (${outro.nome}). Tire-o dos secundários antes.`);
      await this.salvarFornecedor({ codigo, nome: `Fornecedor ${codigo}`, grupo: 'principal' });
    }
  },
  // % de um secundário só para uma pessoa. pct null = volta ao padrão do regime (ninguém apaga: grava o padrão).
  async salvarExcecao(comissionadoId, fornecedorId, pct) {
    const c = (lista || []).find(x => String(x.id) === String(comissionadoId));
    const f = this.fornecedores().find(x => x.id === fornecedorId);
    const atual = excecoes.find(x => String(x.comissionado_id) === String(comissionadoId) && x.fornecedor_id === fornecedorId);
    const padrao = c && f ? pctSecundario(c, regrasFornecedores(this.parametros(), [f]).secundarios[0], []) : null;
    const valor = pct == null ? padrao : pct;
    if (valor == null || (!atual && pct == null)) return null;
    if (atual && Number(atual.pct) === Number(valor)) return atual;
    const r = exigir(atual
      ? await sb.from('comissao_excecoes').update({ pct: valor }).eq('id', atual.id).select('*').single()
      : await sb.from('comissao_excecoes').insert({ comissionado_id: Number(comissionadoId), fornecedor_id: fornecedorId, pct: valor }).select('*').single());
    const linha = { ...r, pct: Number(r.pct), codigo: f?.codigo };
    excecoes = [...excecoes.filter(x => x.id !== linha.id), linha];
    return linha;
  },

  async salvar(dados, id = null) {
    const campos = camposComissionado(dados);
    // pct_farelo é obsoleto desde a 21, mas é obrigatório no banco e o rollback lê dele: grava o % efetivo do Farelo.
    if (fornecedores != null && !('pct_farelo' in dados)) campos.pct_farelo = this.pctFareloEfetivo({ ...(lista || []).find(x => x.id === id), ...dados, id });
    const linha = lerComissionado(exigir(id == null
      ? await sb.from('comissionados').insert(campos).select('*').single()
      : await sb.from('comissionados').update(campos).eq('id', id).select('*').single()));
    lista = [...(lista || []).filter(c => c.id !== linha.id), linha].sort(porNome);
    return linha;
  },

  // % do Farelo de uma pessoa (exceção, senão o padrão do regime): vai para a coluna obsoleta pct_farelo.
  pctFareloEfetivo(c) {
    const p = this.parametros();
    const f = this.fornecedores().find(x => x.codigo === p.cod_farelo && x.grupo === 'secundario');
    const pct = f ? pctSecundario(c, regrasFornecedores(p, [f]).secundarios[0], c.id == null ? [] : excecoes) : null;
    return pct ?? pctPadrao(c.regime, p).farelo;
  },

  async salvarParametros(dados) {
    const campos = {};
    for (const k of [...NUMEROS_PARAMETROS, ...NUMEROS_OUTROS, 'principal_modo', 'cod_farelo', 'nomes_ignorados']) if (k in dados) campos[k] = dados[k];
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
  // Nome do fornecedor nas consultas do Qlik já lidas (formato 2), para sugerir no diálogo do secundário.
  nomeFornecedorNaConsulta(codigo) {
    if (!/^\d{1,10}$/.test(String(codigo || ''))) return '';
    const fontes = [...consultas.values(), ...[...doMes.values()].map(m => m.consulta?.dados).filter(Boolean)];
    for (const q of fontes) {
      const v = (q.apuracao?.vendas || []).find(x => String(x.cod_fornecedor) === String(codigo) && x.fornecedor);
      if (v) return nomeLegivel(v.fornecedor);
    }
    return '';
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
  // Regras de fornecedor e exceções do mês: as de hoje; no mês reaberto, as da cópia do fechamento
  // (cópia de antes da 3.6: o Farelo dos parâmetros e o pct_farelo do cadastro copiados).
  calculoDoMes(mes) {
    if (this.usaCadastroDaCopia(mes)) {
      const d = this.fechamento(mes).dados;
      if (d.resultado?.regras) return { regras: regrasDaCopia(d.resultado.regras), excecoes: d.excecoes || [] };
      const p = { ...PARAMETROS_PADRAO, ...(d.parametros || {}) };
      return { regras: regrasFornecedores(p, null, mes), excecoes: excecoesLegado(this.cadastroDoMes(mes), p.cod_farelo) };
    }
    return { regras: this.regras(mes), excecoes: this.excecoesDoCalculo(this.cadastroDoMes(mes)) };
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
      // Regras de fornecedor usadas (também em resultado.regras) e as exceções: reabrir calcula com elas.
      fornecedores: this.fornecedores(), excecoes: this.calculoDoMes(mes).excecoes.filter(x => ids.has(x.comissionado_id)),
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
  // gravada no banco (null se não houver). Consulta com outro corte (ou antiga, com outro código de Farelo) não é reaproveitada.
  // Fornecedores: a consulta vem por fornecedor (formato 2); quem é principal ou secundário é de lib/comissoes.js.
  // → resultado de apurarMes + { consulta: { consultado_em, total, sem_vendedor, gravada } }
  async apurar(mes, { buscar = true, sinal } = {}) {
    if (!params) await this.carregar();
    if (!doMes.has(mes)) await this.carregarMes(mes);
    const f = this.fechamento(mes);
    if (f?.status === 'fechado' && f.dados?.resultado) return { ...f.dados.resultado, fechado: f };
    let q = consultas.get(mes) || daConsultaGravada(this.consulta(mes));
    // Consulta antiga (formato 1) só serve com o mesmo código do Farelo; a do formato 2 é por fornecedor.
    if (q && (q.dia_corte !== params.dia_corte || (q.formato !== 2 && q.cod_farelo !== params.cod_farelo))) q = null;
    if (buscar) { q = await pedirAoQlik(mes, sinal); consultas.set(mes, q); }
    if (!q) return null;
    const m = doMes.get(mes);
    const { regras, excecoes: exc } = this.calculoDoMes(mes);
    const r = apurarMes({ mes, comissionados: this.cadastroDoMes(mes), parametros: params, vendas: q.apuracao.vendas, contratoLinhas: q.contrato.linhas,
      premiacoes: m.premiacoes, ajustes: m.ajustes, mesPj: m.mesPj, regras, excecoes: exc });
    return { ...r, consulta: { consultado_em: q.consultado_em, total: q.apuracao.total, sem_vendedor: Number(q.apuracao.sem_vendedor) || 0, gravada: !!q.gravada } };
  },
};
