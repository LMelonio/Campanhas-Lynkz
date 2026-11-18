// ============================================================
//  NOVA CAMPANHA
//  - Empresa pelo cadastro (combo), com "Cadastrar a empresa …".
//  - "Quem recebe a premiação": obrigatório com pagamento Swile, opcional
//    na mecânica "Campanha de balconista". Escolher um balconista preenche
//    os 5 dados; mudar algum oferece atualizar o cadastro.
//  - Rascunho no localStorage SEM os 5 dados pessoais (guarda empresa e o
//    balconista escolhido, que voltam preenchidos do cadastro).
//  - O formulário nunca é redesenhado por evento externo.
// ============================================================
import { html, pintar, $, $$, ao, debounce, armazenamento } from '../lib/dom.js';
import {
  calc, banda, brl, pct, lerValor, valorCampo, soDigitos, normaliza, maskCPF, maskTelefone,
  errosRecebedor, hojeCivil, STATUS,
} from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { regua, FAIXAS } from '../ui/pecas.js';
import { campo, selecao, areaTexto, interruptor, ligarMascaras, aplicarErros, limparErro, marcarErro } from '../ui/campos.js';
import { combo } from '../ui/combo.js';
import { dialogoEmpresa } from '../ui/cadastro-dialogos.js';

const C = window.CONFIG;
const CHAVE_RASCUNHO = 'lynkz_rascunho_campanha_v2';
const CHAVE_RASCUNHO_V1 = 'lynkz_rascunho_campanha';
export const CHAVE_EMPRESA_SUGERIDA = 'lynkz_nova_empresa';
const SWILE = 'Swile';                               // mesma grafia de PAGTO e da constraint do banco
const TIPO_BALCONISTA = 'Campanha de balconista';
// Formas de pagamento em que o dinheiro sai do caixa LYNKZ na hora.
const PAGTO_EXIGE_INVESTIMENTO = ['Depósito / verba', SWILE];

// Os 5 dados pessoais: nunca vão para o rascunho.
const PESSOAIS = {
  nome_completo: 'n-rec-nome_completo', cpf: 'n-rec-cpf', data_nascimento: 'n-rec-data_nascimento',
  email: 'n-rec-email', telefone: 'n-rec-telefone',
};
const IDS_PESSOAIS = Object.values(PESSOAIS);

// Grava já o que estiver esperando o atraso (usado antes de sair da conta).
export function gravarRascunhoAgora() {
  if (st && !st.enviado) salvarRascunho();
}

export function temRascunho() {
  return !!lerRascunho();
}

export function limparRascunho() {
  armazenamento.remover(CHAVE_RASCUNHO);
  armazenamento.remover(CHAVE_RASCUNHO_V1);   // rascunho da v1, se sobrou
}

let st = null;

const v = id => ($('#' + id, st.el)?.value ?? '').trim();
const num = id => lerValor(v(id));
const marcado = id => !!$('#' + id, st.el)?.checked;

// ---------- quem recebe ----------
function recebedorVisivel() {
  return v('n-pagamento') === SWILE || v('n-tipo') === TIPO_BALCONISTA;
}
const recebedorObrigatorio = () => v('n-pagamento') === SWILE;

function lerRecebedor() {
  return Object.fromEntries(Object.entries(PESSOAIS).map(([k, id]) => [k, v(id)]));
}

function preencherRecebedor(d = {}) {
  $('#' + PESSOAIS.nome_completo, st.el).value = d.nome_completo || '';
  $('#' + PESSOAIS.cpf, st.el).value = d.cpf ? maskCPF(d.cpf) : '';
  $('#' + PESSOAIS.data_nascimento, st.el).value = d.data_nascimento || '';
  $('#' + PESSOAIS.email, st.el).value = d.email || '';
  $('#' + PESSOAIS.telefone, st.el).value = d.telefone ? maskTelefone(d.telefone) : '';
  IDS_PESSOAIS.forEach(id => limparErro(st.el, id));
}

function diferente(balc, d) {
  if (!balc) return false;
  return balc.nome_completo.trim() !== d.nome_completo.trim().replace(/\s+/g, ' ')
    || balc.cpf !== soDigitos(d.cpf)
    || (balc.data_nascimento || '') !== d.data_nascimento
    || balc.email.toLowerCase() !== d.email.trim().toLowerCase()
    || balc.telefone !== soDigitos(d.telefone);
}

