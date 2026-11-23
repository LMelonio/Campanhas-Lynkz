// ============================================================
//  CAMPANHAS — lista com busca, filtros e "Mostrar mais"; com
//  #/campanhas/:id abre o detalhe (≥ 1200 px: lado a lado).
//  Atualização ao vivo redesenha só a lista, preservando rolagem e foco.
// ============================================================
import { html, pintar, $, ao, debounce } from '../lib/dom.js';
import { contem, calc, dataCivil, hojeCivil, STATUS } from '../lib/regras.js';
import { campoBusca, ligarBusca } from '../ui/campos.js';
import { icone } from '../ui/icones.js';
import { cartao, vazio } from '../ui/pecas.js';
import * as detalhe from './detalhe.js';
import { exportarExcel } from '../exportar.js';
import { estadoLista } from '../ui/estado.js';

const PASSO = 40;
const STATUS_FILTROS = [
  { valor: STATUS.PENDENTE, rotulo: 'Pendentes' },
  { valor: STATUS.APROVADA, rotulo: 'Aprovadas' },
  { valor: STATUS.REPROVADA, rotulo: 'Reprovadas' },
  { valor: 'Todas', rotulo: 'Todas' },
];

// Filtros sobrevivem à troca de tela (até sair do app).
const filtros = { busca: '', status: null, lab: '', minhas: null, limite: PASSO };
// Filtros que vieram da URL (indicadores do Início): viram chips com "×".
// status · mes ('AAAA-MM', pela data da decisão) · rebate (só com rebate)
const daUrl = {};
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ROTULO_STATUS = { Pendente: 'Pendentes', Aprovada: 'Aprovadas', Reprovada: 'Reprovadas', Todas: 'Todas' };

// Aplica ?status=…&mes=atual&rebate=1. Devolve true se havia algo na URL.
function aplicarQuery(q = {}) {
  if (!Object.keys(q).length) return false;
  for (const k of Object.keys(daUrl)) delete daUrl[k];
  if (STATUS_FILTROS.some(f => f.valor === q.status)) { filtros.status = q.status; daUrl.status = q.status; }
  if (q.mes === 'atual') daUrl.mes = hojeCivil().slice(0, 7);
  else if (/^\d{4}-\d{2}$/.test(q.mes || '')) daUrl.mes = q.mes;
  if (q.rebate === '1') daUrl.rebate = true;
  // A lista precisa bater com o número clicado: sem "Só as minhas", busca ou laboratório.
  Object.assign(filtros, { minhas: false, busca: '', lab: '', limite: PASSO });
  return true;
}

// Reescreve a URL com o que sobrou dos filtros da URL (sem criar histórico).
function atualizarUrl() {
  const q = new URLSearchParams();
  if (daUrl.status) q.set('status', daUrl.status);
  if (daUrl.mes) q.set('mes', daUrl.mes === hojeCivil().slice(0, 7) ? 'atual' : daUrl.mes);
  if (daUrl.rebate) q.set('rebate', '1');
  const base = '#/campanhas' + (s?.id ? `/${s.id}` : '');
  const qs = q.toString();
  history.replaceState(history.state, '', base + (qs ? '?' + qs : ''));
}

let s = null;   // estado da tela montada: { el, ctx, id, desligar[], desmontarDetalhe, rolagemLista }

function aplicarFiltros(ctx, { ignorarStatus = false } = {}) {
  const eu = ctx.perfil.id;
  return ctx.campanhas.todas().filter(c =>
    (ignorarStatus || filtros.status === 'Todas' || c.status === filtros.status) &&
    (!filtros.lab || c.laboratorio === filtros.lab) &&
    (!filtros.minhas || c.solicitante_id === eu) &&
    (!filtros.busca || contem(filtros.busca, `${c.cliente} ${c.campanha} ${c.laboratorio} ${c.codigo} ${c.solicitante_nome || ''}`)) &&
    (!daUrl.mes || dataCivil(c.data_decisao || c.criado_em).startsWith(daUrl.mes)) &&
    (!daUrl.rebate || calc(c).reb > 0));
}

function ordenar(lista) {
  // Pendentes: quem espera há mais tempo primeiro. Demais: mais nova primeiro.
  const asc = filtros.status === STATUS.PENDENTE;
  return [...lista].sort((a, b) => asc
    ? String(a.criado_em).localeCompare(String(b.criado_em))
    : String(b.criado_em).localeCompare(String(a.criado_em)));
}

function desenharChips() {
  const caixa = $('#cp-chips', s.el);
  const chips = [];
  if (daUrl.status || daUrl.mes) {
    const mes = daUrl.mes ? MESES[+daUrl.mes.slice(5, 7) - 1] : '';
    const texto = daUrl.status
      ? `${ROTULO_STATUS[daUrl.status]}${mes ? ` em ${mes}` : ''}`
      : `Em ${mes}`;
    chips.push({ chave: 'status', texto });
  }
  if (daUrl.rebate) chips.push({ chave: 'rebate', texto: 'Com rebate' });
  caixa.hidden = !chips.length;
  pintar(caixa, html`${chips.map(c => html`<button type="button" class="chip chip-filtro" data-tirar="${c.chave}" aria-label="Remover filtro: ${c.texto}">${c.texto}${icone('x')}</button>`)}`);
}

