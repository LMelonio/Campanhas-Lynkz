// Nova campanha (também reenviar e usar como modelo). Abaixo de 900 px vira 3 passos pelo CSS.
// O rascunho fica no aparelho sem os dados pessoais do recebedor; o formulário nunca é redesenhado por evento externo.
import { html, pintar, $, $$, ao, debounce, armazenamento } from '../lib/dom.js';
import {
  calc, banda, brl, textoDevolucoes, pct, lerValor, valorCampo, soDigitos, normaliza, maskCPF, maskTelefone,
  errosRecebedor, LIMITES, hojeCivil, horaBR, somaDias, periodoMes, dias, dataBR, STATUS,
  listaLaboratorios, juntarLaboratorios, MAX_FORNECEDORES, MAX_MARCAS, juntarMarcas, textoMarcas, lerDivisao, somaDivisao, partilha, errosDivisao,
} from '../lib/regras.js';
import { icone } from '../ui/icones.js';
import { regua, FAIXAS } from '../ui/pecas.js';
import { campo, selecao, areaTexto, interruptor, ligarMascaras, aplicarErros, limparErro, marcarErro } from '../ui/campos.js';
import { combo } from '../ui/combo.js';
import { confirmar } from '../ui/avisos.js';
import { textoBuscaEmpresa, camposBalconista } from '../dados/cadastros.js';
import { empresaCheia } from '../ui/cadastro-dialogos.js';
import { consultarCompras, laboratoriosConsultaveis, MAX_LABORATORIOS_CONSULTA } from '../dados/qlik.js';

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

// ---------- fornecedores ----------
// O combo serve para acrescentar; os escolhidos ficam em st.labs e aparecem como botões com ×.
const labsTexto = () => juntarLaboratorios(st.labs);
// "Ouro Fino" · "Ouro Fino nem Avert" · "Ouro Fino, Avert nem Vansil"
const nemLista = l => (l.length > 1 ? `${l.slice(0, -1).join(', ')} nem ${l[l.length - 1]}` : l[0] || '');

// Nomes da lista LABORATORIOS na grafia de lá; os que não estão nela ficam de fora (como antes).
function labsConhecidos(texto) {
  const lista = C.LABORATORIOS || [];
  return listaLaboratorios(texto).map(l => lista.find(x => normaliza(x) === normaliza(l))).filter((l, i, a) => l && a.indexOf(l) === i);
}

function desenharLabs() {
  const caixa = $('#n-labs', st.el);
  if (!caixa) return;
  caixa.hidden = !st.labs.length;
  pintar(caixa, html`${st.labs.map(l => html`<button type="button" class="chip chip-filtro" data-tirar-lab="${l}" aria-label="Tirar o fornecedor ${l}">${l}${icone('x')}</button>`)}`);
}

// Acrescentar/tirar fornecedor: redesenha os botões e a divisão, grava o rascunho e consulta de novo.
function mudouLabs() {
  desenharLabs();
  desenharDivisao();
  limparErro($('#form-nova', st.el), 'n-laboratorio');
  st.salvar?.();
  st.atualizarComprasDepois?.();
  atualizarResumoPassos();
}
const num = id => lerValor(v(id));

// ---------- divisão por fornecedor ----------
// Valores digitados ficam em st.div, por nome: tirar ou pôr um fornecedor não perde os outros.
// Enquanto divide, meta e indústria totais são a soma (só leitura).
const dividindo = () => !!st && st.labs.length >= 2 && !!$('#n-dividir', st.el)?.checked;
const idDiv = (tipo, i) => `n-div-${tipo}-${i}`;

// Guarda o que está digitado nos campos da divisão (antes de redesenhar).
function guardarDivisao() {
  $$('[data-div-nome]', st.el).forEach(f => {
    const i = f.dataset.divI;
    st.div[f.dataset.divNome] = { meta: v(idDiv('meta', i)), ind: v(idDiv('ind', i)) };
  });
}

// Linhas da divisão com números (NaN = digitado errado).
function linhasDivisao() {
  return st.labs.map((nome, i) => ({
    nome,
    meta: lerValor(v(idDiv('meta', i))),
    investimento_industria: lerValor(v(idDiv('ind', i))),
  }));
}

function desenharDivisao() {
  const bloco = $('#bloco-divisao', st.el);
  if (!bloco) return;
  if ($('#divisao-corpo', st.el).childElementCount) guardarDivisao();
  const pode = st.labs.length >= 2;
  bloco.hidden = !pode;
  const ligado = pode && $('#n-dividir', st.el).checked;
  const corpo = $('#divisao-corpo', st.el);
  corpo.hidden = !ligado;
  // A explicação só aparece com a divisão ligada (no celular, o passo 2 fica mais curto).
  pintar(corpo, ligado ? html`
    <p class="campo-dica">Meta e indústria de cada fornecedor. O rebate é repartido na proporção da meta.</p>
    ${st.labs.map((nome, i) => html`<fieldset class="div-linha" data-div-nome="${nome}" data-div-i="${i}">
      <legend class="div-nome">${nome}</legend>
      <div class="grade-2">
        ${campo({ id: idDiv('meta', i), rotulo: 'Meta (R$)', valor: st.div[nome]?.meta ?? '', mascara: 'valor' })}
        ${campo({ id: idDiv('ind', i), rotulo: 'Indústria (R$)', valor: st.div[nome]?.ind ?? '', mascara: 'valor' })}
      </div>
      <p class="div-parte" id="n-div-parte-${i}" aria-live="polite"></p>
    </fieldset>`)}
    <p class="div-soma" id="div-soma" aria-live="polite"></p>` : '');
  // Meta e Indústria: soma dos fornecedores (só leitura) enquanto divide.
  for (const id of ['n-meta', 'n-inv-industria']) {
    const i = $('#' + id, st.el);
    if (!i) continue;
    i.readOnly = ligado;
    if (ligado) i.setAttribute('aria-readonly', 'true'); else i.removeAttribute('aria-readonly');
    i.closest('.campo')?.classList.toggle('campo-soma', ligado);
    if (ligado) limparErro($('#form-nova', st.el), id);
  }
  const dicaMeta = $('#n-meta-dica', st.el), dicaInd = $('#n-inv-industria-dica', st.el);
  if (dicaMeta) dicaMeta.hidden = !ligado;
  if (dicaInd) dicaInd.hidden = !ligado;
  atualizarDivisao();
}

// Soma nos campos totais e mostra a parte de cada fornecedor (% da meta e rebate).
function atualizarDivisao() {
  if (!dividindo()) return;
  const linhas = linhasDivisao();
  const validas = linhas.map(l => ({ ...l, meta: Number.isFinite(l.meta) ? l.meta : 0, investimento_industria: Number.isFinite(l.investimento_industria) ? l.investimento_industria : 0 }));
  const t = somaDivisao(validas);
  $('#n-meta', st.el).value = t.meta ? valorCampo(t.meta) : '';
  $('#n-inv-industria', st.el).value = t.investimento_industria ? valorCampo(t.investimento_industria) : '';
  const partes = partilha({ ...camposCusto(), fornecedores: validas }) || [];
  const comRebate = marcado('n-rebate') && num('n-rebate-pct') > 0;
  partes.forEach((p, i) => {
    const alvo = $('#n-div-parte-' + i, st.el);
    if (!alvo) return;
    const ped = [t.meta > 0 ? `${pct(p.peso)} da meta` : 'sem meta', comRebate ? `rebate estimado R$ ${brl(p.rebate)}` : ''].filter(Boolean);
    alvo.textContent = ped.join(' · ');
  });
  const soma = $('#div-soma', st.el);
  if (soma) pintar(soma, html`Soma: <span>meta R$ ${brl(t.meta)}</span> · <span>indústria R$ ${brl(t.investimento_industria)}</span>`);
}