function pessoaPadrao(balcs) {
  if (balcs.length === 1) return String(balcs[0].id);
  if (recebedorObrigatorio()) return balcs.length ? null : 'outra';
  return 'nenhuma';
}

function balconistaEscolhido() {
  const p = st.pessoa;
  return p && p !== 'outra' && p !== 'nenhuma' ? st.ctx.cadastros.balconista(p) : null;
}

// Desenha só o bloco "Quem recebe" (eventos do próprio formulário).
function desenharRecebedor({ dados = null } = {}) {
  const bloco = $('#bloco-recebedor', st.el);
  const corpo = $('#recebedor-corpo', st.el);
  const visivel = recebedorVisivel();
  bloco.hidden = !visivel;
  if (!visivel) { pintar(corpo, ''); return; }

  const obrig = recebedorObrigatorio();
  const empresaId = st.comboEmpresa.valor();
  pintar($('#recebedor-titulo', st.el), html`Quem recebe a premiação${obrig ? html`<span class="selo selo-neutro">${icone('cadeado')}Obrigatório com Swile</span>` : html`<span class="campo-opcional">(opcional)</span>`}`);

  if (!empresaId) {
    st.pessoa = null;
    pintar(corpo, html`<p class="nota" data-campo="n-pessoa">${icone('info')}<span>Escolha a empresa acima para ver os balconistas cadastrados nela.</span></p>
      <p class="campo-erro" id="n-pessoa-erro" hidden></p>`);
    return;
  }

  const balcs = st.ctx.cadastros.balconistasDa(empresaId);
  const validas = new Set([...balcs.map(b => String(b.id)), 'outra', ...(obrig ? [] : ['nenhuma'])]);
  if (!validas.has(st.pessoa)) st.pessoa = pessoaPadrao(balcs);
  const p = st.pessoa;

  pintar(corpo, html`
    <fieldset class="campo pessoas" data-campo="n-pessoa" aria-describedby="n-pessoa-erro">
      <legend>${balcs.length ? 'Escolha o balconista' : 'Nenhum balconista cadastrado nesta empresa'}</legend>
      ${balcs.map(b => html`<label class="pessoa"><input type="radio" name="n-pessoa" value="${b.id}"${p === String(b.id) ? html` checked` : ''}>
        <span class="pessoa-nome">${b.nome_completo}<small>CPF ${maskCPF(b.cpf)} · ${maskTelefone(b.telefone)}</small></span></label>`)}
      <label class="pessoa"><input type="radio" name="n-pessoa" value="outra"${p === 'outra' ? html` checked` : ''}>
        <span class="pessoa-nome">${balcs.length ? 'Outra pessoa' : 'Cadastrar quem recebe'}<small>Preencha os dados abaixo</small></span></label>
      ${obrig ? '' : html`<label class="pessoa"><input type="radio" name="n-pessoa" value="nenhuma"${p === 'nenhuma' ? html` checked` : ''}>
        <span class="pessoa-nome">Não informar agora</span></label>`}
      <p class="campo-erro" id="n-pessoa-erro" hidden></p>
    </fieldset>

    <div id="rec-dados"${p && p !== 'nenhuma' ? '' : html` hidden`}>
      ${st.rascunhoSemPessoais ? html`<p class="nota">${icone('cadeado')}<span>Por segurança, os dados pessoais não ficam no rascunho. Preencha de novo.</span></p>` : ''}
      ${campo({ id: PESSOAIS.nome_completo, rotulo: 'Nome completo', obrigatorio: true, atributos: { autocomplete: 'off' } })}
      <div class="grade-2 quebra">
        ${campo({ id: PESSOAIS.cpf, rotulo: 'CPF', mascara: 'cpf', obrigatorio: true })}
        ${campo({ id: PESSOAIS.data_nascimento, rotulo: 'Nascimento', tipo: 'date', obrigatorio: true, atributos: { max: hojeCivil() } })}
      </div>
      ${campo({ id: PESSOAIS.email, rotulo: 'E-mail', tipo: 'email', obrigatorio: true, atributos: { inputmode: 'email', autocomplete: 'off' } })}
      ${campo({ id: PESSOAIS.telefone, rotulo: 'Telefone', mascara: 'tel', obrigatorio: true })}
      <div id="rec-atualizar" hidden>${interruptor({ id: 'n-rec-atualizar', rotulo: 'Atualizar o cadastro do balconista', marcado: true, dica: 'Grava os dados novos na ficha dele, para as próximas campanhas.' })}</div>
      <div id="rec-salvar"${p === 'outra' ? '' : html` hidden`}>${interruptor({ id: 'n-rec-salvar', rotulo: 'Salvar como balconista desta empresa', marcado: true, dica: 'Na próxima campanha, é só escolher o nome.' })}</div>
    </div>`);

  const balc = balconistaEscolhido();
  if (dados) preencherRecebedor(dados);
  else if (balc) preencherRecebedor(balc);
  atualizarOfertaCadastro();
}