function desenharFiltros() {
  desenharChips();
  const { el, ctx } = s;
  const base = aplicarFiltros(ctx, { ignorarStatus: true });
  const conta = v => v === 'Todas' ? base.length : base.filter(c => c.status === v).length;
  pintar($('#cp-status', el), html`${STATUS_FILTROS.map(f => html`<button type="button" class="filtro" data-status="${f.valor}" aria-pressed="${filtros.status === f.valor}">${f.rotulo}<span class="n">${conta(f.valor)}</span></button>`)}`);
}

function desenharLista() {
  const { el, ctx } = s;
  const caixa = $('#cp-itens', el);
  // Guarda o foco (cartão ou "Mostrar mais") para devolver depois.
  const focado = document.activeElement;
  const idFoco = caixa.contains(focado) ? (focado.dataset.id || focado.id) : null;

  const lista = ordenar(aplicarFiltros(ctx));
  const visiveis = lista.slice(0, filtros.limite);
  const filtrando = filtros.busca || filtros.lab || filtros.minhas;
  // Carregando ou erro de carga: nunca dizer "Nada encontrado" nesses casos.
  const est = estadoLista({ carregado: ctx.campanhas.carregado, erro: ctx.campanhas.erro });
  if (est) { pintar($('#cp-resumo', el), ''); $('#cp-excel', el).hidden = true; pintar(caixa, est); return; }
  $('#cp-excel', el).hidden = !lista.length;
  pintar($('#cp-resumo', el), lista.length === 1 ? '1 campanha' : `${lista.length} campanhas`);
  pintar(caixa, lista.length
    ? html`${visiveis.map(c => cartao(c, { ativo: String(c.id) === String(s.id) }))}
      ${lista.length > visiveis.length ? html`<button type="button" class="btn btn-fantasma btn-largo" id="cp-mais">Mostrar mais (${lista.length - visiveis.length} restantes)</button>` : ''}`
    : vazio({
        // "Só as minhas" ligado por padrão e nenhuma campanha enviada ainda: não é busca sem resultado.
        ...(filtros.minhas && !filtros.busca && !filtros.lab && !ctx.campanhas.todas().some(c => c.solicitante_id === ctx.perfil?.id)
          ? { icone: 'check', titulo: 'Você ainda não enviou campanhas', texto: 'Use o botão Nova campanha para enviar a primeira.' }
          : {
              icone: filtrando ? 'busca' : 'check',
              titulo: filtrando ? 'Nada encontrado' : 'Nada por aqui',
              texto: filtrando ? 'Tente outro nome, código ou laboratório, ou limpe os filtros.' : 'Campanhas com este status aparecem aqui.',
            }),
      }));
  if (idFoco) (caixa.querySelector(`[data-id="${CSS.escape(idFoco)}"]`) || document.getElementById(idFoco))?.focus({ preventScroll: true });
}

function mostrarDetalhe(id) {
  const { el, ctx } = s;
  const md = $('.mestre-detalhe', el);
  const caixa = $('#cp-detalhe', el);
  if (s.desmontarDetalhe) { s.desmontarDetalhe(); s.desmontarDetalhe = null; }
  ctx.barraDeAcao(false);
  const lado = matchMedia('(min-width: 1200px)').matches;

  if (id) {
    if (!s.id && !lado) s.rolagemLista = window.scrollY;
    s.id = id;
    md.dataset.comDetalhe = 'true';
    s.desmontarDetalhe = detalhe.montar(caixa, ctx, { id, lista: () => ordenar(aplicarFiltros(ctx)).map(c => String(c.id)) });
    if (!lado) window.scrollTo(0, 0);
  } else {
    s.id = null;
    md.dataset.comDetalhe = 'false';
    pintar(caixa, lado ? vazio({ icone: 'campanhas', titulo: 'Escolha uma campanha', texto: 'O detalhe aparece aqui, ao lado da lista.' }) : '');
    ctx.cabecalho({ titulo: 'Campanhas' });
    if (!lado) requestAnimationFrame(() => window.scrollTo(0, s.rolagemLista || 0));
  }
  // Marca o cartão aberto sem redesenhar a lista.
  $('#cp-itens', el).querySelectorAll('.cartao').forEach(a => {
    if (a.dataset.id === String(s.id)) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  });
}