// Ao ligar a divisão sem nada digitado nela: reparte em partes iguais o que já estava nos totais
// (centavos que sobram vão para o último), para não perder a meta digitada antes.
function preencherDivisaoIgual() {
  const vazios = st.labs.every(n => !st.div[n]?.meta && !st.div[n]?.ind);
  if (!vazios) return;
  const reparte = total => {
    const c = Math.round((Number.isFinite(total) ? total : 0) * 100), n = st.labs.length, base = Math.floor(c / n);
    return st.labs.map((_, i) => (i === n - 1 ? c - base * (n - 1) : base) / 100);
  };
  const metas = reparte(num('n-meta')), inds = reparte(num('n-inv-industria'));
  st.labs.forEach((nome, i) => { st.div[nome] = { meta: metas[i] ? valorCampo(metas[i]) : '', ind: inds[i] ? valorCampo(inds[i]) : '' }; });
}

// Para o rascunho, "reenviar" e "usar como modelo": { nome: {meta, ind} } em texto, como digitado.
function divisaoParaTela(linhas) {
  const m = {};
  for (const l of linhas || []) m[l.nome] = { meta: +l.meta ? valorCampo(l.meta) : '', ind: +l.investimento_industria ? valorCampo(l.investimento_industria) : '' };
  return m;
}
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