function atualizarOfertaCadastro() {
  const caixa = $('#rec-atualizar', st.el);
  if (!caixa) return;
  caixa.hidden = !diferente(balconistaEscolhido(), lerRecebedor());
}

function escolherPessoa(valor) {
  st.pessoa = valor;
  st.rascunhoSemPessoais = false;
  const balc = balconistaEscolhido();
  $('#rec-dados', st.el).hidden = valor === 'nenhuma';
  $('#rec-salvar', st.el).hidden = valor !== 'outra';
  preencherRecebedor(balc || {});
  atualizarOfertaCadastro();
  limparErro(st.el, 'n-pessoa');
  if (valor === 'outra') $('#' + PESSOAIS.nome_completo, st.el).focus();
}

// ---------- resumo de custo ----------
function camposCusto() {
  const rb = marcado('n-rebate');
  const n = x => (Number.isFinite(x) ? x : 0);
  return {
    investimento_lynkz: n(num('n-inv-lynkz')), investimento_industria: n(num('n-inv-industria')),
    meta: n(num('n-meta')), tipo_meta: v('n-tipo-meta') || null,
    rebate_pct: rb ? n(num('n-rebate-pct')) : 0, rebate_teto: rb ? n(num('n-rebate-teto')) : 0,
  };
}

function atualizarResumo() {
  const c = camposCusto();
  const k = calc(c), b = banda(k.pctMeta, FAIXAS);
  pintar($('#resumo-regua', st.el), regua(c, { titulo: 'Custo total desta campanha', compacta: true }));
  pintar($('#be-total', st.el), `R$ ${brl(k.total)}`);
  const pe = $('#be-pct', st.el);
  pe.className = 'barra-envio-pct nivel-' + b.nivel;
  pintar(pe, k.pctMeta == null ? 'sem meta' : `${pct(k.pctMeta)} da meta`);
}