export function montar(el, ctx, params) {
  if (filtros.status === null) filtros.status = ctx.ehAprovador ? STATUS.PENDENTE : 'Todas';
  if (filtros.minhas === null) filtros.minhas = !ctx.ehAprovador;
  aplicarQuery(params.query);
  s = { el, ctx, id: null, desligar: [], desmontarDetalhe: null, rolagemLista: 0 };

  const labs = [...new Set([...(window.CONFIG.LABORATORIOS || []), ...ctx.campanhas.todas().map(c => c.laboratorio)])]
    .filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  pintar(el, html`<div class="mestre-detalhe" data-com-detalhe="false">
    <section class="md-lista" aria-label="Lista de campanhas">
      <div class="ferramentas">
        ${campoBusca({ id: 'cp-busca', rotulo: 'Buscar campanhas', valor: filtros.busca, placeholder: 'Empresa, campanha, laboratório ou código' })}
        <div class="filtros" id="cp-status" role="group" aria-label="Filtrar por status"></div>
        <div class="ferramentas-linha">
          <div class="campo">
            <label class="so-leitor" for="cp-lab">Laboratório</label>
            <select id="cp-lab">
              <option value="">Todos os laboratórios</option>
              ${labs.map(l => html`<option value="${l}"${l === filtros.lab ? html` selected` : ''}>${l}</option>`)}
            </select>
          </div>
          <label class="interruptor sem-caixa" for="cp-minhas">
            <input type="checkbox" role="switch" id="cp-minhas"${filtros.minhas ? html` checked` : ''}>
            <span class="interruptor-trilho" aria-hidden="true"></span>
            <span class="interruptor-texto">Só as minhas</span>
          </label>
        </div>
      </div>
      <div class="chips chips-filtro" id="cp-chips" role="group" aria-label="Filtros aplicados" hidden></div>
      <div class="lista-cabeca">
        <p class="lista-resumo" id="cp-resumo" role="status"></p>
        <button type="button" class="btn btn-texto btn-pequeno" id="cp-excel" hidden>${icone('baixar')} Baixar Excel desta lista</button>
      </div>
      <div id="cp-itens"></div>
    </section>
    <section class="md-detalhe" id="cp-detalhe" aria-label="Detalhe da campanha"></section>
  </div>`);

  const redesenhar = () => { desenharFiltros(); desenharLista(); };
  const buscar = debounce(v => { filtros.busca = v; filtros.limite = PASSO; redesenhar(); }, 200);

  s.desligar.push(
    ao(el, 'input', '#cp-busca', (e, i) => buscar(i.value)),
    ao(el, 'click', '[data-status]', (e, b) => {
      filtros.status = b.dataset.status; filtros.limite = PASSO;
      if (daUrl.status) { delete daUrl.status; atualizarUrl(); }
      redesenhar();
      $(`[data-status="${b.dataset.status}"]`, el)?.focus();
    }),
    ao(el, 'click', '[data-tirar]', (e, b) => {
      if (b.dataset.tirar === 'status') { delete daUrl.status; delete daUrl.mes; filtros.status = 'Todas'; }
      else delete daUrl[b.dataset.tirar];
      filtros.limite = PASSO;
      atualizarUrl();
      redesenhar();
      ($('[data-tirar]', el) || $('#cp-busca', el)).focus();
    }),
    ligarBusca(el),
    ao(el, 'click', '#cp-excel', async (e, b) => {
      b.disabled = true; b.setAttribute('aria-busy', 'true');
      try {
        await exportarExcel(ordenar(aplicarFiltros(ctx)), ctx.cadastros, { prefixo: `Campanhas_${ROTULO_STATUS[filtros.status] || 'Todas'}` });
        ctx.toast('Planilha gerada.', { tom: 'sucesso' });
      } catch (err) { ctx.toast(err.message, { tom: 'erro', duracao: 8000 }); }
      finally { b.disabled = false; b.removeAttribute('aria-busy'); }
    }),
    ao(el, 'change', '#cp-lab', (e, sel) => { filtros.lab = sel.value; filtros.limite = PASSO; redesenhar(); }),
    ao(el, 'change', '#cp-minhas', (e, cb) => { filtros.minhas = cb.checked; filtros.limite = PASSO; redesenhar(); }),
    ao(el, 'click', '#cp-mais', () => {
      const antes = filtros.limite;
      filtros.limite += PASSO;
      desenharLista();
      // Foco no primeiro cartão novo.
      $('#cp-itens', el).querySelectorAll('.cartao')[antes]?.focus();
    }),
    ctx.campanhas.assinar(redesenhar),
    () => buscar.cancelar(),
  );

  redesenhar();
  mostrarDetalhe(params.id || null);

  return () => {
    s.desligar.forEach(fn => fn());
    if (s.desmontarDetalhe) s.desmontarDetalhe();
    s = null;
  };
}

// Troca de #/campanhas ↔ #/campanhas/:id sem remontar a lista.
export function atualizar(params) {
  if (!s) return;
  // Query nova (indicador do Início com a lista já aberta): aplica e sincroniza os controles.
  if (aplicarQuery(params.query)) {
    $('#cp-busca', s.el).value = '';
    $('[data-limpar-busca="cp-busca"]', s.el).hidden = true;
    $('#cp-lab', s.el).value = '';
    $('#cp-minhas', s.el).checked = false;
    desenharFiltros();
    desenharLista();
  }
  mostrarDetalhe(params.id || null);
}