function pessoaPadrao(balcs, cheia = false) {
  if (balcs.length === 1) return String(balcs[0].id);
  if (recebedorObrigatorio()) return balcs.length || cheia ? null : 'outra';
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
  // Até 2 balconistas por empresa (contando desativados): com o limite cheio, só dá para escolher.
  const cheia = empresaCheia(empresaId);
  const validas = new Set([...balcs.map(b => String(b.id)), ...(cheia ? [] : ['outra']), ...(obrig ? [] : ['nenhuma'])]);
  if (!validas.has(st.pessoa)) st.pessoa = pessoaPadrao(balcs, cheia);
  const p = st.pessoa;

  pintar(corpo, html`
    <fieldset class="campo pessoas" data-campo="n-pessoa" aria-describedby="n-pessoa-erro">
      <legend>${balcs.length ? 'Escolha o balconista' : cheia ? 'Os balconistas desta empresa estão desativados' : 'Nenhum balconista cadastrado nesta empresa'}</legend>
      ${balcs.map(b => html`<label class="pessoa"><input type="radio" name="n-pessoa" value="${b.id}"${p === String(b.id) ? html` checked` : ''}>
        <span class="pessoa-nome">${b.nome_completo}<small>CPF ${maskCPF(b.cpf)} · ${maskTelefone(b.telefone)}</small></span></label>`)}
      ${cheia ? (balcs.length ? html`<p class="campo-dica">Esta empresa já tem 2 balconistas cadastrados (o limite). Para trocar a pessoa, edite o cadastro na <a href="#/gestao/empresas/${empresaId}" class="link-toque">ficha da empresa</a>.</p>` : html`<p class="nota">${icone('info')}<span>A empresa já tem 2 balconistas cadastrados, os dois desativados. Reative um na <a href="#/gestao/empresas/${empresaId}" class="link-toque">ficha da empresa</a>.</span></p>`)
        : html`<label class="pessoa"><input type="radio" name="n-pessoa" value="outra"${p === 'outra' ? html` checked` : ''}>
        <span class="pessoa-nome">${balcs.length ? 'Outra pessoa' : 'Cadastrar quem recebe'}<small>Preencha os dados abaixo</small></span></label>`}
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
  atualizarDivisao();
  const c = camposCusto();
  const k = calc(c), b = banda(k.pctMeta, FAIXAS);
  pintar($('#resumo-regua', st.el), regua(c, { titulo: 'Custo total desta campanha', compacta: true }));
  pintar($('#be-total', st.el), `R$ ${brl(k.total)}`);
  const pe = $('#be-pct', st.el);
  pe.className = 'barra-envio-pct nivel-' + b.nivel;
  pintar(pe, k.pctMeta == null ? 'sem meta' : `${pct(k.pctMeta)} da meta`);
  atualizarResumoPassos();
}

// ---------- passos no celular (mesmo formulário; o CSS mostra só as seções do passo atual) ----------
const PASSOS = ['Cliente', 'Valores', 'Revisão'];
const telaDePassos = () => matchMedia('(max-width: 899.98px)').matches;

function elDoCampo(id) {
  return $('#' + CSS.escape(id), st.el) || $(`[data-campo="${CSS.escape(id)}"]`, st.el);
}
function passoDoCampo(id) {
  return +(elDoCampo(id)?.closest('[data-passo]')?.dataset.passo || 0);
}

function desenharPassos() {
  const nova = $('.nova', st.el);
  if (!nova) return;
  nova.dataset.passoAtual = String(st.passo);
  const atual = $('#passo-atual', st.el);
  if (atual) atual.textContent = `${st.passo} de ${PASSOS.length} · ${PASSOS[st.passo - 1]}`;
  $$('[data-ir-passo]', st.el).forEach(b => {
    const n = +b.dataset.irPasso;
    b.disabled = n > st.visitado;
    if (n === st.passo) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
}

function irParaPasso(n, { focar = true } = {}) {
  st.passo = Math.min(PASSOS.length, Math.max(1, n));
  st.visitado = Math.max(st.visitado, st.passo);
  st.toastErro?.fechar();   // o aviso de erro do passo anterior não segue para o próximo
  st.toastErro = null;
  desenharPassos();
  atualizarResumoPassos();
  st.salvar?.();
  if (focar && telaDePassos()) {
    window.scrollTo({ top: 0 });
    $('#passo-atual', st.el)?.focus({ preventScroll: true });
  }
}

// "Continuar": valida só os campos do passo; erro leva ao campo, como no envio.
function continuar() {
  const erros = Object.fromEntries(Object.entries(validar()).filter(([id]) => passoDoCampo(id) === st.passo));
  const n = aplicarErros($('#form-nova', st.el), erros);
  if (n) { st.toastErro = st.ctx.toast(n === 1 ? 'Confira o campo marcado.' : `Confira os ${n} campos marcados.`, { tom: 'erro' }); return; }
  irParaPasso(st.passo + 1);
}

// Resumo do passo 3: o que pesa na decisão, antes de enviar.
function atualizarResumoPassos() {
  const alvo = st && $('#resumo-passos', st.el);
  if (!alvo) return;
  const k = calc(camposCusto());
  const m = marcadasDe(st.compras);
  const empresa = st.ctx.cadastros.empresa(st.comboEmpresa?.valor());
  pintar(alvo, html`<dl class="linhas">
    <div class="linha"><dt>Empresa</dt><dd>${empresa?.nome || '—'}</dd></div>
    <div class="linha"><dt>${st.labs.length > 1 ? 'Fornecedores' : 'Fornecedor'}</dt><dd>${labsTexto() || '—'}</dd></div>
    ${dividindo() ? (partilha({ ...camposCusto(), fornecedores: linhasDivisao().map(l => ({ ...l, meta: l.meta || 0, investimento_industria: l.investimento_industria || 0 })) }) || []).map(p => html`
    <div class="linha"><dt>${p.nome}</dt><dd>meta R$ ${brl(p.meta)} · indústria R$ ${brl(p.investimento_industria)}${marcado('n-rebate') ? ` · rebate R$ ${brl(p.rebate)}` : ''}</dd></div>`) : ''}
    <div class="linha"><dt>Custo total</dt><dd class="valor">R$ ${brl(k.total)}</dd></div>
    <div class="linha"><dt>% da meta</dt><dd>${k.pctMeta == null ? 'sem meta' : pct(k.pctMeta)}</dd></div>
    <div class="linha"><dt>Notas marcadas</dt><dd>${m.length ? `${m.length} · R$ ${brl(m.reduce((t, x) => t + x.valor, 0))}` : 'nenhuma'}</dd></div>
  </dl>`);
}

// ---------- validação ----------
function validar() {
  const e = {};
  if (!st.comboEmpresa.valor()) e['n-empresa'] = 'Escolha a empresa.';
  if (!st.labs.length) e['n-laboratorio'] = 'Escolha ao menos um fornecedor.';
  else if (st.labs.length > MAX_FORNECEDORES) e['n-laboratorio'] = `No máximo ${MAX_FORNECEDORES} fornecedores. Tire algum.`;
  else if (labsTexto().length > LIMITES.textos.laboratorio) e['n-laboratorio'] = `Fornecedores demais: os nomes juntos passam de ${LIMITES.textos.laboratorio} caracteres. Tire algum.`;
  if (!v('n-campanha')) e['n-campanha'] = 'Dê um nome à campanha.';
  // Sem a forma de pagamento, a campanha aprovada fica fora da ADP (que só pega Swile).
  if (!v('n-pagamento')) e['n-pagamento'] = 'Escolha a forma de pagamento.';
  if (v('n-inicio') && v('n-fim') && v('n-fim') < v('n-inicio')) e['n-fim'] = 'O fim está antes do início.';

  // Dividindo, meta e indústria são a soma (só leitura): os erros vão para os campos de cada fornecedor.
  const div = dividindo();
  for (const id of ['n-inv-lynkz', 'n-inv-industria', 'n-meta', 'n-rebate-teto', 'n-rebate-pct']) {
    if (div && (id === 'n-meta' || id === 'n-inv-industria')) continue;
    if (!Number.isFinite(num(id)) || num(id) < 0) e[id] = 'Valor inválido. Use só números, como 1.500,00.';
  }
  if (div) {
    const { porLinha, geral } = errosDivisao(linhasDivisao());
    for (const [i, erros] of Object.entries(porLinha)) {
      if (erros.meta) e[idDiv('meta', i)] = erros.meta;
      if (erros.investimento_industria) e[idDiv('ind', i)] = erros.investimento_industria;
    }
    if (geral) e[idDiv('meta', 0)] = geral;
  }
  // Mesmos limites do banco (LIMITES em regras.js): erro no campo, sem ir ao banco.
  if (!e['n-rebate-pct'] && marcado('n-rebate') && num('n-rebate-pct') > LIMITES.rebate_pct) e['n-rebate-pct'] = `O rebate vai de 0 a ${LIMITES.rebate_pct}%.`;
  for (const [id, chave] of [['n-meta', 'meta'], ['n-inv-lynkz', 'investimento_lynkz'], ['n-inv-industria', 'investimento_industria'], ['n-rebate-teto', 'rebate_teto']]) {
    if (div && (id === 'n-meta' || id === 'n-inv-industria')) continue;
    if (!e[id] && num(id) > LIMITES[chave]) e[id] = `Passou do limite de R$ ${brl(LIMITES[chave])}.`;
  }
  for (const [id, chave] of [['n-campanha', 'campanha'], ['n-mecanica', 'mecanica'], ['n-observacoes', 'observacoes']]) {
    if (!e[id] && v(id).length > LIMITES.textos[chave]) e[id] = `Texto grande demais: no máximo ${LIMITES.textos[chave]} caracteres.`;
  }
  const pag = v('n-pagamento');
  if (!e['n-inv-lynkz'] && PAGTO_EXIGE_INVESTIMENTO.includes(pag) && !(num('n-inv-lynkz') > 0)) {
    e['n-inv-lynkz'] = `Obrigatório para ${pag}. Informe um valor maior que zero.`;
  }
  if (marcado('n-rebate')) {
    if (!e['n-rebate-pct'] && !(num('n-rebate-pct') > 0)) e['n-rebate-pct'] = 'Informe o % de rebate ou desligue a opção.';
    if (!(num('n-meta') > 0)) {
      if (div) { if (!e[idDiv('meta', 0)]) e[idDiv('meta', 0)] = 'O rebate precisa da meta: informe a meta de pelo menos um fornecedor.'; }
      else if (!e['n-meta']) e['n-meta'] = 'O rebate precisa da meta do cliente para ser calculado.';
    }
    if (!v('n-rebate-base')) e['n-rebate-base'] = 'Escolha a base de cálculo do rebate.';
    if (!v('n-rebate-gatilho')) e['n-rebate-gatilho'] = 'Escolha quando o rebate é devido.';
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
  const r = { versao: 2, dono: st.ctx.perfil?.id ?? null };
  let algum = false;
  $$('input[id], select[id], textarea[id]', $('#form-nova', st.el)).forEach(el => {
    if (IDS_PESSOAIS.includes(el.id) || el.type === 'radio' || el.id === 'n-empresa' || el.id === 'n-laboratorio' || el.id.startsWith('n-div-')) return;
    const val = el.type === 'checkbox' ? el.checked : el.value;
    r[el.id] = val;
    if (val !== '' && val !== false && !(el.type === 'checkbox' && el.id.startsWith('n-rec-'))) algum = true;
  });
  r.empresaId = st.comboEmpresa.valor();
  r.laboratorio = labsTexto();   // "Ouro Fino, Avert"; rascunho antigo, com um só, também serve
  if (st.labs.length >= 2 && $('#divisao-corpo', st.el)?.childElementCount) guardarDivisao();
  r.divisao = st.div;           // { "Ouro Fino": { meta: "20.000,00", ind: "" } }
  r.pessoa = st.pessoa;
  r.passo = st.passo;
  r.visitado = st.visitado;
  if (r.empresaId || r.laboratorio) algum = true;
  if (algum) {
    r.salvoEm = new Date().toISOString();
    armazenamento.gravar(CHAVE_RASCUNHO, r);
  } else armazenamento.remover(CHAVE_RASCUNHO);
  mostrarRascunhoSalvo(algum ? r.salvoEm : null);
}

// Rascunho de outra conta (aparelho compartilhado) não aparece para quem entrou agora.
function lerRascunho(dono = null) {
  const r = armazenamento.ler(CHAVE_RASCUNHO);
  if (!r || typeof r !== 'object' || r.versao !== 2) return null;
  return dono && r.dono && r.dono !== dono ? null : r;
}

// "Rascunho salvo às 10:32" no rodapé do formulário e na barra de envio.
function mostrarRascunhoSalvo(quando) {
  if (!st) return;
  const texto = quando ? `Rascunho salvo às ${horaBR(quando)}` : '';
  ['#rs-form', '#rs-barra'].forEach(sel => { const e = $(sel, st.el); if (e) e.textContent = texto; });
}

// ---------- atalhos de período e duração ----------
function periodosRapidos() {
  const hoje = hojeCivil();
  return {
    este: periodoMes(hoje, 0),
    proximo: periodoMes(hoje, 1),
    '30': [hoje, somaDias(hoje, 29)],
  };
}

function atualizarPeriodo() {
  if (!st) return;
  const ini = v('n-inicio'), fim = v('n-fim');
  const d = ini && fim && fim >= ini ? dias(ini, fim) : null;
  const dur = $('#n-duracao', st.el);
  if (dur) dur.textContent = d ? `${d} ${d === 1 ? 'dia' : 'dias'}` : '';
  const p = periodosRapidos();
  $$('[data-periodo]', st.el).forEach(b => {
    const [a, z] = p[b.dataset.periodo];
    b.setAttribute('aria-pressed', String(ini === a && fim === z));
  });
}

// ---------- compras no Qlik e notas fiscais da campanha ----------
const moeda = n => `R$ ${brl(n)}`;
// Com muitas notas, a lista mostra as primeiras e o botão "Ver todas". "Marcar todas" vale para todas.
const NOTAS_VISIVEIS = 5;
const textoVerNotas = (n, abertas) => (abertas ? 'Mostrar só as primeiras' : `Ver todas as ${n} notas`);

function pintarCompras(conteudo) {
  const corpo = $('#compras-corpo', st.el);
  if (corpo) pintar(corpo, conteudo);
}

// Nota de provável devolução nunca conta, mesmo que algo a marque.
function marcadasDe(compras) {
  return compras ? compras.notas.filter((n, i) => compras.marcadas.has(i) && !n.provavel_devolucao) : [];
}
const devolvidasDe = compras => (compras ? compras.notas.filter(n => n.provavel_devolucao) : []);

function atualizarSomaNotas() {
  const compras = st?.compras;
  const el = $('#notas-soma', st?.el);
  if (!compras || !el) return;
  const m = marcadasDe(compras);
  el.textContent = m.length
    ? `${m.length} ${m.length === 1 ? 'nota marcada' : 'notas marcadas'} · ${moeda(m.reduce((t, n) => t + n.valor, 0))}`
    : 'Nenhuma nota marcada.';
  atualizarResumoPassos();
}

function desenharResultadoCompras() {
  const c = st.compras;
  const forn = c.fornecedores.length ? c.fornecedores.join(', ') : juntarLaboratorios(c.laboratorios);
  const varios = c.laboratorios.length > 1;
  // Por que não veio nada (cliente_total só vem quando o total é zero; Worker antigo não manda).
  const semNada = !c.notas.length && c.total === 0 && c.cliente_total === 0;
  const outros = !c.notas.length && c.total === 0 && c.cliente_total > 0;
  if (semNada) console.warn('Qlik devolveu zero para o cliente inteiro no período', { inicio: c.inicio, fim: c.fim });
  pintarCompras(html`
    <p class="compras-total" role="status">${icone('info')}<span>No período de ${dataBR(c.inicio)} a ${dataBR(c.fim)}, este cliente comprou <strong class="valor">${moeda(c.total)}</strong> de ${forn}${c.marcasSel.length ? html`, ${c.marcasSel.length > 1 ? 'marcas' : 'marca'} <strong>${textoMarcas(c.marcasSel)}</strong>` : ''}.</span></p>
    ${c.devolucoes > 0 ? html`<p class="compras-devolucoes" id="compras-devolucoes">Devoluções no período: <strong class="valor">${textoDevolucoes(c.devolucoes, devolvidasDe(c).length)}</strong></p>` : ''}
    ${c.fornecedores.length ? html`<p class="campo-dica compras-origem">Vem do Qlik${varios ? ', somando os fornecedores escolhidos' : ''}. Confira se ${varios ? 'os nomes acima são mesmo os fornecedores' : 'o nome acima é mesmo o fornecedor'} da campanha.</p>` : ''}
    ${c.foraDaConsulta.length ? html`<p class="campo-dica">${juntarLaboratorios(c.foraDaConsulta)} não ${c.foraDaConsulta.length === 1 ? 'entra' : 'entram'} na consulta: não ${c.foraDaConsulta.length === 1 ? 'está' : 'estão'} no Qlik.</p>` : ''}
    ${c.marcas.length > 1 || c.marcasSel.length ? blocoMarcas(c) : ''}
    ${c.notas.length ? html`
      <fieldset class="campo notas-fiscais" data-campo="n-notas">
        <legend class="campo-rotulo">Notas da campanha <span class="campo-opc">(opcional)</span></legend>
        <div class="notas-acoes"><button type="button" class="btn btn-texto" id="notas-todas">Marcar todas</button><button type="button" class="btn btn-texto" id="notas-nenhuma">Limpar</button></div>
        <ul class="notas-lista" id="notas-lista">${c.notas.map((n, i) => html`<li${i >= NOTAS_VISIVEIS && !c.verTodas ? html` hidden` : ''}><label class="pessoa${n.provavel_devolucao ? ' nota-devolvida' : ''}">
          <input type="checkbox" data-nota="${i}"${n.provavel_devolucao ? html` disabled` : c.marcadas.has(i) ? html` checked` : ''}>
          <span class="pessoa-nome"><strong>NF ${n.numero}${n.serie ? ` · série ${n.serie}` : ''}</strong><small>${n.data ? dataBR(n.data) : 'sem data'}${n.provavel_devolucao ? html` <span class="selo selo-neutro">Provável devolução</span>` : ''}</small></span>
          <span class="valor">${moeda(n.valor)}</span>
        </label></li>`)}</ul>
        ${c.notas.length > NOTAS_VISIVEIS ? html`<button type="button" class="btn btn-texto notas-ver" id="notas-ver" aria-controls="notas-lista" aria-expanded="${c.verTodas ? 'true' : 'false'}">${textoVerNotas(c.notas.length, c.verTodas)}</button>` : ''}
        <p class="campo-dica" id="notas-soma" aria-live="polite"></p>
      </fieldset>`
    : semNada ? html`<p class="nota nota-alerta" role="alert">${icone('alerta')}<span>O Qlik não mostra nenhuma compra deste cliente no período, de nenhum fornecedor. Se ele comprou, avise o TI: a consulta pode estar sem acesso aos dados. Você pode enviar a campanha sem as notas.</span></p>`
    : outros ? html`<p class="nota">${icone('info')}<span>No período, o cliente comprou <strong class="valor">${moeda(c.cliente_total)}</strong> de outros fornecedores, mas nada de ${nemLista(c.laboratorios)}. Se ${varios ? 'algum deles' : c.laboratorios[0]} vende com outro nome no Qlik, avise o TI.</span></p>`
    : html`<p class="nota">${icone('info')}<span>Nenhuma nota fiscal encontrada nesse período.</span></p>`}`);
  atualizarSomaNotas();
  // Depois de ligar/desligar uma marca, o foco volta ao mesmo botão.
  if (st.focoMarca) {
    $(`[data-marca="${CSS.escape(st.focoMarca)}"]`, st.el)?.focus();
    st.focoMarca = null;
  }
}

// Marcas escolhidas na chave da consulta (a ordem de escolha não importa).
const chaveMarcas = () => [...st.marcas].sort().join(';');

// Marcas do período como botões liga/desliga: uma ou várias, com um ou vários fornecedores.
function blocoMarcas(c) {
  const sel = c.marcasSel;
  const nomes = [...c.marcas.map(m => m.nome), ...sel.filter(s => !c.marcas.some(m => m.nome === s))];
  const valor = nome => c.marcas.find(m => m.nome === nome)?.valor;
  const cheio = sel.length >= MAX_MARCAS;
  return html`<fieldset class="campo marcas-qlik" data-campo="n-marcas">
    <legend class="campo-rotulo">Marcas <span class="campo-opc">(opcional · nenhuma = todas)</span></legend>
    ${cheio ? html`<p class="campo-dica" id="n-marcas-dica">Limite de ${MAX_MARCAS} marcas.</p>` : ''}
    <div class="chips marcas-lista" role="group" aria-label="Marcas"${cheio ? html` aria-describedby="n-marcas-dica"` : ''}>
      ${nomes.map(n => {
        const on = sel.includes(n);
        return html`<button type="button" class="chip chip-marca" data-marca="${n}" aria-pressed="${on ? 'true' : 'false'}"${!on && cheio ? html` disabled` : ''}>${on ? icone('check') : ''}${n}${valor(n) != null ? html` <span class="chip-valor">${moeda(valor(n))}</span>` : ''}</button>`;
      })}
    </div>
    ${sel.length ? html`<button type="button" class="btn btn-texto" data-marcas-todas>Ver todas as marcas</button>` : ''}
  </fieldset>`;
}

// O que identifica uma consulta: cliente, fornecedores consultáveis e período (as marcas vêm depois).
const baseCompras = (empresa, inicio, fim) =>
  [empresa.codigo_cliente, laboratoriosConsultaveis(st.labs).join(','), inicio, fim].join('|');

// Consulta de novo quando empresa, laboratório ou datas mudam. Só consulta
// com os quatro preenchidos, e descarta a resposta de uma consulta antiga.
async function atualizarCompras() {
  if (!st) return;
  const meu = st;
  const empresa = st.ctx.cadastros.empresa(st.comboEmpresa.valor());
  const labs = st.labs;
  const consultaveis = laboratoriosConsultaveis(labs);
  const inicio = v('n-inicio'), fim = v('n-fim');

  const aviso = texto => { st.compras = null; pintarCompras(html`<p class="campo-dica">${texto}</p>`); };
  st.consulta?.abort();
  if (!empresa || !labs.length) return aviso('Escolha a empresa e o fornecedor para ver quanto o cliente comprou.');
  if (!empresa.codigo_cliente) return aviso('Esta empresa não tem código de cliente do Qlik, então não há compras para consultar.');
  if (!consultaveis.length) {
    return aviso(labs.length === 1 ? 'Este fornecedor não está no Qlik. Siga sem notas fiscais.'
      : 'Nenhum destes fornecedores está no Qlik. Siga sem notas fiscais.');
  }
  if (consultaveis.length > MAX_LABORATORIOS_CONSULTA) return aviso(`Para ver as compras no Qlik, escolha no máximo ${MAX_LABORATORIOS_CONSULTA} fornecedores.`);
  if (!inicio || !fim) return aviso('Informe o início e o fim da campanha para ver as compras do período.');
  if (fim < inicio) return aviso('O fim está antes do início.');

  // Trocar empresa, laboratórios ou datas zera a marca escolhida (cada laboratório tem as suas).
  const base = baseCompras(empresa, inicio, fim);
  if (st.baseCompras !== base) { st.marcas = []; st.baseCompras = base; }
  const chave = `${base}|${chaveMarcas()}`;
  if (st.compras?.chave === chave) return desenharResultadoCompras();

  st.compras = null;
  const controle = st.consulta = new AbortController();
  pintarCompras(html`<p class="campo-dica" role="status">Consultando o Qlik…</p>`);
  try {
    const r = await consultarCompras({ codigoCliente: empresa.codigo_cliente, laboratorio: consultaveis, marca: st.marcas, inicio, fim, sinal: controle.signal });
    if (st !== meu || controle.signal.aborted) return;
    st.compras = { ...r, marcas: r.marcas || [], chave, inicio, fim, laboratorios: consultaveis,
      foraDaConsulta: labs.filter(l => !consultaveis.includes(l)), marcasSel: [...st.marcas], marcadas: new Set() };
    desenharResultadoCompras();
  } catch (e) {
    if (e.name === 'AbortError' || st !== meu) return;
    st.compras = null;
    pintarCompras(html`<p class="nota nota-alerta" role="alert">${icone('info')}<span>${e.message || 'Não foi possível consultar o Qlik.'}</span><button type="button" class="btn btn-texto" id="compras-tentar">Tentar de novo</button></p>`);
  }
}

// Valores iniciais a partir de uma campanha (reenviar reprovada ou usar como modelo).
// comoModelo: não copia as datas (o período de outra campanha quase nunca serve).
function valoresDaCampanha(c, ctx, { comoModelo = false } = {}) {
  const empresa = c.empresa_id ? ctx.cadastros.empresa(c.empresa_id)
    : ctx.cadastros.empresas().find(e => normaliza(e.nome) === normaliza(c.cliente));
  const rb = +c.rebate_pct > 0;
  return {
    empresaId: empresa?.id ?? null,
    laboratorio: c.laboratorio,
    'n-campanha': c.campanha, 'n-tipo': c.tipo || '', 'n-mecanica': c.mecanica || '',
    'n-inicio': comoModelo ? '' : c.data_inicio || '', 'n-fim': comoModelo ? '' : c.data_fim || '',
    'n-inv-lynkz': +c.investimento_lynkz ? valorCampo(c.investimento_lynkz) : '',
    'n-inv-industria': +c.investimento_industria ? valorCampo(c.investimento_industria) : '',
    'n-pagamento': c.forma_pagamento || '', 'n-tipo-meta': c.tipo_meta || '',
    'n-meta': +c.meta ? valorCampo(c.meta) : '',
    'n-rebate': rb, 'n-rebate-pct': rb ? String(+c.rebate_pct).replace('.', ',') : '',
    'n-rebate-teto': rb && +c.rebate_teto ? valorCampo(c.rebate_teto) : '',
    'n-rebate-base': c.rebate_base || '', 'n-rebate-gatilho': c.rebate_gatilho || '',
    'n-dividir': !!lerDivisao(c), divisao: divisaoParaTela(lerDivisao(c)),
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
  const ids = Object.keys(erros);
  if (ids.length && telaDePassos()) irParaPasso(Math.min(...ids.map(passoDoCampo).filter(Boolean), st.passo), { focar: false });
  if (aplicarErros($('#form-nova', st.el), erros)) {
    const n = Object.keys(erros).length;
    ctx.toast(n === 1 ? 'Confira o campo marcado.' : `Confira os ${n} campos marcados.`, { tom: 'erro' });
    return;
  }
  // Período e meta são opcionais: avisa, mas deixa enviar.
  const faltas = [!v('n-inicio') || !v('n-fim') ? 'período' : null, !(num('n-meta') > 0) ? 'meta' : null].filter(Boolean);
  if (faltas.length) {
    const seguir = await confirmar({
      titulo: `Enviar sem ${faltas.join(' e ')}?`,
      descricao: 'O aprovador vai analisar a campanha sem essa informação. Dá para voltar e preencher.',
      confirmar: 'Enviar assim', cancelar: 'Voltar',
    });
    if (!seguir || !st || st.enviando) return;
  }
  st.enviando = true;
  const botoes = $$('[data-enviar]', st.el);
  botoes.forEach(b => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
  try {
    const empresa = ctx.cadastros.empresa(st.comboEmpresa.valor());
    const dados = lerRecebedor();
    const ehSwile = recebedorObrigatorio();

    // Balconista: novo, atualizado ou só escolhido. Quem grava é o banco, junto com a campanha.
    let balconista = null, balconistaId = null;
    if (recebedorVisivel() && st.pessoa && st.pessoa !== 'nenhuma') {
      if (st.pessoa === 'outra') {
        if (marcado('n-rec-salvar')) balconista = camposBalconista({ empresa_id: empresa.id, ...dados }, true);
      } else {
        balconistaId = st.pessoa;
        const balc = balconistaEscolhido();
        if (marcado('n-rec-atualizar') && diferente(balc, dados)) balconista = { id: balc.id, ...camposBalconista(dados, false) };
      }
    }

    const rb = marcado('n-rebate');
    // Só vale a consulta que bate com o que está na tela agora.
    const comprasAtuais = st.compras && st.compras.chave === `${baseCompras(empresa, v('n-inicio'), v('n-fim'))}|${chaveMarcas()}` ? st.compras : null;
    const { campanha: c, balconistaId: novoBalcId } = await ctx.campanhas.enviar({
      campanha: {
        cliente: empresa.nome, empresa_id: empresa.id, balconista_id: balconistaId,
        laboratorio: labsTexto(), campanha: v('n-campanha'),
        // Divisão por fornecedor: meta e indústria acima já são a soma das linhas.
        fornecedores: dividindo() ? linhasDivisao() : null,
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
        compras_periodo: comprasAtuais ? comprasAtuais.total : null,
        compras_consultado_em: comprasAtuais ? comprasAtuais.consultado_em : null,
        compras_marca: comprasAtuais?.marcasSel.length ? juntarMarcas(comprasAtuais.marcasSel) : null,   // "WELLPET; PROTEÇÃO"
        // Devoluções: o aprovador vê a mesma conta. Worker antigo não manda: fica vazio.
        compras_devolucoes: comprasAtuais && comprasAtuais.devolucoes != null ? comprasAtuais.devolucoes : null,
        compras_devolvidas: comprasAtuais ? devolvidasDe(comprasAtuais).map(({ numero, serie, data, valor }) => ({ numero, serie, data, valor })) : null,
      },
      balconista,
      notas: marcadasDe(comprasAtuais),
    });
    st.enviado = true;
    limparRascunho();
    if (novoBalcId && balconista) ctx.cadastros.relerBalconista(novoBalcId).catch(e => console.warn('Balconista não relido', e));
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
  // Reprovada e minha = reenvio (copia tudo). Qualquer outra = modelo (sem as datas).
  const reenvio = !!origem && origem.status === STATUS.REPROVADA && origem.solicitante_id === ctx.perfil.id;
  const rascunho = origem ? null : lerRascunho(ctx.perfil.id);
  let ini = origem ? valoresDaCampanha(origem, ctx, { comoModelo: !reenvio }) : (rascunho || {});
  // "Nova campanha" na ficha da empresa: já vem com ela escolhida.
  let sugerida = null;
  try { sugerida = sessionStorage.getItem(CHAVE_EMPRESA_SUGERIDA); sessionStorage.removeItem(CHAVE_EMPRESA_SUGERIDA); } catch { /* sem armazenamento */ }
  if (!origem && sugerida && ctx.cadastros.empresa(sugerida) && String(ini.empresaId ?? '') !== sugerida) {
    ini = { ...ini, empresaId: sugerida, pessoa: null };
  }
  st = { el, ctx, pessoa: ini.pessoa ?? null, enviando: false, enviado: false, desligar: [], marcas: [],
         rascunhoSemPessoais: !!(rascunho && rascunho.pessoa === 'outra'),
         passo: Math.min(3, Math.max(1, +rascunho?.passo || 1)),
         labs: labsConhecidos(ini.laboratorio).slice(0, MAX_FORNECEDORES),
         div: ini.divisao && typeof ini.divisao === 'object' ? { ...ini.divisao } : {} };
  st.visitado = Math.max(st.passo, Math.min(3, +rascunho?.visitado || 1));

  ctx.cabecalho({ titulo: reenvio ? 'Reenviar campanha' : 'Nova campanha', voltar: origem ? `#/campanhas/${origem.id}` : '#/inicio' });
  ctx.barraDeAcao(true);

  const val = id => ini[id] ?? '';
  const rbOn = ini['n-rebate'] === true;
  pintar(el, html`<div class="nova" data-passo-atual="${st.passo}">
    <form id="form-nova" class="nova-form" novalidate>
      <nav class="passos" aria-label="Etapas da campanha">
        <p class="passos-atual" id="passo-atual" tabindex="-1" aria-live="polite"></p>
        <ol class="passos-lista">${PASSOS.map((p, i) => html`<li><button type="button" class="passo" data-ir-passo="${i + 1}"><span class="passo-num">${i + 1}</span>${p}</button></li>`)}</ol>
      </nav>
      ${reenvio ? html`<p class="nota">${icone('repetir')}<span>Copiado de ${origem.codigo}${origem.motivo ? html` — reprovada por: “${origem.motivo}”` : ''}. Ajuste e envie de novo.</span></p>` : ''}
      ${origem && !reenvio ? html`<p class="nota">${icone('repetir')}<span>Copiado de ${origem.codigo} como modelo. Confira o período e envie.</span></p>` : ''}
      ${rascunho ? html`<p class="nota">${icone('rascunho')}<span>Rascunho recuperado.</span><button type="button" class="btn btn-texto" id="descartar">Descartar</button></p>` : ''}
      ${ini.clienteSemCadastro ? html`<p class="nota nota-alerta">${icone('info')}<span>A campanha original era de “${ini.clienteSemCadastro}”, que ainda não está no cadastro. Escolha ou cadastre a empresa.</span></p>` : ''}

      <section class="painel" data-passo="1"><h2 class="painel-titulo">Empresa e fornecedores</h2><div class="painel-corpo">
        ${campo({ id: 'n-empresa', rotulo: 'Empresa', obrigatorio: true, dica: 'Digite nome, nome fantasia, código, cidade ou CNPJ.', atributos: { placeholder: 'Nome, código, cidade ou CNPJ' } })}
        ${campo({ id: 'n-laboratorio', rotulo: 'Fornecedores', obrigatorio: true,
                  dica: `Escolha de 1 a ${MAX_FORNECEDORES}. Para acrescentar outro, escolha de novo na lista.`,
                  atributos: { placeholder: 'Selecione ou digite para buscar' },
                  depois: html`<div class="chips labs-escolhidos" id="n-labs" role="group" aria-label="Fornecedores escolhidos" hidden></div>` })}
      </div></section>

      <section class="painel" data-passo="1"><h2 class="painel-titulo">A campanha</h2><div class="painel-corpo">
        ${campo({ id: 'n-campanha', rotulo: 'Nome da campanha', valor: val('n-campanha'), obrigatorio: true, atributos: { placeholder: 'Ex.: Genéricos Setembro', maxlength: 120 } })}
        ${selecao({ id: 'n-tipo', rotulo: 'Mecânica', opcoes: C.TIPOS, valor: val('n-tipo') })}
        <div class="recolhivel${val('n-mecanica') ? '' : ' recolhido'}">
          <button type="button" class="btn btn-texto acrescentar" data-acrescentar="n-mecanica">${icone('mais')} Acrescentar como funciona</button>
          ${areaTexto({ id: 'n-mecanica', rotulo: 'Como funciona', valor: val('n-mecanica'), opcional: true, atributos: { placeholder: 'Ex.: 5% de desconto acima de 200 un. e 8% acima de 400 un.' } })}
        </div>
        <div class="grade-2">
          ${campo({ id: 'n-inicio', rotulo: 'Início', tipo: 'date', valor: val('n-inicio') })}
          ${campo({ id: 'n-fim', rotulo: 'Fim', tipo: 'date', valor: val('n-fim'), atributos: { min: val('n-inicio') || false },
                    depois: html`<span class="duracao" id="n-duracao" aria-live="polite"></span>` })}
        </div>
        <div class="chips chips-periodo" role="group" aria-label="Atalhos de período">
          <button type="button" class="chip" data-periodo="este" aria-pressed="false">Este mês</button>
          <button type="button" class="chip" data-periodo="proximo" aria-pressed="false">Próximo mês</button>
          <button type="button" class="chip" data-periodo="30" aria-pressed="false">30 dias a partir de hoje</button>
        </div>
      </div></section>

      <section class="painel" id="bloco-compras" data-passo="2"><h2 class="painel-titulo">Compras e notas fiscais</h2>
        <div class="painel-corpo" id="compras-corpo"></div>
      </section>

      <section class="painel" data-passo="2"><h2 class="painel-titulo">Investimento</h2><div class="painel-corpo">
        <div class="grade-2">
          ${campo({ id: 'n-inv-lynkz', rotulo: 'LYNKZ (R$)', valor: val('n-inv-lynkz'), mascara: 'valor' })}
          ${campo({ id: 'n-inv-industria', rotulo: 'Indústria (R$)', valor: val('n-inv-industria'), mascara: 'valor',
                    depois: html`<p class="campo-dica" id="n-inv-industria-dica" hidden>Os totais são a soma dos fornecedores.</p>` })}
        </div>
        <p class="campo-dica bloco-dica">LYNKZ sai do caixa agora; Indústria é a bonificação paga no mês seguinte. Em branco se não houver.</p>
        ${selecao({ id: 'n-pagamento', rotulo: 'Forma de pagamento', opcoes: C.PAGTO, valor: val('n-pagamento'), obrigatorio: true, vazio: 'Escolha a forma de pagamento', dica: 'Com Swile, a campanha entra na ADP e pede os dados de quem recebe.' })}
      </div></section>

      <section class="painel" id="bloco-recebedor" data-passo="3" hidden>
        <h2 class="painel-titulo" id="recebedor-titulo">Quem recebe a premiação</h2>
        <div class="painel-corpo" id="recebedor-corpo"></div>
      </section>

      <section class="painel" data-passo="2"><h2 class="painel-titulo">Contrapartida do cliente</h2><div class="painel-corpo">
        <div class="grade-2 quebra">
          ${selecao({ id: 'n-tipo-meta', rotulo: 'Tipo de meta', opcoes: C.METAS, valor: val('n-tipo-meta') })}
          ${campo({ id: 'n-meta', rotulo: 'Meta do cliente (R$)', valor: val('n-meta'), mascara: 'valor',
                    depois: html`<p class="campo-dica" id="n-meta-dica" hidden>Os totais são a soma dos fornecedores.</p>` })}
        </div>
        <div class="divisao" id="bloco-divisao" hidden>
          ${interruptor({ id: 'n-dividir', rotulo: 'Dividir por fornecedor', marcado: ini['n-dividir'] === true })}
          <div class="divisao-corpo" id="divisao-corpo" hidden></div>
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

      <section class="painel" data-passo="3"><h2 class="painel-titulo">Observações</h2><div class="painel-corpo">
        <div class="recolhivel${val('n-observacoes') ? '' : ' recolhido'}">
          <button type="button" class="btn btn-texto acrescentar" data-acrescentar="n-observacoes">${icone('mais')} Acrescentar observações</button>
          ${areaTexto({ id: 'n-observacoes', rotulo: 'Observações para o administrador', valor: val('n-observacoes'), opcional: true })}
        </div>
      </div></section>
      <section class="painel resumo-passos" data-passo="3"><h2 class="painel-titulo">Revisão</h2><div class="painel-corpo" id="resumo-passos"></div></section>
      <p class="campo-dica nova-obrig"><span class="campo-obrig" aria-hidden="true">*</span> Campos obrigatórios. O investimento LYNKZ também é obrigatório com Depósito / verba ou Swile.</p>
      <p class="rascunho-status rascunho-status-form" id="rs-form" role="status">${rascunho?.salvoEm ? `Rascunho salvo às ${horaBR(rascunho.salvoEm)}` : ''}</p>
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
        <span class="rascunho-status rascunho-status-barra" id="rs-barra" role="status">${rascunho?.salvoEm ? `Rascunho salvo às ${horaBR(rascunho.salvoEm)}` : ''}</span>
      </div>
      <button type="button" class="btn btn-fantasma btn-icone-passo" data-passo-voltar aria-label="Voltar ao passo anterior">${icone('voltar')}</button>
      <button type="button" class="btn btn-primario" data-passo-continuar>Continuar</button>
      <button type="submit" form="form-nova" class="btn btn-primario" data-enviar>Enviar</button>
    </div>
  </div>`);

  const form = $('#form-nova', el);

  // O combo só acrescenta: escolheu, entra na lista de botões e o campo volta a ficar vazio.
  st.comboLab = combo($('#n-laboratorio', el), {
    // Com 5 escolhidos a lista fica vazia e explica o limite.
    opcoes: () => (st.labs.length >= MAX_FORNECEDORES ? [] : (C.LABORATORIOS || []).filter(l => !st.labs.includes(l)).map(l => ({ valor: l, rotulo: l }))),
    vazio: () => (st.labs.length >= MAX_FORNECEDORES ? `Limite de ${MAX_FORNECEDORES} fornecedores. Tire um para trocar.` : 'Nenhum fornecedor com esse nome (ou já está escolhido).'),
    aoEscolher: o => {
      if (!o) return;
      if (!st.labs.includes(o.valor) && st.labs.length < MAX_FORNECEDORES) st.labs = [...st.labs, o.valor];
      st.comboLab.definir(null);
      mudouLabs();
    },
  });

  st.comboEmpresa = combo($('#n-empresa', el), {
    opcoes: () => ctx.cadastros.empresas().map(e => ({
      valor: e.id, rotulo: e.nome,
      detalhe: [e.nome_fantasia && e.nome_fantasia !== e.nome ? e.nome_fantasia : '', e.cidade, e.codigo_cliente ? `cód. ${e.codigo_cliente}` : ''].filter(Boolean).join(' · '),
      busca: textoBuscaEmpresa(e, ctx.cadastros.balconistasDa(e.id)),
    })),
    valor: ini.empresaId ?? null,
    vazio: 'Nenhuma empresa com esse nome. As empresas vêm do Qlik: se o cliente é novo, peça o cadastro no sistema.',
    aoEscolher: () => {
      limparErro(form, 'n-empresa');
      st.pessoa = null;
      st.rascunhoSemPessoais = false;
      desenharRecebedor();
      salvar();
      atualizarComprasDepois();
    },
  });

  const salvar = debounce(salvarRascunho, 400);
  st.salvar = salvar;
  const atualizarComprasDepois = debounce(atualizarCompras, 500);
  st.atualizarComprasDepois = atualizarComprasDepois;
  desenharLabs();
  desenharDivisao();

  // Primeiro desenho do bloco "Quem recebe" com o que veio do rascunho/campanha.
  desenharRecebedor({ dados: ini.dadosPessoais || null });
  atualizarResumo();
  desenharPassos();

  st.desligar.push(
    ligarMascaras(el),
    () => st.comboEmpresa.desligar(),
    () => st.comboLab.desligar(),
    // Enter no celular, antes do último passo, vale como "Continuar".
    ao(form, 'submit', 'form', e => { e.preventDefault(); if (telaDePassos() && st.passo < PASSOS.length) continuar(); else enviar(); }),
    ao(el, 'click', '[data-passo-continuar]', () => continuar()),
    // Tirar um fornecedor: o foco vai para o próximo botão (ou para o campo, se acabaram).
    ao(form, 'click', '[data-tirar-lab]', (e, b) => {
      const i = st.labs.indexOf(b.dataset.tirarLab);
      st.labs = st.labs.filter(l => l !== b.dataset.tirarLab);
      mudouLabs();
      const botoes = $$('[data-tirar-lab]', form);
      (botoes[Math.min(i, botoes.length - 1)] || $('#n-laboratorio', el)).focus();
    }),
    ao(el, 'click', '[data-passo-voltar]', () => irParaPasso(st.passo - 1)),
    ao(el, 'click', '[data-ir-passo]', (e, b) => { if (!b.disabled) irParaPasso(+b.dataset.irPasso); }),
    ao(el, 'click', '[data-acrescentar]', (e, b) => {
      b.closest('.recolhivel').classList.remove('recolhido');
      $('#' + b.dataset.acrescentar, el)?.focus();
    }),
    ao(form, 'input', 'input, textarea, select', (e, c) => {
      if (c.closest('.campo.tem-erro')) limparErro(form, c.closest('.campo').dataset.campo);
      if (IDS_PESSOAIS.includes(c.id)) atualizarOfertaCadastro();
      salvar();
    }),
    ao(form, 'input', '#n-inv-lynkz, #n-inv-industria, #n-meta, #n-rebate-pct, #n-rebate-teto, [id^="n-div-"]', atualizarResumo),
    ao(form, 'change', '#n-dividir', (e, cb) => { if (cb.checked) preencherDivisaoIgual(); desenharDivisao(); atualizarResumo(); salvar(); }),
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
    ao(form, 'change', '#n-inicio, #n-fim', () => { atualizarPeriodo(); atualizarComprasDepois(); }),
    ao(form, 'input', '#n-inicio, #n-fim', () => { atualizarPeriodo(); atualizarComprasDepois(); }),
    ao(form, 'change', 'input[data-nota]', (e, cb) => {
      const i = +cb.dataset.nota;
      if (cb.checked) st.compras?.marcadas.add(i); else st.compras?.marcadas.delete(i);
      atualizarSomaNotas();
    }),
    ao(form, 'click', '#notas-ver', (e, b) => {
      if (!st.compras) return;
      st.compras.verTodas = !st.compras.verTodas;
      $$('#notas-lista > li', form).forEach((li, i) => { li.hidden = i >= NOTAS_VISIVEIS && !st.compras.verTodas; });
      b.setAttribute('aria-expanded', String(st.compras.verTodas));
      b.textContent = textoVerNotas(st.compras.notas.length, st.compras.verTodas);
    }),
    ao(form, 'click', '#notas-todas, #notas-nenhuma', (e, b) => {
      if (!st.compras) return;
      st.compras.marcadas = new Set(b.id === 'notas-todas' ? st.compras.notas.flatMap((n, i) => (n.provavel_devolucao ? [] : [i])) : []);
      $$('input[data-nota]', form).forEach(cb => { cb.checked = st.compras.marcadas.has(+cb.dataset.nota); });
      atualizarSomaNotas();
    }),
    ao(form, 'click', '#compras-tentar', () => atualizarCompras()),
    // Marcas: cada botão liga/desliga uma; nenhuma = todas. Consulta de novo e devolve o foco ao botão.
    ao(form, 'click', '[data-marca]', (e, b) => {
      const m = b.dataset.marca;
      if (st.marcas.includes(m)) st.marcas = st.marcas.filter(x => x !== m);
      else if (st.marcas.length < MAX_MARCAS) st.marcas = [...st.marcas, m];
      st.focoMarca = m;
      atualizarCompras();
    }),
    ao(form, 'click', '[data-marcas-todas]', () => { st.marcas = []; st.focoMarca = null; atualizarCompras(); }),
    () => st.consulta?.abort(),
    ao(form, 'click', '[data-periodo]', (e, b) => {
      const [a, z] = periodosRapidos()[b.dataset.periodo];
      for (const [id, valor] of [['n-inicio', a], ['n-fim', z]]) {
        const i = $('#' + id, el);
        i.value = valor;
        i.dispatchEvent(new Event('change', { bubbles: true }));
      }
      limparErro(form, 'n-fim');
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

  // Foco automático só com mouse: no celular o teclado e a lista não sobem sozinhos.
  if (!origem && !rascunho && matchMedia('(pointer: fine)').matches) setTimeout(() => $('#n-empresa', el)?.focus({ preventScroll: true }), 0);
  atualizarPeriodo();
  atualizarCompras();

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