// ---------- validação ----------
function validar() {
  const e = {};
  if (!st.comboEmpresa.valor()) e['n-empresa'] = 'Escolha a empresa (ou cadastre uma nova).';
  if (!st.comboLab.valor()) e['n-laboratorio'] = 'Escolha o laboratório.';
  if (!v('n-campanha')) e['n-campanha'] = 'Dê um nome à campanha.';
  if (v('n-inicio') && v('n-fim') && v('n-fim') < v('n-inicio')) e['n-fim'] = 'O fim está antes do início.';

  for (const id of ['n-inv-lynkz', 'n-inv-industria', 'n-meta', 'n-rebate-teto', 'n-rebate-pct']) {
    if (!Number.isFinite(num(id)) || num(id) < 0) e[id] = 'Valor inválido. Use só números, como 1.500,00.';
  }
  const pag = v('n-pagamento');
  if (!e['n-inv-lynkz'] && PAGTO_EXIGE_INVESTIMENTO.includes(pag) && !(num('n-inv-lynkz') > 0)) {
    e['n-inv-lynkz'] = `Obrigatório para ${pag}. Informe um valor maior que zero.`;
  }
  if (marcado('n-rebate')) {
    if (!e['n-rebate-pct'] && !(num('n-rebate-pct') > 0)) e['n-rebate-pct'] = 'Informe o % de rebate ou desligue a opção.';
    if (!e['n-meta'] && !(num('n-meta') > 0)) e['n-meta'] = 'O rebate precisa da meta do cliente para ser calculado.';
  }

  if (recebedorVisivel() && st.comboEmpresa.valor()) {
    const obrig = recebedorObrigatorio();
    const p = st.pessoa;
    if (obrig && (!p || p === 'nenhuma')) e['n-pessoa'] = 'Escolha quem recebe a premiação.';
    const balc = balconistaEscolhido();
    const dados = lerRecebedor();
    const gravaBalc = (p === 'outra' && marcado('n-rec-salvar')) || (balc && marcado('n-rec-atualizar') && diferente(balc, dados));
    if (p && p !== 'nenhuma' && (obrig || gravaBalc)) {
      for (const [k, msg] of Object.entries(errosRecebedor(dados))) e[PESSOAIS[k]] = msg;
      // CPF de alguém já cadastrado na empresa: escolher na lista em vez de duplicar.
      const cpf = soDigitos(dados.cpf);
      const dono = st.ctx.cadastros.balconistasDa(st.comboEmpresa.valor(), { inativos: true })
        .find(b => b.cpf === cpf && String(b.id) !== String(balc?.id));
      if (!e[PESSOAIS.cpf] && dono && (p === 'outra' ? marcado('n-rec-salvar') : true)) {
        e[PESSOAIS.cpf] = dono.ativo
          ? `Este CPF já é de ${dono.nome_completo}, cadastrado nesta empresa. Escolha o nome na lista acima.`
          : `Este CPF é de ${dono.nome_completo}, balconista desativado nesta empresa. Reative-o na Gestão.`;
      }
    }
  }
  return e;
}

// ---------- rascunho ----------
function salvarRascunho() {
  if (!st || st.enviado) return;
  const r = { versao: 2 };
  let algum = false;
  $$('input[id], select[id], textarea[id]', $('#form-nova', st.el)).forEach(el => {
    if (IDS_PESSOAIS.includes(el.id) || el.type === 'radio' || el.id === 'n-empresa' || el.id === 'n-laboratorio') return;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    r[el.id] = val;
    if (val !== '' && val !== false && !(el.type === 'checkbox' && el.id.startsWith('n-rec-'))) algum = true;
  });
  r.empresaId = st.comboEmpresa.valor();
  r.laboratorio = st.comboLab.valor();
  r.pessoa = st.pessoa;
  if (r.empresaId || r.laboratorio) algum = true;
  if (algum) armazenamento.gravar(CHAVE_RASCUNHO, r);
  else armazenamento.remover(CHAVE_RASCUNHO);
}

function lerRascunho() {
  const r = armazenamento.ler(CHAVE_RASCUNHO);
  return r && typeof r === 'object' && r.versao === 2 ? r : null;
}

// Valores iniciais a partir de uma campanha (Reenviar com ajustes).
function valoresDaCampanha(c, ctx) {
  const empresa = c.empresa_id ? ctx.cadastros.empresa(c.empresa_id)
    : ctx.cadastros.empresas().find(e => normaliza(e.nome) === normaliza(c.cliente));
  const rb = +c.rebate_pct > 0;
  return {
    empresaId: empresa?.id ?? null,
    laboratorio: c.laboratorio,
    'n-campanha': c.campanha, 'n-tipo': c.tipo || '', 'n-mecanica': c.mecanica || '',
    'n-inicio': c.data_inicio || '', 'n-fim': c.data_fim || '',
    'n-inv-lynkz': +c.investimento_lynkz ? valorCampo(c.investimento_lynkz) : '',
    'n-inv-industria': +c.investimento_industria ? valorCampo(c.investimento_industria) : '',
    'n-pagamento': c.forma_pagamento || '', 'n-tipo-meta': c.tipo_meta || '',
    'n-meta': +c.meta ? valorCampo(c.meta) : '',
    'n-rebate': rb, 'n-rebate-pct': rb ? String(+c.rebate_pct).replace('.', ',') : '',
    'n-rebate-teto': rb && +c.rebate_teto ? valorCampo(c.rebate_teto) : '',
    'n-rebate-base': c.rebate_base || '', 'n-rebate-gatilho': c.rebate_gatilho || '',
    'n-observacoes': c.observacoes || '',
    pessoa: c.balconista_id ? String(c.balconista_id) : (c.swile_nome_completo ? 'outra' : null),
    dadosPessoais: !c.balconista_id && c.swile_nome_completo ? {
      nome_completo: c.swile_nome_completo, cpf: c.swile_cpf, data_nascimento: c.swile_data_nascimento,
      email: c.swile_email, telefone: c.swile_telefone,
    } : null,
    clienteSemCadastro: !empresa ? c.cliente : null,
  };
}

// ---------- envio ----------
async function enviar() {
  if (st.enviando) return;
  const { ctx } = st;
  const erros = validar();
  if (aplicarErros($('#form-nova', st.el), erros)) {
    const n = Object.keys(erros).length;
    ctx.toast(n === 1 ? 'Confira o campo marcado.' : `Confira os ${n} campos marcados.`, { tom: 'erro' });
    return;
  }
  st.enviando = true;
  const botoes = $$('[data-enviar]', st.el);
  botoes.forEach(b => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
  try {
    const empresa = ctx.cadastros.empresa(st.comboEmpresa.valor());
    const dados = lerRecebedor();
    const ehSwile = recebedorObrigatorio();
    let balconistaId = null;

    if (recebedorVisivel() && st.pessoa && st.pessoa !== 'nenhuma') {
      if (st.pessoa === 'outra') {
        if (marcado('n-rec-salvar')) {
          const b = await ctx.cadastros.salvarBalconista({ empresa_id: empresa.id, ...dados });
          balconistaId = b.id;
          st.pessoa = String(b.id);   // se a campanha falhar, a nova tentativa já usa o cadastro
        }
      } else {
        balconistaId = st.pessoa;
        const balc = balconistaEscolhido();
        if (marcado('n-rec-atualizar') && diferente(balc, dados)) await ctx.cadastros.salvarBalconista(dados, balc.id);
      }
    }

    const rb = marcado('n-rebate');
    const c = await ctx.campanhas.criar({
      cliente: empresa.nome, empresa_id: empresa.id, balconista_id: balconistaId,
      laboratorio: st.comboLab.valor(), campanha: v('n-campanha'),
      tipo: v('n-tipo') || null, mecanica: v('n-mecanica') || null,
      investimento_lynkz: num('n-inv-lynkz') || 0, investimento_industria: num('n-inv-industria') || 0,
      forma_pagamento: v('n-pagamento') || null,
      data_inicio: v('n-inicio') || null, data_fim: v('n-fim') || null,
      tipo_meta: v('n-tipo-meta') || null, meta: num('n-meta') || 0,
      rebate_pct: rb ? num('n-rebate-pct') || 0 : 0,
      rebate_teto: rb ? num('n-rebate-teto') || 0 : 0,
      rebate_base: rb ? v('n-rebate-base') || null : null,
      rebate_gatilho: rb ? v('n-rebate-gatilho') || null : null,
      // swile_* só quando o pagamento é Swile.
      swile_nome_completo: ehSwile ? dados.nome_completo.replace(/\s+/g, ' ') : null,
      swile_cpf: ehSwile ? soDigitos(dados.cpf) : null,
      swile_data_nascimento: ehSwile ? dados.data_nascimento : null,
      swile_email: ehSwile ? dados.email.toLowerCase() : null,
      swile_telefone: ehSwile ? soDigitos(dados.telefone) : null,
      observacoes: v('n-observacoes') || null,
      status: STATUS.PENDENTE,
      solicitante_id: ctx.perfil.id, solicitante_nome: ctx.perfil.nome,
    });
    st.enviado = true;
    limparRascunho();
    ctx.toast('Enviada. Já está na fila de aprovação.', { tom: 'sucesso' });
    ctx.navegar(`#/campanhas/${c.id}`, { substituir: true });
  } catch (e) {
    const MAPA = { cpf: PESSOAIS.cpf, nome_completo: PESSOAIS.nome_completo, email: PESSOAIS.email, telefone: PESSOAIS.telefone, data_fim: 'n-fim' };
    if (e.campo && MAPA[e.campo] && $('#' + MAPA[e.campo], st.el)) {
      aplicarErros($('#form-nova', st.el), { [MAPA[e.campo]]: e.message });
    }
    ctx.toast(e.message || 'Não foi possível enviar.', { tom: 'erro', duracao: 8000 });
  } finally {
    if (st) {
      st.enviando = false;
      botoes.forEach(b => { b.disabled = false; b.removeAttribute('aria-busy'); });
    }
  }
}

// ---------- montagem ----------
export function montar(el, ctx, params) {
  const origem = params.de ? ctx.campanhas.porId(params.de) : null;
  const rascunho = origem ? null : lerRascunho();
  let ini = origem ? valoresDaCampanha(origem, ctx) : (rascunho || {});
  // "Nova campanha" na ficha da empresa: já vem com ela escolhida.
  let sugerida = null;
  try { sugerida = sessionStorage.getItem(CHAVE_EMPRESA_SUGERIDA); sessionStorage.removeItem(CHAVE_EMPRESA_SUGERIDA); } catch { /* sem armazenamento */ }
  if (!origem && sugerida && ctx.cadastros.empresa(sugerida) && String(ini.empresaId ?? '') !== sugerida) {
    ini = { ...ini, empresaId: sugerida, pessoa: null };
  }
  st = { el, ctx, pessoa: ini.pessoa ?? null, enviando: false, enviado: false, desligar: [],
         rascunhoSemPessoais: !!(rascunho && rascunho.pessoa === 'outra') };

  ctx.cabecalho({ titulo: origem ? 'Reenviar campanha' : 'Nova campanha', voltar: origem ? `#/campanhas/${origem.id}` : '#/inicio' });
  ctx.barraDeAcao(true);

  const val = id => ini[id] ?? '';
  const rbOn = ini['n-rebate'] === true;
  pintar(el, html`<div class="nova">
    <form id="form-nova" class="nova-form" novalidate>
      ${origem ? html`<p class="nota">${icone('repetir')}<span>Copiado de ${origem.codigo}${origem.motivo ? html` — reprovada por: “${origem.motivo}”` : ''}. Ajuste e envie de novo.</span></p>` : ''}
      ${rascunho ? html`<p class="nota">${icone('rascunho')}<span>Rascunho recuperado.</span><button type="button" class="btn btn-texto" id="descartar">Descartar</button></p>` : ''}
      ${ini.clienteSemCadastro ? html`<p class="nota nota-alerta">${icone('info')}<span>A campanha original era de “${ini.clienteSemCadastro}”, que ainda não está no cadastro. Escolha ou cadastre a empresa.</span></p>` : ''}

      <section class="painel"><h2 class="painel-titulo">Empresa e laboratório</h2><div class="painel-corpo">
        ${campo({ id: 'n-empresa', rotulo: 'Empresa', obrigatorio: true, dica: 'Digite para buscar. Não achou? Dá para cadastrar na hora.', atributos: { placeholder: 'Nome, cidade ou CNPJ' } })}
        ${campo({ id: 'n-laboratorio', rotulo: 'Laboratório', obrigatorio: true, atributos: { placeholder: 'Selecione ou digite para buscar' } })}
      </div></section>

      <section class="painel"><h2 class="painel-titulo">A campanha</h2><div class="painel-corpo">
        ${campo({ id: 'n-campanha', rotulo: 'Nome da campanha', valor: val('n-campanha'), obrigatorio: true, atributos: { placeholder: 'Ex.: Genéricos Setembro', maxlength: 120 } })}
        ${selecao({ id: 'n-tipo', rotulo: 'Mecânica', opcoes: C.TIPOS, valor: val('n-tipo') })}
        ${areaTexto({ id: 'n-mecanica', rotulo: 'Como funciona', valor: val('n-mecanica'), opcional: true, atributos: { placeholder: 'Ex.: 5% de desconto acima de 200 un. e 8% acima de 400 un.' } })}
        <div class="grade-2">
          ${campo({ id: 'n-inicio', rotulo: 'Início', tipo: 'date', valor: val('n-inicio') })}
          ${campo({ id: 'n-fim', rotulo: 'Fim', tipo: 'date', valor: val('n-fim'), atributos: { min: val('n-inicio') || false } })}
        </div>
      </div></section>

      <section class="painel"><h2 class="painel-titulo">Investimento</h2><div class="painel-corpo">
        <div class="grade-2">
          ${campo({ id: 'n-inv-lynkz', rotulo: 'LYNKZ (R$)', valor: val('n-inv-lynkz'), mascara: 'valor' })}
          ${campo({ id: 'n-inv-industria', rotulo: 'Indústria (R$)', valor: val('n-inv-industria'), mascara: 'valor' })}
        </div>
        <p class="campo-dica bloco-dica">LYNKZ sai do caixa agora. Indústria é a bonificação prometida, paga no mês seguinte. Deixe em branco se não houver.</p>
        ${selecao({ id: 'n-pagamento', rotulo: 'Forma de pagamento', opcoes: C.PAGTO, valor: val('n-pagamento') })}
      </div></section>

      <section class="painel" id="bloco-recebedor" hidden>
        <h2 class="painel-titulo" id="recebedor-titulo">Quem recebe a premiação</h2>
        <div class="painel-corpo" id="recebedor-corpo"></div>
      </section>

      <section class="painel"><h2 class="painel-titulo">Contrapartida do cliente</h2><div class="painel-corpo">
        <div class="grade-2 quebra">
          ${selecao({ id: 'n-tipo-meta', rotulo: 'Tipo de meta', opcoes: C.METAS, valor: val('n-tipo-meta') })}
          ${campo({ id: 'n-meta', rotulo: 'Meta do cliente (R$)', valor: val('n-meta'), mascara: 'valor' })}
        </div>
        ${interruptor({ id: 'n-rebate', rotulo: 'Esta campanha tem rebate', marcado: rbOn, dica: 'Percentual pago ao cliente se ele bater a meta.' })}
        <div id="bloco-rebate"${rbOn ? '' : html` hidden`}>
          <div class="grade-2">
            ${campo({ id: 'n-rebate-pct', rotulo: '% de rebate', valor: val('n-rebate-pct'), mascara: 'decimal', obrigatorio: true })}
            ${campo({ id: 'n-rebate-teto', rotulo: 'Teto (R$)', valor: val('n-rebate-teto'), mascara: 'valor', opcional: true, atributos: { placeholder: 'sem teto' } })}
          </div>
          ${selecao({ id: 'n-rebate-base', rotulo: 'Base de cálculo', opcoes: C.BASES, valor: val('n-rebate-base') })}
          ${selecao({ id: 'n-rebate-gatilho', rotulo: 'Quando o rebate é devido', opcoes: C.GATILHOS, valor: val('n-rebate-gatilho') })}
        </div>
      </div></section>

      <section class="painel"><h2 class="painel-titulo">Observações</h2><div class="painel-corpo">
        ${areaTexto({ id: 'n-observacoes', rotulo: 'Observações para o aprovador', valor: val('n-observacoes'), opcional: true })}
      </div></section>
      <p class="campo-dica"><span class="campo-obrig" aria-hidden="true">*</span> Campos obrigatórios. O investimento LYNKZ também é obrigatório com Depósito / verba ou Swile.</p>
    </form>

    <aside class="nova-resumo" aria-label="Resumo do custo">
      <div class="painel"><div class="painel-corpo painel-regua" id="resumo-regua"></div></div>
      <button type="submit" form="form-nova" class="btn btn-primario btn-largo" data-enviar>Enviar para aprovação</button>
    </aside>

    <div class="barra-envio" role="region" aria-label="Enviar campanha">
      <div class="barra-envio-total">
        <span class="barra-envio-rotulo">Custo total</span>
        <strong class="num-display valor" id="be-total">R$ 0,00</strong>
        <span class="barra-envio-pct" id="be-pct"></span>
      </div>
      <button type="submit" form="form-nova" class="btn btn-primario" data-enviar>Enviar</button>
    </div>
  </div>`);

  const form = $('#form-nova', el);

  st.comboLab = combo($('#n-laboratorio', el), {
    opcoes: () => (C.LABORATORIOS || []).map(l => ({ valor: l, rotulo: l })),
    valor: (C.LABORATORIOS || []).find(l => normaliza(l) === normaliza(ini.laboratorio || '')) || null,
    aoEscolher: () => { limparErro(form, 'n-laboratorio'); salvar(); },
  });

  st.comboEmpresa = combo($('#n-empresa', el), {
    opcoes: () => ctx.cadastros.empresas().map(e => ({
      valor: e.id, rotulo: e.nome, detalhe: e.cidade || '',
      busca: `${e.cidade || ''} ${e.cnpj || ''} ${ctx.cadastros.balconistasDa(e.id).map(b => b.nome_completo).join(' ')}`,
    })),
    valor: ini.empresaId ?? null,
    vazio: 'Nenhuma empresa com esse nome.',
    criar: {
      rotulo: termo => `Cadastrar a empresa “${termo}”`,
      aoCriar: async termo => {
        const e = await dialogoEmpresa(null, { nome: termo });
        if (e) { st.comboEmpresa.definir(e.id); ctx.toast(`Empresa ${e.nome} cadastrada.`, { tom: 'sucesso' }); }
        $('#n-empresa', el).focus();
      },
    },
    aoEscolher: () => {
      limparErro(form, 'n-empresa');
      st.pessoa = null;
      st.rascunhoSemPessoais = false;
      desenharRecebedor();
      salvar();
    },
  });

  const salvar = debounce(salvarRascunho, 400);

  // Primeiro desenho do bloco "Quem recebe" com o que veio do rascunho/campanha.
  desenharRecebedor({ dados: ini.dadosPessoais || null });
  atualizarResumo();

  st.desligar.push(
    ligarMascaras(el),
    () => st.comboEmpresa.desligar(),
    () => st.comboLab.desligar(),
    ao(form, 'submit', 'form', e => { e.preventDefault(); enviar(); }),
    ao(form, 'input', 'input, textarea, select', (e, c) => {
      if (c.closest('.campo.tem-erro')) limparErro(form, c.closest('.campo').dataset.campo);
      if (IDS_PESSOAIS.includes(c.id)) atualizarOfertaCadastro();
      salvar();
    }),
    ao(form, 'input', '#n-inv-lynkz, #n-inv-industria, #n-meta, #n-rebate-pct, #n-rebate-teto', atualizarResumo),
    ao(form, 'change', 'input, select, textarea', () => salvar()),
    ao(form, 'change', '#n-tipo-meta', atualizarResumo),
    ao(form, 'change', '#n-pagamento, #n-tipo', (e, s) => {
      limparErro(form, 'n-inv-lynkz');
      desenharRecebedor({ dados: st.pessoa === 'outra' ? lerRecebedorSeguro() : null });
    }),
    ao(form, 'change', 'input[name="n-pessoa"]', (e, r) => escolherPessoa(r.value)),
    ao(form, 'change', '#n-rebate', (e, cb) => {
      $('#bloco-rebate', el).hidden = !cb.checked;
      if (!cb.checked) ['n-rebate-pct', 'n-meta'].forEach(id => limparErro(form, id));
      atualizarResumo();
    }),
    ao(form, 'change', '#n-inicio', (e, i) => {
      const fim = $('#n-fim', el);
      if (i.value) fim.min = i.value; else fim.removeAttribute('min');
    }),
    ao(form, 'change', '#n-fim', () => {
      if (v('n-inicio') && v('n-fim') && v('n-fim') < v('n-inicio')) marcarErro(form, 'n-fim', 'O fim está antes do início.');
    }),
    ao(el, 'click', '#descartar', () => {
      salvar.cancelar();
      limparRascunho();
      ctx.toast('Rascunho descartado.');
      ctx.remontar();
    }),
  );

  // Fechar o app ou trocar de aba grava o que estiver pendente.
  const aoEsconder = () => { if (document.hidden) salvar.agora(); };
  document.addEventListener('visibilitychange', aoEsconder);
  st.desligar.push(() => document.removeEventListener('visibilitychange', aoEsconder));

  if (!origem && !rascunho) setTimeout(() => $('#n-empresa', el)?.focus({ preventScroll: true }), 0);

  const meu = st;
  return () => {
    salvar.agora();
    meu.desligar.forEach(fn => fn());
    if (st === meu) st = null;
    ctx.barraDeAcao(false);
  };
}

// Ao trocar pagamento/mecânica com "Outra pessoa", os dados digitados ficam.
function lerRecebedorSeguro() {
  return $('#' + PESSOAIS.nome_completo, st.el) ? lerRecebedor() : null;
}
